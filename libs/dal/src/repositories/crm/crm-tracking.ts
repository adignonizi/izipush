import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * izipush-crm — suivi des ouvertures et des clics dans les emails de campagne.
 *
 * Chaque email de campagne part avec un pixel et des liens réécrits vers deux routes publiques. Les deux
 * portent un jeton signé (HMAC-SHA256) qui identifie l'environnement, le message, et — pour un clic — la
 * destination. Rien n'est lisible ni forgeable depuis l'extérieur :
 *
 * - **la destination est dans le jeton signé**, jamais dans un paramètre libre : la route de clic ne peut
 *   pas être détournée en redirection ouverte ;
 * - **la signature est cloisonnée** par un préfixe de domaine, un jeton de suivi ne peut donc pas servir
 *   de jeton de désinscription (et réciproquement), bien que les deux partagent le même secret.
 */
export type CrmTrackingTarget = { environmentId: string; messageId: string };

export type CrmClickTarget = CrmTrackingTarget & { url: string };

/** Cloisonnement de signature : sans lui, un jeton de suivi serait accepté par la route de désinscription. */
const OPEN_DOMAIN = 'crm-open';
const CLICK_DOMAIN = 'crm-click';

/** Pixel 1×1 transparent, servi quoi qu'il arrive : la réponse ne dit jamais si le message existe. */
export const CRM_TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export function signOpenToken(secret: string, target: CrmTrackingTarget): string {
  return sign(secret, OPEN_DOMAIN, `${target.environmentId}:${target.messageId}`);
}

export function verifyOpenToken(secret: string, token: unknown): CrmTrackingTarget | null {
  const decoded = verify(secret, OPEN_DOMAIN, token);
  if (!decoded) return null;

  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;

  return { environmentId: decoded.slice(0, separator), messageId: decoded.slice(separator + 1) };
}

export function signClickToken(secret: string, target: CrmClickTarget): string {
  return sign(secret, CLICK_DOMAIN, `${target.environmentId}:${target.messageId}:${target.url}`);
}

export function verifyClickToken(secret: string, token: unknown): CrmClickTarget | null {
  const decoded = verify(secret, CLICK_DOMAIN, token);
  if (!decoded) return null;

  const parts = decoded.split(':');
  if (parts.length < 3) return null;

  const [environmentId, messageId] = parts;
  const url = parts.slice(2).join(':');
  if (!environmentId || !messageId || !isHttpUrl(url)) return null;

  return { environmentId, messageId, url };
}

export function buildOpenPixelUrl(publicApiUrl: string, secret: string, target: CrmTrackingTarget): string {
  return `${base(publicApiUrl)}/v1/crm/public/open.gif?t=${encodeURIComponent(signOpenToken(secret, target))}`;
}

export function buildClickUrl(publicApiUrl: string, secret: string, target: CrmClickTarget): string {
  return `${base(publicApiUrl)}/v1/crm/public/click?t=${encodeURIComponent(signClickToken(secret, target))}`;
}

export type CrmTrackingOptions = CrmTrackingTarget & {
  publicApiUrl: string;
  secret: string;
  /** Lien de désinscription : jamais réécrit (voir ci-dessous). */
  unsubscribeUrl?: string;
};

/** `href="…"` ou `href='…'` vers une adresse http(s). Les emails sont du HTML généré, pas un document libre. */
const HREF = /href\s*=\s*(["'])(https?:\/\/[^"'\s]+)\1/gi;

/**
 * Prépare le HTML d'un email de campagne : liens réécrits vers la route de clic, pixel d'ouverture ajouté.
 *
 * Ne sont **jamais** réécrits :
 * - le lien de désinscription — le passer par une redirection casserait la désinscription en un clic
 *   exigée par Gmail et Yahoo, et ajouterait une panne possible sur un lien qui doit toujours fonctionner ;
 * - `mailto:`, `tel:` et les ancres, qui ne sont pas des adresses web ;
 * - les liens déjà réécrits, pour qu'un rendu rejoué ne s'empile pas.
 *
 * Un clic reste comptabilisé comme une ouverture : c'en est une, et elle est plus fiable que le pixel.
 */
export function applyEmailTracking(html: string, options: CrmTrackingOptions): string {
  if (!html || !options.secret || !options.publicApiUrl) return html;

  const target = { environmentId: options.environmentId, messageId: options.messageId };
  const alreadyTracked = `${base(options.publicApiUrl)}/v1/crm/public/`;

  const rewritten = html.replace(HREF, (match, quote: string, url: string) => {
    if (url === options.unsubscribeUrl || url.startsWith(alreadyTracked)) return match;

    return `href=${quote}${escapeHtml(buildClickUrl(options.publicApiUrl, options.secret, { ...target, url }))}${quote}`;
  });

  const pixel = `<img src="${escapeHtml(buildOpenPixelUrl(options.publicApiUrl, options.secret, target))}" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`;
  const closing = rewritten.lastIndexOf('</body>');

  return closing === -1 ? rewritten + pixel : rewritten.slice(0, closing) + pixel + rewritten.slice(closing);
}

function sign(secret: string, domain: string, payload: string): string {
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');

  return `${encoded}.${signature(secret, domain, encoded)}`;
}

function verify(secret: string, domain: string, token: unknown): string | null {
  if (!secret || typeof token !== 'string') return null;

  const [payload, received] = token.split('.');
  if (!payload || !received) return null;

  const expected = signature(secret, domain, payload);
  if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return null;
  }

  return Buffer.from(payload, 'base64url').toString('utf8');
}

function signature(secret: string, domain: string, payload: string): string {
  return createHmac('sha256', secret).update(`${domain}:${payload}`).digest('base64url');
}

function base(publicApiUrl: string): string {
  return publicApiUrl.replace(/\/+$/, '');
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Le jeton est en base64url ; seul le `&` du paramètre d'URL doit être échappé dans un attribut HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
