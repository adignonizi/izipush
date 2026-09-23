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
  // data.products est un tableau : Mongo en fait un index multiclé, une entrée par produit du client.
  // Il couvre « utilise le produit X » ($eq), « utilise X et Y » ($all) et « utilise X ou Y » ($in).
  'products',
  'product_count',
] as const;

/**
 * La langue n'est pas sous `data` : elle a son propre index. Chaque segment du plan Growth existe en
 * français et en anglais, c'est donc un filtre présent sur presque toutes les audiences.
 */
registerCrmIndex(
  Subscriber,
  { _environmentId: 1, locale: 1 },
  { name: 'crm_subscriber_locale', partialFilterExpression: { locale: { $exists: true } } }
);

for (const field of CRM_SEGMENTABLE_SUBSCRIBER_FIELDS) {
  registerCrmIndex(
    Subscriber,
    { _environmentId: 1, [`data.${field}`]: 1 },
    { name: `crm_subscriber_${field}`, partialFilterExpression: { [`data.${field}`]: { $exists: true } } }
  );
}
