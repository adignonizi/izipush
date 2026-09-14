import type { CrmEventEntity, CrmLifetimeActivity } from '@novu/dal';

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

/** Champs dérivés des transactions : cumuls à vie, première et dernière transaction (globales et par produit). */
export function computeTransactionFacts(
  events: Pick<CrmEventEntity, 'eventName' | 'occurredAt' | 'product'>[],
  currentData: Record<string, unknown>,
  lifetime: CrmLifetimeActivity
): Record<string, unknown> {
  const set: Record<string, unknown> = {
    'data.lifetime_tx': lifetime.tx,
    'data.lifetime_vol_usd': Math.round(lifetime.volUsd * 100) / 100,
  };

  const completed = events.filter((event) => event.eventName === 'transaction.completed');

  for (const event of completed) {
    const at = event.occurredAt.toISOString();

    keepExtreme(set, currentData, 'last_tx_at', at, 'max');
    keepExtreme(set, currentData, 'first_tx_at', at, 'min');
    keepExtreme(set, currentData, `first_tx_at_${event.product ?? 'unknown'}`, at, 'min');
  }

  return set;
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
    case 'account.deleted':
      return latest('data.isDeleted', true);
    case 'account.logged_in':
      return latest('data.last_login_at', at.toISOString());
    case 'kyc.submitted':
      return latest('data.kyc_status', 'submitted');
    case 'kyc.approved':
      return [...latest('data.kyc_status', 'validated'), ...latest('data.kyc_validated_at', at.toISOString())];
    case 'kyc.rejected':
      return [
        ...latest('data.kyc_status', 'rejected'),
        ...latest('data.kyc_rejection_reason', text(data.reason) ?? null),
      ];
    case 'consent.marketing_updated':
      return latest('data.marketing_optin', typeof data.optIn === 'boolean' ? data.optIn : undefined);
    default:
      return [];
  }
}

/** Identité : champs natifs Novu + pays. Plusieurs noms acceptés tant que le format Izichange n'est pas figé. */
function identityChanges(data: Record<string, unknown>, at: Date): FieldChange[] {
  const country = text(data.country_code ?? data.countryCode ?? data.country)?.toUpperCase();
  const candidates: [string, unknown][] = [
    ['firstName', text(data.firstName)],
    ['lastName', text(data.lastName)],
    ['email', text(data.email)],
    ['phone', text(data.phone ?? data.phoneNumber)],
    ['locale', text(data.locale ?? data.language)],
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
