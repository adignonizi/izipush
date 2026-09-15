import type { CrmActivityMetric, CrmActivityOperator, CrmProfileOperator } from './crm-fields';

/** Condition sur un champ du profil (catalogue CRM_PROFILE_FIELDS). */
export type CrmProfileCondition = {
  type: 'profile';
  field: string;
  operator: CrmProfileOperator;
  value?: unknown;
};

/**
 * Condition sur l'activité d'une fenêtre glissante (ex. volume crypto des 30 derniers jours > 500 USD).
 * Un client sans aucune activité sur la fenêtre compte pour 0 : « = 0 », « ≤ 5 » ou « < 10 » l'incluent.
 */
export type CrmActivityCondition = {
  type: 'activity';
  metric: CrmActivityMetric;
  windowDays: number;
  product?: string;
  operator: CrmActivityOperator;
  value: number;
};

export type CrmConditionGroup = {
  type: 'group';
  combinator: 'and' | 'or';
  conditions: CrmCondition[];
};

export type CrmCondition = CrmProfileCondition | CrmActivityCondition | CrmConditionGroup;

/** Membre d'une audience : identifiant interne Novu et identifiant client. */
export type CrmAudienceMember = { _id: string; subscriberId: string };
