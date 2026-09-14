import { expect } from 'chai';

import { computeProfileUpdate, computeTransactionFacts } from './profile-rules';

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

  it('dans un même lot, le fait le plus récent l’emporte quel que soit l’ordre d’arrivée', () => {
    const update = computeProfileUpdate(
      [
        { eventName: 'kyc.approved', occurredAt: at('2026-01-05T00:00:00.000Z'), data: {} },
        { eventName: 'kyc.submitted', occurredAt: at('2026-01-01T00:00:00.000Z'), data: {} },
      ],
      {}
    );

    expect(update.set['data.kyc_status']).to.equal('validated');
    expect(update.set['data.kyc_validated_at']).to.equal('2026-01-05T00:00:00.000Z');
  });

  it('garde la première date de création, et marque la suppression', () => {
    const update = computeProfileUpdate(
      [
        { eventName: 'account.registered', occurredAt: at('2026-03-01T00:00:00.000Z'), data: {} },
        { eventName: 'account.deleted', occurredAt: at('2026-04-01T00:00:00.000Z'), data: {} },
      ],
      { 'data.account_created_at': at('2026-02-01T00:00:00.000Z') }
    );

    expect(update.set).to.not.have.property('data.account_created_at');
    expect(update.set['data.isDeleted']).to.equal(true);
    expect(update.clearPushCredentials).to.equal(true);
  });
});

describe('computeTransactionFacts', () => {
  it('cumuls à vie arrondis, premières et dernière transactions', () => {
    const set = computeTransactionFacts(
      [
        { eventName: 'transaction.completed', occurredAt: at('2026-05-02T10:00:00.000Z'), product: 'crypto' },
        { eventName: 'transaction.completed', occurredAt: at('2026-05-01T10:00:00.000Z'), product: 'crypto' },
        { eventName: 'transaction.failed', occurredAt: at('2026-05-03T10:00:00.000Z'), product: 'crypto' },
      ],
      { last_tx_at: '2026-04-01T00:00:00.000Z' },
      { tx: 12, volUsd: 150.505 }
    );

    expect(set).to.deep.equal({
      'data.lifetime_tx': 12,
      'data.lifetime_vol_usd': 150.51,
      'data.last_tx_at': '2026-05-02T10:00:00.000Z',
      'data.first_tx_at': '2026-05-01T10:00:00.000Z',
      'data.first_tx_at_crypto': '2026-05-01T10:00:00.000Z',
    });
  });

  it('ne recule jamais une première transaction déjà connue', () => {
    const set = computeTransactionFacts(
      [{ eventName: 'transaction.completed', occurredAt: at('2026-05-02T10:00:00.000Z'), product: 'crypto' }],
      { first_tx_at: '2025-01-01T00:00:00.000Z', first_tx_at_crypto: '2025-01-01T00:00:00.000Z' },
      { tx: 1, volUsd: 10 }
    );

    expect(set).to.not.have.property('data.first_tx_at');
    expect(set).to.not.have.property('data.first_tx_at_crypto');
  });
});
