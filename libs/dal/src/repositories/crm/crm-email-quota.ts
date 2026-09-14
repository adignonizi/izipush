/**
 * izipush-crm — limites d'envoi des fournisseurs email, comptées dans Redis par fenêtre fixe
 * (minute, heure, jour). Partagé par le worker (qui réserve un envoi) et l'API (qui affiche les compteurs).
 */
export type CrmQuotaWindow = { name: 'minute' | 'hour' | 'day'; seconds: number; limitField: CrmQuotaLimitField };

export type CrmQuotaLimitField = 'perMinute' | 'perHour' | 'perDay';

export const CRM_QUOTA_WINDOWS: CrmQuotaWindow[] = [
  { name: 'minute', seconds: 60, limitField: 'perMinute' },
  { name: 'hour', seconds: 3600, limitField: 'perHour' },
  { name: 'day', seconds: 86_400, limitField: 'perDay' },
];

/** Clés des compteurs de la fenêtre en cours ; le hash tag garde les trois sur le même slot Redis Cluster. */
export function crmQuotaKeys(integrationId: string, now = Date.now()): string[] {
  return CRM_QUOTA_WINDOWS.map(
    (window) => `{crm:email-quota:${integrationId}}:${window.name}:${Math.floor(now / 1000 / window.seconds)}`
  );
}

/**
 * Réserve un envoi si aucune limite n'est atteinte : tout ou rien, en un seul aller-retour.
 * ARGV = limite, durée de vie (ms) pour chaque clé ; limite 0 = pas de limite (compté quand même, pour le suivi).
 * Retour : { 1, 0 } réservé, ou { 0, ms avant la fin de la fenêtre pleine, index de cette fenêtre }.
 */
export const CRM_QUOTA_RESERVE_LUA = `
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i * 2 - 1])
  if limit > 0 then
    local current = tonumber(redis.call('GET', key) or '0')
    if current >= limit then
      local ttl = redis.call('PTTL', key)
      if ttl < 0 then ttl = 1000 end
      return { 0, ttl, i }
    end
  end
end
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, tonumber(ARGV[i * 2])) end
end
return { 1, 0, 0 }
`;

export const CRM_QUOTA_READ_LUA = `return redis.call('MGET', unpack(KEYS))`;

export type CrmQuotaLimits = Partial<Record<CrmQuotaLimitField, number | null>>;

export function crmQuotaArgs(limits: CrmQuotaLimits): number[] {
  return CRM_QUOTA_WINDOWS.flatMap((window) => [
    Math.max(0, Math.floor(limits[window.limitField] ?? 0)),
    // Un peu plus que la fenêtre : la clé suivante prend le relais, celle-ci expire seule.
    (window.seconds + 60) * 1000,
  ]);
}

const QUOTA_ERROR_PREFIX = 'CRM_EMAIL_QUOTA_EXHAUSTED';

/**
 * Tous les fournisseurs de campagne sont à leur limite : le job est relancé plus tard (backoff du worker),
 * pas marqué en échec. Le délai est porté par le message pour survivre à la sérialisation BullMQ.
 */
export class CrmEmailQuotaError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(
      `${QUOTA_ERROR_PREFIX}:${Math.max(1000, Math.round(retryAfterMs))} Limites d'envoi atteintes sur tous les fournisseurs email de campagne`
    );
    this.name = 'CrmEmailQuotaError';
  }
}

export function isCrmEmailQuotaError(error: unknown): boolean {
  return typeof (error as Error)?.message === 'string' && (error as Error).message.startsWith(QUOTA_ERROR_PREFIX);
}

export function crmQuotaRetryDelay(error: unknown): number {
  const match = /^CRM_EMAIL_QUOTA_EXHAUSTED:(\d+)/.exec((error as Error)?.message ?? '');

  return match ? Number(match[1]) : 60_000;
}

/** Nombre de relances d'un email de campagne en attente de place chez un fournisseur. */
export const CRM_EMAIL_MAX_ATTEMPTS = 500;
