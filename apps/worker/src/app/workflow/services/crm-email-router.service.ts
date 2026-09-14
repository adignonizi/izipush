import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@novu/application-generic';
import {
  CRM_QUOTA_RESERVE_LUA,
  CRM_QUOTA_WINDOWS,
  CrmEmailProviderEntity,
  CrmEmailProviderRepository,
  CrmEmailQuotaError,
  CrmProviderUsageRepository,
  crmQuotaArgs,
  crmQuotaKeys,
  IntegrationEntity,
  IntegrationRepository,
} from '@novu/dal';
import { ChannelTypeEnum } from '@novu/shared';

type Route = { integration: IntegrationEntity; settings: CrmEmailProviderEntity };

/** Les réglages changent rarement : relus au plus toutes les 30 s par processus. */
const ROUTES_TTL_MS = 30_000;
const LOG_CONTEXT = 'CrmEmailRouter';

/** Compteur « repoussés » de la répartition elle-même, pas d'un fournisseur en particulier. */
export const CRM_ROUTING_USAGE_ID = 'routing';

/**
 * izipush-crm — répartit les emails de campagne entre les fournisseurs activés pour la répartition :
 * le premier (dans l'ordre choisi) qui a encore de la place sur sa minute, son heure et son jour est retenu.
 * Tous pleins : le job est relancé à la fin de la fenêtre la plus proche (CrmEmailQuotaError → backoff).
 */
@Injectable()
export class CrmEmailRouter {
  private routesByEnvironment = new Map<string, { expiresAt: number; routes: Route[] }>();

  private warnedCacheDisabled = false;

  constructor(
    private integrationRepository: IntegrationRepository,
    private emailProviders: CrmEmailProviderRepository,
    private usage: CrmProviderUsageRepository,
    private cacheService: CacheService
  ) {}

  /** Intégration à utiliser ; undefined = aucune répartition configurée, Novu choisit comme d'habitude. */
  async pick(environmentId: string, organizationId: string): Promise<IntegrationEntity | undefined> {
    const routes = await this.loadRoutes(environmentId, organizationId);
    if (!routes.length) return undefined;

    if (!this.cacheService.cacheEnabled()) {
      if (!this.warnedCacheDisabled) {
        Logger.warn('Cache Redis indisponible : limites des fournisseurs email non appliquées', LOG_CONTEXT);
        this.warnedCacheDisabled = true;
      }

      return routes[0].integration;
    }

    let retryAfterMs = Number.POSITIVE_INFINITY;

    for (const route of routes) {
      const result = await this.cacheService.eval<[number, number, number]>(
        CRM_QUOTA_RESERVE_LUA,
        crmQuotaKeys(String(route.integration._id)),
        crmQuotaArgs(route.settings)
      );
      if (!result || result[0] === 1) return route.integration;

      const [, ttl, windowIndex] = result;
      const windowMs = (CRM_QUOTA_WINDOWS[windowIndex - 1]?.seconds ?? 60) * 1000;

      // Relances étalées sur la fenêtre suivante plutôt que toutes à la même seconde.
      retryAfterMs = Math.min(retryAfterMs, ttl + Math.random() * windowMs);
    }

    await this.usage.increment(environmentId, CRM_ROUTING_USAGE_ID, 'postponed').catch(() => undefined);
    throw new CrmEmailQuotaError(retryAfterMs);
  }

  private async loadRoutes(environmentId: string, organizationId: string): Promise<Route[]> {
    const cached = this.routesByEnvironment.get(environmentId);
    if (cached && cached.expiresAt > Date.now()) return cached.routes;

    const settings = (await this.emailProviders.listForEnvironment(environmentId)).filter(
      (setting) => setting.routingEnabled
    );
    let routes: Route[] = [];

    if (settings.length) {
      const integrations = await this.integrationRepository.find({
        _environmentId: environmentId,
        _organizationId: organizationId,
        channel: ChannelTypeEnum.EMAIL,
        active: true,
        _id: { $in: settings.map((setting) => setting._integrationId) },
      } as Parameters<IntegrationRepository['find']>[0]);
      const byId = new Map(integrations.map((integration) => [String(integration._id), integration]));

      routes = settings.flatMap((setting) => {
        const integration = byId.get(setting._integrationId);

        return integration ? [{ integration, settings: setting }] : [];
      });
    }

    this.routesByEnvironment.set(environmentId, { expiresAt: Date.now() + ROUTES_TTL_MS, routes });

    return routes;
  }
}
