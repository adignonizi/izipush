import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';
import type { CrmChannelStats } from './crm-report.repository';

/** resolving : calcul de l'audience · triggering : déclenchement · triggered : remis à Novu · failed : échec. */
export type CrmCampaignRunStatus = 'resolving' | 'triggering' | 'triggered' | 'failed';

/** Une exécution d'une campagne (« la campagne lancée le 14 à 9 h »). */
export class CrmCampaignRunEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  campaignId: string;

  /** Échéance planifiée ; avec campaignId, identifie l'exécution de façon unique (pas de double lancement). */
  scheduledFor: Date;

  status: CrmCampaignRunStatus;

  /** Clients visés, après exclusions. */
  audienceSize?: number;

  /** Clients du segment écartés au lancement (supprimés, ou refus du marketing). */
  excludedCount?: number;

  /** Topic de l'exécution : campaign:{campaignId}:{runId}. */
  topicKey?: string;

  transactionId?: string;

  error?: string;

  attempts?: number;

  lockedUntil?: Date | null;

  startedAt?: Date;

  triggeredAt?: Date;

  /** Date de suppression du topic de l'exécution (30 jours après le déclenchement). */
  topicPurgedAt?: Date;

  /** Résultats d'envoi, gardés une fois définitifs (48 h après le déclenchement) pour ne plus les recalculer. */
  stats?: CrmChannelStats[];

  statsFinalAt?: Date;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmCampaignRunDBModel = ChangePropsValueType<CrmCampaignRunEntity, '_environmentId' | '_organizationId'>;
