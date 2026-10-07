import type { CrmProductActivity } from '@novu/dal';
import { expect } from 'chai';

import { computeProfileUpdate, computeTransactionFacts, zeroActivityDefaults } from './profile-rules';

const at = (iso: string) => new Date(iso);

describe('computeProfileUpdate', () => {
  it('écrit l’identité et la date de création à l’inscription', () => {
    const update = computeProfileUpdate(
      [
        {
          eventName: 'account.registered',
          occurredAt: at('2026-01-10T08:00:00.000Z'),
          data: { email: 'a@b.co', firstName: 'Awa', country: 'ci' },
        },
      ],
      {}
    );

    expect(update.set).to.deep.equal({
      email: 'a@b.co',
      firstName: 'Awa',
      'data.country_code': 'CI',
      'data.account_created_at': '2026-01-10T08:00:00.000Z',
    });
  });

  it('un fait plus ancien n’écrase pas une valeur plus récente (événements dans le désordre)', () => {
    const update = computeProfileUpdate(
      [{ eventName: 'kyc.submitted', occurredAt: at('2026-01-01T00:00:00.000Z'), data: {} }],
      { 'data.kyc_status': at('2026-01-05T00:00:00.000Z') }
    );

    expect(update.set).to.deep.equal({});
    expect(update.fieldsAt).to.deep.equal({});
  });

  it('kyc.validated pose le statut et la date de validation', () => {
    const update = computeProfileUpdate(
      [{ eventName: 'kyc.validated', occurredAt: at('2026-01-05T00:00:00.000Z'), data: {} }],
      {}
    );

    expect(update.set['data.kyc_status']).to.equal('validated');
    expect(update.set['data.kyc_validated_at']).to.equal('2026-01-05T00:00:00.000Z');
  });

  it('garde la première date de création connue', () => {
    const update = computeProfileUpdate(
      [{ eventName: 'account.registered', occurredAt: at('2026-03-01T00:00:00.000Z'), data: {} }],
      { 'data.account_created_at': at('2026-02-01T00:00:00.000Z') }
    );

    expect(update.set).to.not.have.property('data.account_created_at');
  });

  it('un événement hors catalogue ne produit aucun fait', () => {
    const update = computeProfileUpdate(
      [{ eventName: 'consent.marketing_updated', occurredAt: at('2026-09-01T00:00:00.000Z'), data: { optIn: false } }],
      {}
    );

    expect(update.set).to.deep.equal({});
  });
});

describe('computeTransactionFacts', () => {
  const lifetime = (tx: number, volUsd: number, byProduct: CrmProductActivity[]) => ({ tx, volUsd, byProduct });
  const product = (productId: string, tx: number, volUsd: number, txFailed = 0): CrmProductActivity => ({
    productId,
    tx,
    volUsd,
    txFailed,
  });
  const empty = { tx: 0, tx_failed: 0, vol_usd: 0 };

  it('cumuls à vie arrondis, premières et dernière transactions', () => {
    const set = computeTransactionFacts(
      [
        { eventName: 'transaction.completed', occurredAt: at('2026-05-02T10:00:00.000Z'), productId: 'crypto' },
        { eventName: 'transaction.completed', occurredAt: at('2026-05-01T10:00:00.000Z'), productId: 'crypto' },
        { eventName: 'transaction.failed', occurredAt: at('2026-05-03T10:00:00.000Z'), productId: 'crypto' },
      ],
      { last_tx_at: '2026-04-01T00:00:00.000Z' },
      lifetime(12, 150.505, [product('crypto', 12, 150.505)])
    );

    expect(set).to.deep.equal({
      'data.lifetime_tx': 12,
      'data.lifetime_vol_usd': 150.51,
      'data.last_tx_at': '2026-05-02T10:00:00.000Z',
      'data.first_tx_at': '2026-05-01T10:00:00.000Z',
      'data.product_state': {
        unknown: empty,
        crypto: {
          tx: 12,
          tx_failed: 0,
          vol_usd: 150.51,
          first_tx_at: '2026-05-01T10:00:00.000Z',
          last_tx_at: '2026-05-02T10:00:00.000Z',
        },
      },
      'data.products': ['crypto'],
      'data.product_count': 1,
    });
  });

  it('ne recule jamais une première transaction déjà connue', () => {
    const set = computeTransactionFacts(
      [{ eventName: 'transaction.completed', occurredAt: at('2026-05-02T10:00:00.000Z'), productId: 'crypto' }],
      {
        first_tx_at: '2025-01-01T00:00:00.000Z',
        product_state: { crypto: { tx: 1, vol_usd: 10, first_tx_at: '2025-01-01T00:00:00.000Z' } },
      },
      lifetime(2, 20, [product('crypto', 2, 20)])
    );

    expect(set).to.not.have.property('data.first_tx_at');
    expect(set['data.product_state']).to.deep.equal({
      unknown: empty,
      crypto: {
        tx: 2,
        tx_failed: 0,
        vol_usd: 20,
        first_tx_at: '2025-01-01T00:00:00.000Z',
        last_tx_at: '2026-05-02T10:00:00.000Z',
      },
    });
  });

  it('un client est lié à chaque produit sur lequel il a transigé, dans l’ordre', () => {
    const set = computeTransactionFacts(
      [
        { eventName: 'transaction.completed', occurredAt: at('2026-05-02T10:00:00.000Z'), productId: 'crypto' },
        { eventName: 'transaction.completed', occurredAt: at('2026-05-03T10:00:00.000Z'), productId: 'card' },
      ],
      {},
      lifetime(3, 30, [product('card', 1, 10), product('crypto', 2, 20)])
    );

    expect(set['data.products']).to.deep.equal(['card', 'crypto']);
    expect(set['data.product_count']).to.equal(2);
  });

  it('une transaction sans produit lie le client à « unknown »', () => {
    const set = computeTransactionFacts(
      [{ eventName: 'transaction.completed', occurredAt: at('2026-05-02T10:00:00.000Z'), productId: 'unknown' }],
      {},
      lifetime(1, 10, [product('unknown', 1, 10)])
    );

    expect(set['data.products']).to.deep.equal(['unknown']);
  });

  it('une transaction échouée lie quand même : le client a tenté d’utiliser le produit', () => {
    const set = computeTransactionFacts(
      [{ eventName: 'transaction.failed', occurredAt: at('2026-05-02T10:00:00.000Z'), productId: 'card' }],
      {},
      lifetime(0, 0, [product('card', 0, 0, 1)])
    );

    expect(set['data.products']).to.deep.equal(['card']);
    expect(set['data.product_count']).to.equal(1);
  });

  it('« unknown » est toujours présent dans product_state, mais ne lie pas sans activité', () => {
    const set = computeTransactionFacts(
      [{ eventName: 'transaction.completed', occurredAt: at('2026-05-02T10:00:00.000Z'), productId: 'card' }],
      {},
      lifetime(1, 10, [product('card', 1, 10)])
    );

    expect(set['data.product_state']).to.have.property('unknown').that.deep.equals(empty);
    expect(set['data.products']).to.deep.equal(['card']);
  });
});

describe('zeroActivityDefaults', () => {
  it('un client sans activité porte quand même les compteurs à zéro', () => {
    expect(zeroActivityDefaults({})).to.deep.equal({
      'data.lifetime_tx': 0,
      'data.lifetime_vol_usd': 0,
      'data.products': [],
      'data.product_count': 0,
    });
  });

  it('ne touche jamais un compteur déjà calculé', () => {
    const set = zeroActivityDefaults({ lifetime_tx: 4, products: ['crypto'], product_count: 1 });

    expect(set).to.deep.equal({ 'data.lifetime_vol_usd': 0 });
  });
});

describe('identité au format Keycloak', () => {
  const at = (iso: string) => new Date(iso);

  it('REGISTER : details en snake_case, comme Keycloak les émet réellement', () => {
    const update = computeProfileUpdate(
      [
        {
          eventName: 'account.registered',
          occurredAt: at('2026-05-01T10:00:00.000Z'),
          // Charge réelle d'un REGISTER Keycloak, enrichie par Izichange (pays, téléphone, langue).
          data: {
            auth_method: 'openid-connect',
            register_method: 'form',
            username: 'awa.diop',
            email: 'awa@example.com',
            first_name: 'Awa',
            last_name: 'Diop',
            country_code: 'ci',
            phone_number: '+2250700000000',
            language: 'fr',
            timezone: 'Africa/Abidjan',
          },
        },
      ],
      {}
    );

    expect(update.set).to.include({
      firstName: 'Awa',
      lastName: 'Diop',
      email: 'awa@example.com',
      phone: '+2250700000000',
      locale: 'fr',
      timezone: 'Africa/Abidjan',
      'data.country_code': 'CI',
    });
  });

  it('UPDATE_PROFILE : Keycloak préfixe les champs modifiés par « updated_ »', () => {
    const update = computeProfileUpdate(
      [
        {
          eventName: 'account.profile_updated',
          occurredAt: at('2026-05-02T10:00:00.000Z'),
          data: {
            previous_first_name: 'Awa',
            updated_first_name: 'Awa Marie',
            updated_last_name: 'Diop',
            updated_email: 'awa.m@example.com',
          },
        },
      ],
      {}
    );

    expect(update.set).to.include({
      firstName: 'Awa Marie',
      lastName: 'Diop',
      email: 'awa.m@example.com',
    });
  });

  it('le camelCase d’un message RabbitMQ reste prioritaire', () => {
    const update = computeProfileUpdate(
      [
        {
          eventName: 'account.registered',
          occurredAt: at('2026-05-01T10:00:00.000Z'),
          data: { firstName: 'Awa', first_name: 'IGNORÉ' },
        },
      ],
      {}
    );

    expect(update.set).to.include({ firstName: 'Awa' });
  });
});

describe('produit activé sans transaction', () => {
  const at = (iso: string) => new Date(iso);
  const lifetime = (byProduct: CrmProductActivity[] = []) => ({
    tx: byProduct.reduce((n, p) => n + p.tx, 0),
    volUsd: 0,
    byProduct,
  });

  it('une activation lie le client au produit, sans aucune activité', () => {
    const set = computeTransactionFacts(
      [{ eventName: 'product.activated', occurredAt: at('2026-05-02T10:00:00.000Z'), productId: 'card' }],
      {},
      lifetime()
    );

    expect(set['data.products']).to.deep.equal(['card']);
    expect(set['data.product_state']).to.have.nested.property('card.activated_at', '2026-05-02T10:00:00.000Z');
  });

  it('le lien survit aux recalculs suivants, qui n’ont aucune ligne d’activité à lire', () => {
    const avant = {
      product_state: { card: { tx: 0, tx_failed: 0, vol_usd: 0, activated_at: '2026-05-02T10:00:00.000Z' } },
    };
    const set = computeTransactionFacts([], avant, lifetime());

    expect(set['data.products']).to.deep.equal(['card']);
  });

  it('un rejeu ne rajeunit pas la date d’activation', () => {
    const avant = {
      product_state: { card: { tx: 0, tx_failed: 0, vol_usd: 0, activated_at: '2026-05-02T10:00:00.000Z' } },
    };
    const set = computeTransactionFacts(
      [{ eventName: 'product.activated', occurredAt: at('2026-06-01T10:00:00.000Z'), productId: 'card' }],
      avant,
      lifetime()
    );

    expect(set['data.product_state']).to.have.nested.property('card.activated_at', '2026-05-02T10:00:00.000Z');
  });

  it('activation puis usage : un seul produit, les deux dates conservées', () => {
    const avant = {
      product_state: { card: { tx: 0, tx_failed: 0, vol_usd: 0, activated_at: '2026-05-02T10:00:00.000Z' } },
    };
    const set = computeTransactionFacts(
      [{ eventName: 'transaction.completed', occurredAt: at('2026-05-06T10:00:00.000Z'), productId: 'card' }],
      avant,
      lifetime([{ productId: 'card', tx: 1, volUsd: 40, txFailed: 0 }])
    );

    expect(set['data.products']).to.deep.equal(['card']);
    expect(set['data.product_state']).to.have.nested.property('card.activated_at', '2026-05-02T10:00:00.000Z');
    expect(set['data.product_state']).to.have.nested.property('card.first_tx_at', '2026-05-06T10:00:00.000Z');
  });
});
