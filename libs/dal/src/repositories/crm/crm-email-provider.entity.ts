import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

/**
 * izipush-crm — réglages d'envoi d'une intégration email pour les campagnes : participe-t-elle à la répartition,
 * dans quel ordre, et avec quelles limites. L'intégration elle-même (identifiants, fournisseur) reste celle de Novu.
 */
export class CrmEmailProviderEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  _integrationId: string;

  routingEnabled: boolean;

  /** Les fournisseurs sont essayés dans l'ordre croissant ; le suivant prend le relais quand une limite est atteinte. */
  order: number;

  perMinute?: number | null;

  perHour?: number | null;

  perDay?: number | null;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmEmailProviderDBModel = ChangePropsValueType<
  CrmEmailProviderEntity,
  '_environmentId' | '_organizationId'
>;
