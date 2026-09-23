import { CRM_UNKNOWN_PRODUCT_ID, type CrmEventEntity, type CrmLifetimeBreakdown } from '@novu/dal';

type ProfileEvent = Pick<CrmEventEntity, 'eventName' | 'data' | 'occurredAt'>;

/** « latest » : la valeur du fait le plus récent l'emporte. « earliest » : le premier fait l'emporte. */
type FieldRule = 'latest' | 'earliest';

type FieldChange = { field: string; value: unknown; at: Date; rule: FieldRule };

export type ProfileUpdate = {
  /** Chemins à écrire sur le subscriber (« email », « data.kyc_status »…). */
  set: Record<string, unknown>;
  /** Nouvelles dates de fait par champ, à mémoriser. */
  fieldsAt: Record<string, Date>;
  /** Compte supprimé : effacer les tokens push pour qu'aucun envoi n'atteigne plus ses appareils. */
  clearPushCredentials: boolean;
};

/**
 * Traduit des événements en mise à jour du profil. Un champ n'est écrit que si le fait qui le porte
 * est plus récent (ou plus ancien, selon la règle) que celui qui a produit sa valeur actuelle.
 */
export function computeProfileUpdate(events: ProfileEvent[], currentFieldsAt: Record<string, Date>): ProfileUpdate {
  const fieldsAt: Record<string, Date> = { ...currentFieldsAt };
  const update: ProfileUpdate = { set: {}, fieldsAt: {}, clearPushCredentials: false };
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const event of ordered) {
    if (event.eventName === 'account.deleted') update.clearPushCredentials = true;

    for (const change of changesFor(event)) {
      const previous = fieldsAt[change.field] ? new Date(fieldsAt[change.field]) : undefined;
      const wins =
        !previous || (change.rule === 'latest' ? change.at.getTime() >= previous.getTime() : change.at < previous);

      if (!wins) continue;

      fieldsAt[change.field] = change.at;
      update.fieldsAt[change.field] = change.at;
      update.set[change.field] = change.value;
    }
  }

  return update;
}

/**
 * Compteurs posés à zéro sur un client qui n'a encore aucune activité.
 *
 * Sans eux, un client qui n'a jamais transigé ne porte simplement pas `lifetime_tx` ni `product_count` —
 * et un champ absent ne répond pas à « = 0 ». Les segments les plus utiles du plan Growth (« KYC validé
 * sans transaction », « n'utilise aucun produit ») ne trouveraient donc personne. Les vraies valeurs,
 * calculées ensuite depuis l'activité, les écrasent.
 */
export function zeroActivityDefaults(currentData: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {
    lifetime_tx: 0,
    lifetime_vol_usd: 0,
    products: [],
    product_count: 0,
  };
  const set: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(defaults)) {
    if (currentData[field] === undefined) set[`data.${field}`] = value;
  }

  return set;
}

/** État d'un client sur un produit : cumuls recalculés, dates de première et dernière transaction. */
export type CrmProductState = {
  tx: number;
  tx_failed: number;
  vol_usd: number;
  first_tx_at?: string;
  last_tx_at?: string;
  /** Produit obtenu sans encore avoir servi (`product.activated`). Conservé entre deux recalculs. */
  activated_at?: string;
};

/**
 * Le client est lié à ce produit : une transaction l'y lie, et une activation explicite aussi — un produit
 * obtenu mais jamais utilisé reste un produit détenu, et c'est même la cible d'activation la plus utile.
 */
function isLinked(product: CrmProductState): boolean {
  return product.tx > 0 || product.tx_failed > 0 || !!product.first_tx_at || !!product.activated_at;
}

/**
 * Champs dérivés des transactions : cumuls à vie, première et dernière transaction, et le lien du client
 * à ses produits. Un client est lié à un produit dès qu'il a tenté de l'utiliser — une transaction échouée
 * le lie aussi, elle dit qu'il a essayé. Les transactions sans produit sont rangées sous `unknown`,
 * un produit du catalogue comme un autre.
 */
export function computeTransactionFacts(
  events: Pick<CrmEventEntity, 'eventName' | 'occurredAt' | 'productId'>[],
  currentData: Record<string, unknown>,
  lifetime: CrmLifetimeBreakdown
): Record<string, unknown> {
  const set: Record<string, unknown> = {
    'data.lifetime_tx': lifetime.tx,
    'data.lifetime_vol_usd': round(lifetime.volUsd),
  };

  const completed = events.filter((event) => event.eventName === 'transaction.completed');

  for (const event of completed) {
    const at = event.occurredAt.toISOString();

    keepExtreme(set, currentData, 'last_tx_at', at, 'max');
    keepExtreme(set, currentData, 'first_tx_at', at, 'min');
  }

  const state = computeProductState(events, currentData, lifetime);
  const owned = Object.entries(state)
    .filter(([, product]) => isLinked(product))
    .map(([productId]) => productId)
    .sort();

  // Écrit d'un bloc : un chemin « data.product_state.X.tx » produirait une clé à points sur un profil
  // dont l'objet data n'existe pas encore, que Mongo refuse.
  set['data.product_state'] = state;
  set['data.products'] = owned;
  set['data.product_count'] = owned.length;

  return set;
}

/** Entrée vide d'un produit : ce que porte `unknown` sur un client qui n'a jamais transigé sans produit. */
function emptyProductState(): CrmProductState {
  return { tx: 0, tx_failed: 0, vol_usd: 0 };
}

/**
 * Réécrit l'état par produit à partir du cumul d'activité (autoritaire, recalculé) et des dates portées par
 * les événements. Rejouable : rien n'est incrémenté, le résultat ne dépend que du journal et de l'état des dates.
 *
 * `unknown` y figure toujours, même à zéro : l'objet `data.product_state` a donc au moins une entrée sur
 * tout client passé par la dérivation, et un template peut lire `data.product_state.unknown.*` sans garde.
 */
function computeProductState(
  events: Pick<CrmEventEntity, 'eventName' | 'occurredAt' | 'productId'>[],
  currentData: Record<string, unknown>,
  lifetime: CrmLifetimeBreakdown
): Record<string, CrmProductState> {
  const previous = (currentData.product_state ?? {}) as Record<string, Partial<CrmProductState>>;
  const state: Record<string, CrmProductState> = { [CRM_UNKNOWN_PRODUCT_ID]: emptyProductState() };

  // Un produit activé mais jamais utilisé n'a aucune ligne d'activité : sans ce report, chaque recalcul
  // le ferait disparaître du profil.
  for (const [productId, before] of Object.entries(previous)) {
    if (before?.activated_at) state[productId] = { ...emptyProductState(), activated_at: before.activated_at };
  }

  for (const product of lifetime.byProduct) {
    const before = previous[product.productId];

    state[product.productId] = {
      tx: product.tx,
      tx_failed: product.txFailed,
      vol_usd: round(product.volUsd),
      ...(before?.first_tx_at ? { first_tx_at: before.first_tx_at } : {}),
      ...(before?.last_tx_at ? { last_tx_at: before.last_tx_at } : {}),
      ...(before?.activated_at ? { activated_at: before.activated_at } : {}),
    };
  }

  for (const event of events) {
    const productId = event.productId ?? CRM_UNKNOWN_PRODUCT_ID;
    state[productId] ??= emptyProductState();
    const product = state[productId];
    const at = event.occurredAt.toISOString();

    if (event.eventName === 'product.activated') {
      // La plus ancienne activation fait foi : un rejeu ne doit pas rajeunir la date.
      if (!product.activated_at || at < product.activated_at) product.activated_at = at;
      continue;
    }

    if (event.eventName !== 'transaction.completed') continue;

    if (!product.first_tx_at || at < product.first_tx_at) product.first_tx_at = at;
    if (!product.last_tx_at || at > product.last_tx_at) product.last_tx_at = at;
  }

  return state;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function keepExtreme(
  set: Record<string, unknown>,
  currentData: Record<string, unknown>,
  field: string,
  candidate: string,
  mode: 'min' | 'max'
): void {
  const path = `data.${field}`;
  const current = (set[path] as string | undefined) ?? (currentData[field] as string | undefined);
  const better = !current || (mode === 'max' ? candidate > current : candidate < current);

  if (better) set[path] = candidate;
}

function changesFor(event: ProfileEvent): FieldChange[] {
  const at = event.occurredAt;
  const data = event.data ?? {};
  const latest = (field: string, value: unknown): FieldChange[] =>
    value === undefined ? [] : [{ field, value, at, rule: 'latest' }];

  switch (event.eventName) {
    case 'account.registered':
      return [
        ...identityChanges(data, at),
        { field: 'data.account_created_at', value: at.toISOString(), at, rule: 'earliest' },
      ];
    case 'account.profile_updated':
      return identityChanges(data, at);
    case 'account.email_updated':
      return latest('email', text(data.updated_email));
    case 'account.logged_in':
      return latest('data.last_login_at', at.toISOString());
    case 'kyc.validated':
      return [...latest('data.kyc_status', 'validated'), ...latest('data.kyc_validated_at', at.toISOString())];
    default:
      return [];
  }
}

/**
 * Identité : champs natifs Novu + pays.
 *
 * Plusieurs noms sont acceptés pour chaque champ, et ce n'est pas de la complaisance : **Keycloak émet ses
 * `details` en snake_case** (`first_name` à l'inscription, `updated_first_name` à la mise à jour du profil),
 * là où un message RabbitMQ d'Izichange arrive en camelCase. Ne lire que l'une des deux formes ferait
 * silencieusement disparaître le prénom et le nom de tous les comptes créés via Keycloak.
 */
function identityChanges(data: Record<string, unknown>, at: Date): FieldChange[] {
  const country = text(data.country_code ?? data.countryCode ?? data.country)?.toUpperCase();
  const candidates: [string, unknown][] = [
    ['firstName', text(data.firstName ?? data.first_name ?? data.updated_first_name)],
    ['lastName', text(data.lastName ?? data.last_name ?? data.updated_last_name)],
    ['email', text(data.email ?? data.updated_email)],
    ['phone', text(data.phone ?? data.phoneNumber ?? data.phone_number)],
    ['locale', text(data.locale ?? data.language)],
    // Champ natif Novu : c'est lui qui permettra d'envoyer à l'heure locale du client.
    ['timezone', text(data.timezone ?? data.time_zone)],
    ['data.country_code', country],
  ];

  return candidates
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => ({ field, value, at, rule: 'latest' as const }));
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed || undefined;
}
