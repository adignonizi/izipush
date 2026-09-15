import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

/**
 * izipush-crm — template email réutilisable, conçu dans l'éditeur templatical.
 * `design` = le JSON de l'éditeur (source), `html` = le rendu copié dans les étapes email qui le référencent.
 */
export class CrmEmailTemplateEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  name: string;

  /** À quoi sert ce template (pour l'équipe). */
  description?: string;

  /** Objet proposé aux étapes email qui utilisent ce template (facultatif). */
  subject?: string;

  /** Vide tant que le template n'a pas été conçu dans l'éditeur (création en deux étapes). */
  design?: Record<string, unknown>;

  html?: string;

  version: number;

  _updatedBy?: string;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmEmailTemplateDBModel = ChangePropsValueType<
  CrmEmailTemplateEntity,
  '_environmentId' | '_organizationId'
>;
