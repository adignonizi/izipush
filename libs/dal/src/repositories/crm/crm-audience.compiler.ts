import type { CrmActivityCondition, CrmCondition, CrmConditionGroup, CrmProfileCondition } from './crm-audience.types';
import {
  CRM_ACTIVITY_METRICS,
  CRM_ACTIVITY_OPERATORS,
  CRM_OPERATORS_BY_TYPE,
  CrmActivityOperator,
  CrmFieldDefinition,
  findCrmProfileField,
} from './crm-fields';

/** Conditions invalides : message destiné à la personne qui construit le segment. */
export class CrmAudienceError extends Error {}

export type CompiledAudience = {
  /** Filtre Mongo sur la collection subscribers. */
  profileFilter: Record<string, unknown>;
  /**
   * Conditions d'activité lues depuis les lignes d'activité (au moins une ne peut pas être remplie par un client
   * sans activité : on part donc des clients qui ont des lignes). Toutes combinées en ET avec le profil.
   */
  activityConditions: CrmActivityCondition[];
  /**
   * Conditions qu'un client sans activité remplit (« = 0 », « ≤ 5 »…), quand il n'y a aucune condition du type
   * précédent : on parcourt les clients du profil en écartant ceux dont l'activité ne les remplit pas.
   */
  exclusionConditions: CrmActivityCondition[];
};

const DAY_MS = 24 * 3600 * 1000;
const MAX_CONDITIONS = 50;
const MAX_DEPTH = 5;
const MAX_WINDOW_DAYS = 3650;

const NEGATION: Record<CrmActivityOperator, string> = { gt: '$lte', gte: '$lt', lt: '$gte', lte: '$gt', eq: '$ne' };

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
  const activity = conditions.filter(isActivity);

  if (activity.length && audience.combinator !== 'and') {
    throw new CrmAudienceError("Les conditions d'activité ne se combinent qu'avec « ET »");
  }
  activity.forEach(validateActivity);

  const profileParts = conditions.filter((condition) => !isActivity(condition)).map((c) => compileNode(c, now));
  const fromRows: CrmActivityCondition[] = [];
  const zeroInclusive: CrmActivityCondition[] = [];

  for (const condition of activity) {
    if (!acceptsZero(condition)) fromRows.push(condition);
    else if (isNoTransaction(condition)) profileParts.push(noTransactionFilter(condition, now));
    else zeroInclusive.push(condition);
  }

  rejectLoneSetNegation(conditions);

  const profileFilter = combine(audience.combinator, profileParts);

  // Une condition impossible sans activité suffit à partir des lignes d'activité : les autres s'y testent aussi.
  if (fromRows.length)
    return { profileFilter, activityConditions: [...fromRows, ...zeroInclusive], exclusionConditions: [] };

  return { profileFilter, activityConditions: [], exclusionConditions: zeroInclusive };
}

/**
 * Agrégation sur crm_activity_daily, une somme par condition sur la plus grande fenêtre (index {_environmentId, day}).
 * « include » : clients qui remplissent toutes les conditions. « exclude » : clients qui en ratent au moins une,
 * triés par identifiant pour être écartés au fil de l'eau d'une liste de clients triée de la même façon.
 */
export function compileActivityPipeline(
  environmentId: unknown,
  conditions: CrmActivityCondition[],
  now: Date,
  mode: 'include' | 'exclude' = 'include'
): Record<string, unknown>[] {
  const starts = conditions.map((condition) => windowStart(condition, now));
  const earliest = starts.reduce((min, day) => (day < min ? day : min));

  const group: Record<string, unknown> = { _id: '$subscriberId' };
  const tests: Record<string, unknown>[] = [];

  conditions.forEach((condition, index) => {
    const inWindow: unknown[] = [{ $gte: ['$day', starts[index]] }];
    if (condition.productId) inWindow.push({ $eq: ['$productId', condition.productId] });

    group[`m${index}`] = { $sum: { $cond: [{ $and: inWindow }, `$${condition.metric}`, 0] } };
    const operator = mode === 'include' ? `$${condition.operator}` : NEGATION[condition.operator];
    tests.push({ [`m${index}`]: { [operator]: condition.value } });
  });

  return [
    { $match: { _environmentId: environmentId, day: { $gte: earliest } } },
    { $group: group },
    { $match: mode === 'include' ? Object.assign({}, ...tests) : { $or: tests } },
    ...(mode === 'exclude' ? [{ $sort: { _id: 1 } }] : []),
    { $project: { _id: 1 } },
  ];
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function windowStart(condition: CrmActivityCondition, now: Date): string {
  return dayKey(new Date(now.getTime() - (condition.windowDays - 1) * DAY_MS));
}

function isActivity(condition: CrmCondition): condition is CrmActivityCondition {
  return condition?.type === 'activity';
}

/** Vrai si un client sans aucune activité (somme = 0) remplit la condition. */
function acceptsZero(condition: CrmActivityCondition): boolean {
  switch (condition.operator) {
    case 'lt':
    case 'lte':
      return true;
    case 'eq':
      return condition.value === 0;
    default:
      return false;
  }
}

/** « Aucune transaction réussie sur la fenêtre », tous produits : se lit sur la date de dernière transaction. */
function isNoTransaction(condition: CrmActivityCondition): boolean {
  if (condition.productId || (condition.metric !== 'tx' && condition.metric !== 'volUsd')) return false;
  if ((condition.operator === 'eq' || condition.operator === 'lte') && condition.value === 0) return true;

  // Les transactions se comptent en entiers : « moins de 1 » veut dire aucune.
  return condition.metric === 'tx' && condition.operator === 'lt' && condition.value <= 1;
}

function noTransactionFilter(condition: CrmActivityCondition, now: Date): Record<string, unknown> {
  const cutoff = `${windowStart(condition, now)}T00:00:00.000Z`;

  return { $or: [{ 'data.last_tx_at': { $lt: cutoff } }, { 'data.last_tx_at': { $exists: false } }] };
}

/**
 * « N'a pas le produit X » ne se lit pas sur un index : un index multiclé ne sait pas retrouver les documents
 * où une valeur est absente, Mongo parcourt donc tout le fichier client. Combinée à une autre condition la
 * négation ne coûte rien (elle filtre un ensemble déjà réduit) ; seule, elle est refusée.
 */
function rejectLoneSetNegation(conditions: CrmCondition[]): void {
  const lone = conditions.length === 1 ? conditions[0] : undefined;
  if (lone?.type !== 'profile' || lone.operator !== 'has_not') return;

  throw new CrmAudienceError(
    "« N'a pas ce produit » ne peut pas être la seule condition : ajoutez un produit utilisé, un pays ou un statut KYC"
  );
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
    // Champs « set » : data.products porte les produits du client, un index multiclé les couvre.
    case 'has':
      return { [path]: scalar(field, condition.value) };
    case 'has_not':
      return { [path]: { $ne: scalar(field, condition.value) } };
    case 'has_all':
      return { [path]: { $all: list(field, condition.value) } };
    case 'has_any':
      return { [path]: { $in: list(field, condition.value) } };
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
  if (!(CRM_ACTIVITY_OPERATORS as readonly string[]).includes(condition.operator)) {
    throw new CrmAudienceError(`Opérateur d'activité inconnu : ${condition.operator}`);
  }
  if (typeof condition.value !== 'number' || !Number.isFinite(condition.value) || condition.value < 0) {
    throw new CrmAudienceError("Valeur d'activité invalide");
  }
  if (condition.operator === 'gte' && condition.value === 0) {
    throw new CrmAudienceError('« au moins 0 » vise tous les clients : retirez la condition');
  }
  if (condition.operator === 'lt' && condition.value === 0) {
    throw new CrmAudienceError('« inférieur à 0 » ne vise aucun client');
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
