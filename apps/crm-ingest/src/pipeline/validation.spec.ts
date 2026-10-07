import { expect } from 'chai';

import { activityDay, activityProductId, CrmValidationError, validateEventData } from './validation';

describe('validateEventData', () => {
  it('normalise le montant et le rang d’une transaction', () => {
    const data = validateEventData('transaction.completed', { amount_usd: '120.50', txNo: '3', extra: 'gardé' });

    expect(data).to.deep.include({ amount_usd: 120.5, txNo: 3, extra: 'gardé' });
  });

  it('refuse un montant non numérique, négatif, ou absent', () => {
    for (const payload of [{ amount_usd: 'abc' }, { amount_usd: -3 }, { type: 'buy' }]) {
      expect(() => validateEventData('transaction.completed', payload)).to.throw(CrmValidationError);
    }
  });

  it('le rang est facultatif, mais doit être un entier positif', () => {
    expect(validateEventData('transaction.completed', { amount_usd: 10 })).to.not.have.property('txNo');
    expect(() => validateEventData('transaction.completed', { amount_usd: 10, txNo: 0 })).to.throw(CrmValidationError);
    expect(() => validateEventData('transaction.completed', { amount_usd: 10, txNo: 1.5 })).to.throw(
      CrmValidationError
    );
  });

  it('exige la nouvelle adresse pour un changement d’email', () => {
    expect(() => validateEventData('account.email_updated', { email: 'old@example.com' })).to.throw(CrmValidationError);
  });

  it('les événements sans payload attendu passent tels quels', () => {
    for (const nom of ['kyc.validated', 'product.activated', 'account.logged_in'] as const) {
      expect(validateEventData(nom, {})).to.deep.equal({});
    }
  });
});

describe('identifiant de produit', () => {
  it('jour UTC, et code produit de l’enveloppe repris tel quel', () => {
    expect(activityDay(new Date('2026-06-09T23:59:59.000Z'))).to.equal('2026-06-09');
    expect(activityProductId(' 7f3c8a12 ')).to.equal('7f3c8a12');
    expect(activityProductId(42)).to.equal('42');
  });

  it('sans code produit, l’activité est rangée sous « unknown »', () => {
    expect(activityProductId(undefined)).to.equal('unknown');
    expect(activityProductId('   ')).to.equal('unknown');
  });

  it('un identifiant long reste un identifiant, jusqu’à 225 caractères', () => {
    const long = 'x'.repeat(225);

    expect(activityProductId(long)).to.equal(long);
    expect(activityProductId('x'.repeat(226))).to.equal('unknown');
  });
});
