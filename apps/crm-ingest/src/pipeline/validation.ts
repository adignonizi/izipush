import { normalizeCrmProductId } from '@novu/dal';
import { z } from 'zod';

import { CrmEventName } from './envelope';

/** Données d'un événement non exploitables : le message part dans la file d'erreurs (inutile de le rejouer tel quel). */
export class CrmValidationError extends Error {}

const amount = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, 'montant non numérique'),
  ])
  .transform(Number)
  .refine((value) => Number.isFinite(value) && value >= 0, 'montant invalide');

const transaction = z
  .object({
    amount_usd: amount,
    type: z.string().trim().min(1).optional(),
    /**
     * Rang de cette transaction pour ce client sur le produit de l'enveloppe. Facultatif : izipush sait
     * déduire la première transaction de ce qu'il a reçu, mais cette déduction est fausse tant que
     * l'historique n'est pas importé. Fourni, `txNo === 1` fait foi.
     */
    txNo: z
      .union([z.number().int().positive(), z.string().trim().regex(/^\d+$/)])
      .transform(Number)
      .optional(),
  })
  .passthrough();

const emailUpdated = z.object({ updated_email: z.string().trim().email() }).passthrough();

const anyData = z.object({}).passthrough();

const SCHEMAS: Record<CrmEventName, z.ZodTypeAny> = {
  'account.registered': anyData,
  'account.profile_updated': anyData,
  'account.email_updated': emailUpdated,
  'account.logged_in': anyData,
  'kyc.validated': anyData,
  'transaction.completed': transaction,
  'product.activated': anyData,
};

/** Valide et normalise les données (montant en nombre, rang en entier). */
export function validateEventData(eventName: CrmEventName, data: Record<string, unknown>): Record<string, unknown> {
  const result = SCHEMAS[eventName].safeParse(data);

  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.') || 'data'} : ${issue.message}`);

    throw new CrmValidationError(`${eventName} invalide — ${detail.join(' ; ')}`);
  }

  return result.data;
}

/** Jour UTC (YYYY-MM-DD) d'une transaction : clé de la ligne d'activité. */
export function activityDay(occurredAt: Date): string {
  return occurredAt.toISOString().slice(0, 10);
}

/**
 * Identifiant du produit, tel qu'il arrive dans `product_code` de l'enveloppe. Clé de la ligne
 * d'activité et du catalogue.
 *
 * La valeur est reprise telle quelle : la réécrire en « slug » (minuscules, tronquée) ferait se confondre
 * deux identifiants opaques distincts. Sans produit, l'activité est rangée sous `unknown`, un produit du
 * catalogue comme un autre, que l'on renomme le jour où l'on sait ce qu'il recouvre.
 */
export function activityProductId(productCode: unknown): string {
  return normalizeCrmProductId(productCode);
}
