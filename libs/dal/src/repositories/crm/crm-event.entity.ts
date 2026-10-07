import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

export type CrmEventSource = 'rabbitmq' | 'keycloak';

/** izipush-crm — un événement reçu d'Izichange, tel que journalisé (source de vérité des recalculs). */
export class CrmEventEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  /** Identifiant fourni par l'émetteur ; unique par environnement (dédoublonnage). */
  eventId: string;

  eventName: string;

  subscriberId: string;

  occurredAt: Date;

  receivedAt: Date;

  source: CrmEventSource;

  data: Record<string, unknown>;

  /** Transactions uniquement : jour UTC (YYYY-MM-DD) et identifiant du produit, clés de la ligne d'activité.
   *  Une transaction sans produit est rangée sous `unknown`, un produit du catalogue comme un autre. */
  day?: string;

  productId?: string;

  /** Date de prise en compte dans le profil et l'activité ; null tant que l'événement est en attente. */
  derivedAt?: Date | null;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmEventDBModel = ChangePropsValueType<CrmEventEntity, '_environmentId' | '_organizationId'>;
