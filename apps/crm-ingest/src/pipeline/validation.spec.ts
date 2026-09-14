import { expect } from 'chai';

import { activityDay, activityProduct, CrmValidationError, validateEventData } from './validation';

describe('validateEventData', () => {
  it('normalise le montant et l’identifiant d’une transaction', () => {
    const data = validateEventData('transaction.completed', { transactionId: 42, amount: '120.50', extra: 'gardé' });

    expect(data).to.deep.include({ transactionId: '42', amount: 120.5, extra: 'gardé' });
  });

  it('refuse un montant non numérique ou négatif', () => {
    expect(() => validateEventData('transaction.completed', { transactionId: 't', amount: 'abc' })).to.throw(
      CrmValidationError
    );
    expect(() => validateEventData('transaction.completed', { transactionId: 't', amount: -3 })).to.throw(
      CrmValidationError
    );
  });

  it('exige la nouvelle adresse pour un changement d’email', () => {
    expect(() => validateEventData('account.email_updated', { email: 'old@example.com' })).to.throw(CrmValidationError);
  });
});

describe('clés d’activité', () => {
  it('jour UTC et produit normalisé', () => {
    expect(activityDay(new Date('2026-06-09T23:59:59.000Z'))).to.equal('2026-06-09');
    expect(activityProduct({ product: ' Crypto Buy ' })).to.equal('crypto_buy');
    expect(activityProduct({})).to.equal('unknown');
  });
});
