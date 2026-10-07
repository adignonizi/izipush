import {
  CRM_QUOTA_WINDOWS,
  CrmEmailQuotaError,
  crmQuotaArgs,
  crmQuotaKeys,
  crmQuotaRetryDelay,
  isCrmEmailQuotaError,
} from '@novu/dal';
import { expect } from 'chai';

describe('limites des fournisseurs email', () => {
  it('une clé par fenêtre, sur le même slot Redis, qui change à chaque nouvelle fenêtre', () => {
    const at = Date.UTC(2026, 8, 14, 10, 0, 30);
    const keys = crmQuotaKeys('int1', at);

    expect(keys).to.have.length(CRM_QUOTA_WINDOWS.length);
    expect(keys.every((key) => key.startsWith('{crm:email-quota:int1}:'))).to.equal(true);
    expect(crmQuotaKeys('int1', at + 20_000)[0]).to.equal(keys[0]);
    expect(crmQuotaKeys('int1', at + 40_000)[0]).to.not.equal(keys[0]);
  });

  it('limite vide = 0 (compté sans limite), durée de vie un peu plus longue que la fenêtre', () => {
    expect(crmQuotaArgs({ perMinute: 100, perHour: null })).to.deep.equal([100, 120_000, 0, 3_660_000, 0, 86_460_000]);
  });

  it('l’erreur « tous pleins » est reconnue par le worker et porte son délai', () => {
    const error = new CrmEmailQuotaError(42_500.4);
    const copied = new Error(error.message); // ce qu'il reste après sérialisation BullMQ

    expect(isCrmEmailQuotaError(copied)).to.equal(true);
    expect(crmQuotaRetryDelay(copied)).to.equal(42_500);
    expect(isCrmEmailQuotaError(new Error('autre'))).to.equal(false);
    expect(crmQuotaRetryDelay(new CrmEmailQuotaError(10))).to.equal(1000);
  });
});
