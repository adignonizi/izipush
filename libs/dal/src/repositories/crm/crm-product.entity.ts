import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

/**
 * izipush-crm — produit Izichange déclaré dans le CRM.
 *
 * `productId` est l'identifiant qu'Izichange place dans ses événements : c'est la clé de rapprochement,
 * elle n'est jamais modifiable. Le libellé, lui, se change à tout moment.
 */
export class CrmProductEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  /** Identifiant Izichange, tel qu'il arrive dans les événements. Figé après création. */
  productId: string;

  name: string;

  description?: string;

  /** Un produit archivé ne se propose plus dans le constructeur de segments ; son activité reste lisible. */
  active: boolean;

  /**
   * Produit créé d'office à la réception d'un `productId` inconnu (ou le bac `unknown`) :
   * son libellé vaut encore son identifiant et reste à saisir.
   */
  unnamed?: boolean;

  _createdBy?: string;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmProductDBModel = ChangePropsValueType<CrmProductEntity, '_environmentId' | '_organizationId'>;

/** Bac des transactions reçues sans `productId`. C'est un produit comme un autre : il se renomme. */
export const CRM_UNKNOWN_PRODUCT_ID = 'unknown';

/** Longueur maximale d'un identifiant de produit. Large : un identifiant composé reste un identifiant. */
export const CRM_PRODUCT_ID_MAX_LENGTH = 225;

/**
 * Identifiant de produit d'un événement. Contrairement à l'ancien découpage en « slug », la valeur est
 * conservée telle quelle : tronquer ou réécrire un identifiant opaque (UUID, identifiant base64) ferait
 * se confondre deux produits distincts. Seuls les espaces de bordure sont retirés.
 */
export function normalizeCrmProductId(value: unknown): string {
  // Un identifiant numérique est un identifiant : le refuser rangerait le produit sous « unknown ».
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string') return CRM_UNKNOWN_PRODUCT_ID;

  const trimmed = text.trim();
  if (!trimmed || trimmed.length > CRM_PRODUCT_ID_MAX_LENGTH) return CRM_UNKNOWN_PRODUCT_ID;

  return trimmed;
}
