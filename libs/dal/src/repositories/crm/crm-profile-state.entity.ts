import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

/**
 * izipush-crm — date du fait qui a produit la valeur actuelle de chaque champ du profil.
 * Un événement plus ancien que cette date n'écrase pas le champ (événements reçus dans le désordre).
 */
export class CrmProfileStateEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  subscriberId: string;

  /** Clé = chemin du champ sur le subscriber (ex. « email », « data.kyc_status »). */
  fieldsAt: Record<string, Date>;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmProfileStateDBModel = ChangePropsValueType<CrmProfileStateEntity, '_environmentId' | '_organizationId'>;
