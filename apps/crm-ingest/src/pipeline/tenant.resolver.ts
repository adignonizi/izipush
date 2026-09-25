import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentRepository } from '@novu/dal';

import { CrmTenant } from './tenant';
import { CrmValidationError } from './validation';

/** Durée de vie d'une correspondance en cache. Un environnement ne change pas d'organisation. */
const CACHE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class TenantResolver {
  private readonly logger = new Logger(TenantResolver.name);
  private readonly cache = new Map<string, { tenant: CrmTenant; at: number }>();

  constructor(private environments: EnvironmentRepository) {}

  /**
   * Détermine l'environnement et l'organisation d'un événement.
   *
   * L'enveloppe d'Izichange ne portait historiquement aucun marqueur
   * d'environnement : l'estampille venait donc de la configuration, ce qui
   * enfermait l'ingestion dans un environnement unique. `application_id` —
   * l'identifiant public d'un environnement Novu, celui de Settings > API Keys —
   * lève cette limite sans rien exposer de secret.
   *
   * Trois cas, délibérément distincts :
   *
   *  · **absent** — on retombe sur l'environnement configuré. C'est ce qui rend
   *    la bascule sans risque : tant qu'Izichange n'émet pas le champ, rien ne
   *    change ;
   *  · **connu** — l'environnement est résolu, et l'organisation avec lui,
   *    puisque l'entité la porte ;
   *  · **inconnu** — REJET vers la file d'erreurs. Ne surtout pas retomber sur
   *    l'environnement par défaut : un identifiant erroné rangerait des
   *    événements chez le mauvais client, sans que rien ne le signale. Mieux
   *    vaut un message en échec, visible, qu'une donnée mal classée.
   */
  async resolve(applicationId?: string): Promise<CrmTenant> {
    if (!applicationId) {
      return {
        environmentId: process.env.CRM_ENVIRONMENT_ID,
        organizationId: process.env.CRM_ORGANIZATION_ID,
      };
    }

    const cached = this.cache.get(applicationId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.tenant;

    const environment = await this.environments.findEnvironmentByIdentifier(applicationId);
    if (!environment) {
      // Le dépôt lit sur un secondaire : un environnement créé à l'instant peut
      // n'y être pas encore répliqué. On ne met donc PAS l'absence en cache,
      // pour que la tentative suivante reparte sur une lecture fraîche.
      this.logger.warn(`application_id inconnu : ${applicationId}`);

      throw new CrmValidationError(`application_id inconnu : ${applicationId}`);
    }

    const tenant: CrmTenant = {
      environmentId: String(environment._id),
      organizationId: String(environment._organizationId),
    };
    this.cache.set(applicationId, { tenant, at: Date.now() });

    return tenant;
  }
}
