import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

/**
 * immediate : dès l'activation · scheduled : à une date · recurring : selon une expression cron ·
 * on_event : à chaque événement reçu d'Izichange, pour le seul client concerné.
 */
export type CrmCampaignScheduleMode = 'immediate' | 'scheduled' | 'recurring' | 'on_event';

export type CrmCampaignSchedule = {
  mode: CrmCampaignScheduleMode;
  at?: Date;
  cron?: string;
  timezone?: string;
  eventName?: string;
};

export type CrmCampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

/** Une campagne dit qui (segment) et quand (planification) ; le contenu vit dans le workflow Novu. */
export class CrmCampaignEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  name: string;

  description?: string;

  /** Identifiant de déclenchement du workflow Novu. */
  workflowKey: string;

  segmentId: string;

  /**
   * Produit promu par la campagne. Sert à retrouver ses campagnes depuis la fiche produit, et à écarter
   * du ciblage les clients qui utilisent déjà ce produit (`excludeProductUsers`).
   */
  productId?: string;

  /** Campagne de recrutement : les clients déjà liés au produit promu ne sont pas sollicités. */
  excludeProductUsers?: boolean;

  /** Données transmises au workflow à chaque déclenchement. */
  payload?: Record<string, unknown>;

  schedule: CrmCampaignSchedule;

  status: CrmCampaignStatus;

  /** Prochaine exécution ; null tant que crm-ingest ne l'a pas calculée (campagne récurrente). */
  nextRunAt?: Date | null;

  lastRunAt?: Date;

  runCount?: number;

  error?: string;

  _createdBy?: string;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmCampaignDBModel = ChangePropsValueType<CrmCampaignEntity, '_environmentId' | '_organizationId'>;
