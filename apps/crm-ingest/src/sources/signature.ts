import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vérifie la signature HMAC-SHA256 (hex) du corps brut. Accepte « <hex> » ou « sha256=<hex> ».
 * Sans secret configuré, la vérification est désactivée.
 */
export function isValidSignature(rawBody: Buffer | undefined, signature: string | undefined, secret: string): boolean {
  if (!secret) return true;
  if (!rawBody || !signature) return false;

  const received = signature.trim().replace(/^sha256=/i, '');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  if (received.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
}
