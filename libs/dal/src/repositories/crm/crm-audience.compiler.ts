import type { CrmActivityCondition, CrmCondition, CrmConditionGroup, CrmProfileCondition } from './crm-audience.types';
import { CRM_ACTIVITY_METRICS, CRM_OPERATORS_BY_TYPE, CrmFieldDefinition, findCrmProfileField } from './crm-fields';

/** Conditions invalides : message destiné à la personne qui construit le segment. */
export class CrmAudienceError extends Error {}

export type CompiledAudience = {
  /** Filtre Mongo sur la collection subscribers. */
  profileFilter: Record<string, unknown>;
  /** Conditions d'activité, toutes combinées en ET avec le filtre de profil. */
  activityConditions: CrmActivityCondition[];
};

const DAY_MS = 24 * 3600 * 1000;
const MAX_CONDITIONS = 50;
const MAX_DEPTH = 5;
const MAX_WINDOW_DAYS = 3650;

/**
 * Traduit l'arbre de conditions d'un segment en requêtes Mongo.
 * Les conditions d'activité ne sont admises qu'au premier niveau d'un groupe « ET ».
 */
export function compileAudience(audience: CrmConditionGroup, now: Date): CompiledAudience {
  if (audience?.type !== 'group') throw new CrmAudienceError('Le segment doit être un groupe de conditions');

  let count = 0;
  const countConditions = (group: CrmConditionGroup, depth: number) => {
    if (depth > MAX_DEPTH) throw new CrmAudienceError(`Pas plus de ${MAX_DEPTH} niveaux de groupes`);
    for (const condition of group.conditions ?? []) {
      count++;
      if (condition.type === 'group') countConditions(condition, depth + 1);
    }
  };
  countConditions(audience, 1);
  if (count > MAX_CONDITIONS) throw new CrmAudienceError(`Pas plus de ${MAX_CONDITIONS} conditions`);

  const conditions = audience.conditions ?? [];
  const activityConditions = conditions.filter(isActivity);

  if (activityConditions.length && audience.combinator !== 'and') {
    throw new CrmAudienceError("Les conditions d'activité ne se combinent qu'avec « ET »");
  }
  activityConditions.forEach(validateActivity);

  const profileParts = conditions.filter((condition) => !isActivity(condition)).map((c) => compileNode(c, now));

  return { profileFilter: combine(audience.combinator, profileParts), activityConditions };
}

/**
 * Agrégation sur crm_activity_daily : identifiants des clients qui remplissent toutes les conditions d'activité.
 * N'ouvre que les lignes de la plus grande fenêtre (index {_environmentId, day}).
 */
export function compileActivityPipeline(
  environmentId: unknown,
  conditions: CrmActivityCondition[],
  now: Date
): Record<string, unknown>[] {
  const starts = conditions.map((condition) => dayKey(new Date(now.getTime() - (condition.windowDays - 1) * DAY_MS)));
  const earliest = starts.reduce((min, day) => (day < min ? day : min));

  const group: Record<string, unknown> = { _id: '$subscriberId' };
  const match: Record<string, unknown> = {};

  conditions.forEach((condition, index) => {
    const inWindow: unknown[] = [{ $gte: ['$day', starts[index]] }];
    if (condition.product) inWindow.push({ $eq: ['$product', condition.product] });

    group[`m${index}`] = { $sum: { $cond: [{ $and: inWindow }, `$${condition.metric}`, 0] } };
    match[`m${index}`] = { [`$${condition.operator}`]: condition.value };
  });

  return [
    { $match: { _environmentId: environmentId, day: { $gte: earliest } } },
    { $group: group },
    { $match: match },
    { $project: { _id: 1 } },
  ];
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isActivity(condition: CrmCondition): condition is CrmActivityCondition {
  return condition?.type === 'activity';
}

function compileNode(condition: CrmCondition, now: Date): Record<string, unknown> {
  if (condition?.type === 'group') {
    if (condition.conditions?.some(isActivity)) {
      throw new CrmAudienceError("Les conditions d'activité ne peuvent pas être dans un sous-groupe");
    }

    return combine(
      condition.combinator,
      (condition.conditions ?? []).map((child) => compileNode(child, now))
    );
  }

  if (condition?.type === 'profile') return compileProfile(condition, now);

  throw new CrmAudienceError('Type de condition inconnu');
}

function compileProfile(condition: CrmProfileCondition, now: Date): Record<string, unknown> {
  const field = findCrmProfileField(condition.field);
  if (!field) throw new CrmAudienceError(`Champ inconnu : ${condition.field}`);
  if (!CRM_OPERATORS_BY_TYPE[field.type].includes(condition.operator)) {
    throw new CrmAudienceError(`Opérateur « ${condition.operator} » impossible sur « ${field.label} »`);
  }

  const { path } = field;

  switch (condition.operator) {
    case 'exists':
      return { [path]: { $exists: true } };
    case 'not_exists':
      return { [path]: { $exists: false } };
    case 'eq':
      return { [path]: scalar(field, condition.value) };
    case 'ne':
      return { [path]: { $ne: scalar(field, condition.value) } };
    case 'in':
    case 'nin':
      return { [path]: { [`$${condition.operator}`]: list(field, condition.value) } };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { [path]: { [`$${condition.operator}`]: comparable(field, condition.value) } };
    case 'within_last_days':
      return { [path]: { $gte: daysAgo(now, condition.value, field) } };
    case 'more_than_days_ago':
      return { [path]: { $lt: daysAgo(now, condition.value, field) } };
    default:
      throw new CrmAudienceError(`Opérateur inconnu : ${condition.operator}`);
  }
}

function validateActivity(condition: CrmActivityCondition): void {
  if (!CRM_ACTIVITY_METRICS.some((metric) => metric.key === condition.metric)) {
    throw new CrmAudienceError(`Mesure d'activité inconnue : ${condition.metric}`);
  }
  if (!Number.isInteger(condition.windowDays) || condition.windowDays < 1 || condition.windowDays > MAX_WINDOW_DAYS) {
    throw new CrmAudienceError(`Fenêtre d'activité invalide (1 à ${MAX_WINDOW_DAYS} jours)`);
  }
  if (condition.operator !== 'gt' && condition.operator !== 'gte') {
    throw new CrmAudienceError("Une condition d'activité s'exprime avec « > » ou « ≥ »");
  }
  if (typeof condition.value !== 'number' || !Number.isFinite(condition.value) || condition.value < 0) {
    throw new CrmAudienceError("Valeur d'activité invalide");
  }
  if (condition.operator === 'gte' && condition.value === 0) {
    throw new CrmAudienceError('« ≥ 0 » inclut les clients sans activité : utilisez la date de dernière transaction');
  }
}

function scalar(field: CrmFieldDefinition, value: unknown): unknown {
  switch (field.type) {
    case 'number':
      return comparable(field, value);
    case 'boolean':
      if (typeof value !== 'boolean') throw new CrmAudienceError(`« ${field.label} » attend oui ou non`);

      return value;
    case 'date':
      return comparable(field, value);
    default:
      if (typeof value !== 'string' || !value.trim()) {
        throw new CrmAudienceError(`« ${field.label} » attend une valeur`);
      }

      return field.key === 'country_code' ? value.trim().toUpperCase() : value.trim();
  }
}

function list(field: CrmFieldDefinition, value: unknown): unknown[] {
  if (!Array.isArray(value) || !value.length) throw new CrmAudienceError(`« ${field.label} » attend une liste`);

  return value.map((item) => scalar(field, item));
}

function comparable(field: CrmFieldDefinition, value: unknown): number | string {
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CrmAudienceError(`« ${field.label} » attend un nombre`);
    }

    return value;
  }

  if (field.type === 'date') {
    const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : undefined;
    if (!date || Number.isNaN(date.getTime())) throw new CrmAudienceError(`« ${field.label} » attend une date`);

    // Les dates du profil sont stockées en ISO 8601 UTC : la comparaison de chaînes suit l'ordre chronologique.
    return date.toISOString();
  }

  throw new CrmAudienceError(`Comparaison impossible sur « ${field.label} »`);
}

function daysAgo(now: Date, value: unknown, field: CrmFieldDefinition): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_WINDOW_DAYS) {
    throw new CrmAudienceError(`« ${field.label} » attend un nombre de jours (1 à ${MAX_WINDOW_DAYS})`);
  }

  return new Date(now.getTime() - value * DAY_MS).toISOString();
}

function combine(combinator: 'and' | 'or', parts: Record<string, unknown>[]): Record<string, unknown> {
  if (combinator !== 'and' && combinator !== 'or') throw new CrmAudienceError('Combinaison « et » ou « ou » attendue');

  const nonEmpty = parts.filter((part) => Object.keys(part).length);

  // Un sous-groupe vide ne restreint rien : dans un « OU », il rend donc tout le monde éligible.
  if (combinator === 'or' && nonEmpty.length < parts.length) return {};
  if (!nonEmpty.length) return {};
  if (nonEmpty.length === 1) return nonEmpty[0];

  return { [`$${combinator}`]: nonEmpty };
}
