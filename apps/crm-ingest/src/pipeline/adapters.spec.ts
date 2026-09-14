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
  const completed = {
    eventType: 'transaction.completed',
    eventId: 'evt-tx-completed-1',
    timestamp: '2026-06-09T12:00:00.000Z',
    data: { userId: 'usr-abc123', transactionId: 'tx-001', amount: 250 },
  };

  it('garde le nom d’événement et préfixe eventId par la source', () => {
    const result = adaptRabbit(completed);

    expect(result.kind).to.equal('event');
    if (result.kind !== 'event') return;
    expect(result.event.eventId).to.equal('rabbitmq:evt-tx-completed-1');
    expect(result.event.eventName).to.equal('transaction.completed');
    expect(result.event.userId).to.equal('usr-abc123');
  });

  it('ignore un événement inconnu, rejette un message sans data.userId', () => {
    expect(adaptRabbit({ ...completed, eventType: 'wallet.opened' }).kind).to.equal('ignored');
    expect(adaptRabbit({ ...completed, data: { amount: 1 } }).kind).to.equal('invalid');
  });
});
