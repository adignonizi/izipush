import { expect } from 'chai';

import { adaptKeycloak, adaptRabbit } from './adapters';

describe('adaptKeycloak', () => {
  const register = {
    id: 'evt-register-001',
    time: 1749463200000,
    type: 'REGISTER',
    realmId: 'izichange',
    userId: 'usr-abc123',
    details: { email: 'user@example.com', firstName: 'Jean', lastName: 'Dupont' },
  };

  it('traduit REGISTER en account.registered', () => {
    const result = adaptKeycloak(register);

    expect(result.kind).to.equal('event');
    if (result.kind !== 'event') return;
    expect(result.event).to.deep.include({
      eventId: 'keycloak:evt-register-001',
      eventName: 'account.registered',
      userId: 'usr-abc123',
      source: 'keycloak',
    });
    expect(result.event.occurredAt.toISOString()).to.equal('2025-06-09T10:00:00.000Z');
    expect(result.event.data).to.deep.equal(register.details);
  });

  it('ignore les types non suivis (LOGOUT…)', () => {
    expect(adaptKeycloak({ ...register, type: 'LOGOUT' }).kind).to.equal('ignored');
  });

  it('rejette un événement sans userId ou sans date valide', () => {
    expect(adaptKeycloak({ ...register, userId: ' ' }).kind).to.equal('invalid');
    expect(adaptKeycloak({ ...register, time: 'pas une date' }).kind).to.equal('invalid');
  });
});

describe('adaptRabbit', () => {
  // Enveloppe Izichange (02_Contrat_Evenement).
  const completed = {
    event_id: 'evt-tx-completed-1',
    event_name: 'transaction.completed',
    schema_version: 1,
    occurred_at: '2026-06-09T12:00:00.000Z',
    published_at: '2026-06-09T12:00:01.000Z',
    user_id: 'usr-abc123',
    tenant_id: 'country-ci',
    product_code: 'crypto',
    source: 'backend_core',
    marketing_priority: 'M1',
    test_flag: false,
    payload: { amount_usd: 250, type: 'buy', txNo: 1 },
  };

  it('lit l’enveloppe, préfixe l’identifiant par la source et remonte le produit', () => {
    const result = adaptRabbit(completed);

    expect(result.kind).to.equal('event');
    if (result.kind !== 'event') return;
    expect(result.event).to.deep.include({
      eventId: 'rabbitmq:evt-tx-completed-1',
      eventName: 'transaction.completed',
      userId: 'usr-abc123',
      productCode: 'crypto',
      source: 'rabbitmq',
    });
    expect(result.event.occurredAt.toISOString()).to.equal('2026-06-09T12:00:00.000Z');
    expect(result.event.data).to.deep.equal(completed.payload);
  });

  it('les champs d’enveloppe non exploités n’empêchent rien', () => {
    const { schema_version, published_at, tenant_id, marketing_priority, ...minimal } = completed;

    expect(adaptRabbit(minimal).kind).to.equal('event');
  });

  it('un événement de recette n’est jamais appliqué à un profil', () => {
    const result = adaptRabbit({ ...completed, test_flag: true });

    expect(result.kind).to.equal('ignored');
    if (result.kind !== 'ignored') return;
    expect(result.reason).to.contain('test_flag');
  });

  it('ignore un événement hors catalogue', () => {
    expect(adaptRabbit({ ...completed, event_name: 'wallet.opened' }).kind).to.equal('ignored');
  });

  it('rejette une enveloppe incomplète', () => {
    expect(adaptRabbit({ ...completed, user_id: ' ' }).kind).to.equal('invalid');
    expect(adaptRabbit({ ...completed, event_id: '' }).kind).to.equal('invalid');
    expect(adaptRabbit({ ...completed, occurred_at: 'pas une date' }).kind).to.equal('invalid');
    expect(adaptRabbit({ ...completed, event_name: undefined }).kind).to.equal('invalid');
  });

  it('exige le code produit sur les événements qui en portent un', () => {
    expect(adaptRabbit({ ...completed, product_code: undefined }).kind).to.equal('invalid');
    expect(adaptRabbit({ ...completed, event_name: 'product.activated', product_code: undefined }).kind).to.equal(
      'invalid'
    );
    // kyc.validated n'en porte pas : son absence est normale.
    expect(adaptRabbit({ ...completed, event_name: 'kyc.validated', product_code: undefined }).kind).to.equal('event');
  });
});
