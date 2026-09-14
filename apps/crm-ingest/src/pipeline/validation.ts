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
    transactionId: z.union([z.string().trim().min(1), z.number()]).transform(String),
    amount,
    product: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1).optional(),
  })
  .passthrough();

const emailUpdated = z.object({ updated_email: z.string().trim().email() }).passthrough();

const anyData = z.object({}).passthrough();

const SCHEMAS: Record<CrmEventName, z.ZodTypeAny> = {
  'account.registered': anyData,
  'account.profile_updated': anyData,
  'account.email_updated': emailUpdated,
  'account.deleted': anyData,
  'account.logged_in': anyData,
  'kyc.submitted': anyData,
  'kyc.approved': anyData,
  'kyc.rejected': anyData,
  'transaction.completed': transaction,
  'transaction.failed': transaction,
  'consent.marketing_updated': z.object({ optIn: z.boolean() }).passthrough(),
};

/** Valide et normalise les données (montant en nombre, identifiants en chaîne). */
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

/** Produit normalisé ; « unknown » tant qu'Izichange ne l'envoie pas. */
export function activityProduct(data: Record<string, unknown>): string {
  const raw = typeof data.product === 'string' ? data.product : '';
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  return normalized || 'unknown';
}
