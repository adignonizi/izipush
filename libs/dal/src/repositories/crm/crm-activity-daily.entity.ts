import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

export type CrmActivityTotals = { tx: number; volUsd: number; txFailed: number };

/**
 * izipush-crm — activité d'un client pour un jour et un produit (`unknown` si l'événement n'en portait pas).
 * Totaux = base (import initial, jamais touchée par le temps réel) + journal (recalculé à chaque événement).
 */
export class CrmActivityDailyEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  subscriberId: string;

  /** Jour UTC, format YYYY-MM-DD. */
  day: string;

  productId: string;

  tx: number;

  volUsd: number;

  txFailed: number;

  base?: CrmActivityTotals;

  journal?: CrmActivityTotals & { eventCount: number };

  createdAt?: string;

  updatedAt?: string;
}

export type CrmActivityDailyDBModel = ChangePropsValueType<
  CrmActivityDailyEntity,
  '_environmentId' | '_organizationId'
>;
