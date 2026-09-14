import type { CrmActivityMetric, CrmProfileOperator } from './crm-fields';

/** Condition sur un champ du profil (catalogue CRM_PROFILE_FIELDS). */
export type CrmProfileCondition = {
  type: 'profile';
  field: string;
  operator: CrmProfileOperator;
  value?: unknown;
};

/**
 * Condition sur l'activité d'une fenêtre glissante (ex. volume crypto des 30 derniers jours > 500 USD).
 * Seulement « > » ou « ≥ » une valeur positive : un client sans activité n'a aucune ligne à compter
 * (l'inactivité se cible avec la date de dernière transaction).
 */
export type CrmActivityCondition = {
  type: 'activity';
  metric: CrmActivityMetric;
  windowDays: number;
  product?: string;
  operator: 'gt' | 'gte';
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
