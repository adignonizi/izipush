/**
 * izipush-crm — catalogue des champs proposés dans le constructeur de segments.
 * Déclaré dans le code : un champ n'est ciblable que s'il est calculé par crm-ingest (et indexé s'il est fréquent).
 */
export type CrmFieldType = 'string' | 'enum' | 'number' | 'date' | 'boolean' | 'set';

export type CrmProfileOperator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'not_exists'
  | 'within_last_days'
  | 'more_than_days_ago'
  // Champs « set » (data.products) : appartenance à une liste portée par le profil.
  | 'has'
  | 'has_not'
  | 'has_all'
  | 'has_any';

export type CrmFieldDefinition = {
  key: string;
  label: string;
  /** Chemin sur le document subscriber. */
  path: string;
  type: CrmFieldType;
  values?: { value: string; label: string }[];
  /** Champ « set » dont les valeurs viennent du catalogue produits, pas d'une liste écrite en dur. */
  valuesFrom?: 'products';
};

export const CRM_OPERATORS_BY_TYPE: Record<CrmFieldType, CrmProfileOperator[]> = {
  string: ['eq', 'ne', 'in', 'nin', 'exists', 'not_exists'],
  enum: ['eq', 'ne', 'in', 'nin', 'exists', 'not_exists'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists'],
  date: ['within_last_days', 'more_than_days_ago', 'gt', 'lt', 'exists', 'not_exists'],
  boolean: ['eq', 'exists', 'not_exists'],
  set: ['has', 'has_not', 'has_all', 'has_any', 'exists', 'not_exists'],
};

const COUNTRIES = [
  ['BJ', 'Bénin'],
  ['BF', 'Burkina Faso'],
  ['CI', "Côte d'Ivoire"],
  ['GW', 'Guinée-Bissau'],
  ['ML', 'Mali'],
  ['NE', 'Niger'],
  ['SN', 'Sénégal'],
  ['TG', 'Togo'],
  ['CM', 'Cameroun'],
  ['GA', 'Gabon'],
  ['GN', 'Guinée'],
  ['CD', 'RD Congo'],
].map(([value, label]) => ({ value, label }));

export const CRM_PROFILE_FIELDS: CrmFieldDefinition[] = [
  { key: 'country_code', label: 'Pays', path: 'data.country_code', type: 'enum', values: COUNTRIES },
  {
    key: 'kyc_status',
    label: 'Statut KYC',
    path: 'data.kyc_status',
    type: 'enum',
    values: [
      { value: 'submitted', label: 'En cours' },
      { value: 'validated', label: 'Validé' },
      { value: 'rejected', label: 'Rejeté' },
    ],
  },
  { key: 'account_created_at', label: "Date d'inscription", path: 'data.account_created_at', type: 'date' },
  { key: 'kyc_validated_at', label: 'Date de validation KYC', path: 'data.kyc_validated_at', type: 'date' },
  { key: 'first_tx_at', label: 'Première transaction', path: 'data.first_tx_at', type: 'date' },
  { key: 'last_tx_at', label: 'Dernière transaction', path: 'data.last_tx_at', type: 'date' },
  { key: 'last_login_at', label: 'Dernière connexion', path: 'data.last_login_at', type: 'date' },
  { key: 'lifetime_tx', label: 'Transactions (depuis toujours)', path: 'data.lifetime_tx', type: 'number' },
  { key: 'lifetime_vol_usd', label: 'Volume USD (depuis toujours)', path: 'data.lifetime_vol_usd', type: 'number' },
  { key: 'marketing_optin', label: 'Accepte le marketing', path: 'data.marketing_optin', type: 'boolean' },
  {
    key: 'products',
    label: 'Produits utilisés',
    path: 'data.products',
    type: 'set',
    valuesFrom: 'products',
  },
  { key: 'product_count', label: 'Nombre de produits', path: 'data.product_count', type: 'number' },
  { key: 'email', label: 'Email', path: 'email', type: 'string' },
  { key: 'locale', label: 'Langue', path: 'locale', type: 'string' },
];

export type CrmActivityMetric = 'tx' | 'volUsd' | 'txFailed';

/** Un client sans activité sur la fenêtre compte pour 0 : « lt », « lte » et « eq 0 » l'incluent. */
export const CRM_ACTIVITY_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const;

export type CrmActivityOperator = (typeof CRM_ACTIVITY_OPERATORS)[number];

export const CRM_ACTIVITY_METRICS: { key: CrmActivityMetric; label: string }[] = [
  { key: 'tx', label: 'Transactions réussies' },
  { key: 'volUsd', label: 'Volume (USD)' },
  { key: 'txFailed', label: 'Transactions échouées' },
];

/**
 * Événements reçus d'Izichange et traités par crm-ingest ; déclencheurs possibles d'une campagne
 * « sur événement ». Contrat : docs/izichangedocs/contrat-evenements.md.
 *
 * Tout nom absent de cette liste est acquitté et ignoré : le catalogue métier d'Izichange en compte
 * beaucoup d'autres, mais le CRM compose lui-même tout ce qui se déduit de ces faits.
 */
export const CRM_EVENT_NAMES = [
  'account.registered',
  'account.profile_updated',
  'account.email_updated',
  'account.logged_in',
  'kyc.validated',
  'transaction.completed',
  'product.activated',
] as const;

export type CrmEventName = (typeof CRM_EVENT_NAMES)[number];

export function findCrmProfileField(key: string): CrmFieldDefinition | undefined {
  return CRM_PROFILE_FIELDS.find((field) => field.key === key);
}
