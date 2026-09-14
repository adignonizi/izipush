import { Subscriber } from '../subscriber/subscriber.schema';
import { registerCrmIndex } from './crm-indexes';

/**
 * izipush-crm — champs du profil utilisés pour segmenter. Index partiels : seuls les subscribers
 * qui portent le champ y figurent (les subscribers Novu classiques n'alourdissent pas l'index).
 */
export const CRM_SEGMENTABLE_SUBSCRIBER_FIELDS = [
  'country_code',
  'kyc_status',
  'account_created_at',
  'last_tx_at',
  'last_login_at',
  'lifetime_tx',
  'lifetime_vol_usd',
] as const;

for (const field of CRM_SEGMENTABLE_SUBSCRIBER_FIELDS) {
  registerCrmIndex(
    Subscriber,
    { _environmentId: 1, [`data.${field}`]: 1 },
    { name: `crm_subscriber_${field}`, partialFilterExpression: { [`data.${field}`]: { $exists: true } } }
  );
}
