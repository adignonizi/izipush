import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * izipush-crm — lien de désinscription marketing, sans connexion : un jeton signé (HMAC-SHA256)
 * qui identifie l'environnement et le client. Partagé par crm-ingest (qui pose le lien sur le profil)
 * et l'API (qui le vérifie).
 */
export type CrmUnsubscribeTarget = { environmentId: string; subscriberId: string };

export function signUnsubscribeToken(secret: string, target: CrmUnsubscribeTarget): string {
  const payload = Buffer.from(`${target.environmentId}:${target.subscriberId}`, 'utf8').toString('base64url');

  return `${payload}.${signature(secret, payload)}`;
}

export function verifyUnsubscribeToken(secret: string, token: unknown): CrmUnsubscribeTarget | null {
  if (!secret || typeof token !== 'string') return null;

  const [payload, received] = token.split('.');
  if (!payload || !received) return null;

  const expected = signature(secret, payload);
  if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return null;
  }

  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;

  return { environmentId: decoded.slice(0, separator), subscriberId: decoded.slice(separator + 1) };
}

export function buildUnsubscribeUrl(publicApiUrl: string, secret: string, target: CrmUnsubscribeTarget): string {
  const token = encodeURIComponent(signUnsubscribeToken(secret, target));

  return `${publicApiUrl.replace(/\/+$/, '')}/v1/crm/public/unsubscribe?token=${token}`;
}

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
