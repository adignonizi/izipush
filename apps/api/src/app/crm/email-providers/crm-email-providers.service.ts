import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from '@novu/application-generic';
import {
  CRM_QUOTA_READ_LUA,
  CRM_QUOTA_WINDOWS,
  CrmEmailProviderEntity,
  CrmEmailProviderRepository,
  CrmProviderUsageEntity,
  CrmProviderUsageRepository,
  crmQuotaKeys,
  crmUsageDay,
  IntegrationRepository,
} from '@novu/dal';
import { ChannelTypeEnum, UserSessionData } from '@novu/shared';

export type CrmEmailProviderBody = {
  routingEnabled?: unknown;
  order?: unknown;
  perMinute?: unknown;
  perHour?: unknown;
  perDay?: unknown;
};

export type CrmEmailProviderRow = {
  integrationId: string;
  name: string;
  identifier: string;
  providerId: string;
  active: boolean;
  primary: boolean;
  routingEnabled: boolean;
  order: number;
  perMinute: number | null;
  perHour: number | null;
  perDay: number | null;
  /** Envois comptés sur la minute, l'heure et le jour en cours ; null si Redis n'est pas joignable. */
  current: Record<'minute' | 'hour' | 'day', number> | null;
};

const MAX_LIMIT = 10_000_000;

@Injectable()
export class CrmEmailProvidersService {
  constructor(
    private integrations: IntegrationRepository,
    private emailProviders: CrmEmailProviderRepository,
    private usage: CrmProviderUsageRepository,
    private cacheService: CacheService
  ) {}

  async list(user: UserSessionData): Promise<CrmEmailProviderRow[]> {
    const [integrations, settings] = await Promise.all([
      this.integrations.find({
        _environmentId: user.environmentId,
        _organizationId: user.organizationId,
        channel: ChannelTypeEnum.EMAIL,
      }),
      this.emailProviders.listForEnvironment(user.environmentId),
    ]);
    const byIntegration = new Map(settings.map((setting) => [setting._integrationId, setting]));

    const rows = await Promise.all(
      integrations.map(async (integration) => {
        const integrationId = String(integration._id);

        return {
          integrationId,
          name: integration.name,
          identifier: integration.identifier,
          providerId: integration.providerId,
          active: integration.active,
          primary: integration.primary,
          ...this.settingsOf(byIntegration.get(integrationId)),
          current: await this.currentCounts(integrationId),
        };
      })
    );

    return rows.sort(
      (a, b) => Number(b.routingEnabled) - Number(a.routingEnabled) || a.order - b.order || a.name.localeCompare(b.name)
    );
  }

  async save(
    user: UserSessionData,
    integrationId: string,
    body: CrmEmailProviderBody
  ): Promise<CrmEmailProviderEntity> {
    const integration = await this.integrations.findOne({
      _id: integrationId,
      _environmentId: user.environmentId,
      _organizationId: user.organizationId,
      channel: ChannelTypeEnum.EMAIL,
    });
    if (!integration) throw new NotFoundException('Intégration email introuvable dans cet environnement');

    return this.emailProviders.saveSettings(user.environmentId, user.organizationId, integrationId, {
      routingEnabled: body.routingEnabled === true,
      order: this.integer(body.order, 'Ordre', 0) ?? 0,
      perMinute: this.integer(body.perMinute, 'Limite par minute'),
      perHour: this.integer(body.perHour, 'Limite par heure'),
      perDay: this.integer(body.perDay, 'Limite par jour'),
    });
  }

  /** Compteurs quotidiens des N derniers jours (1 à 90). */
  async dailyUsage(user: UserSessionData, days: unknown): Promise<{ from: string; rows: CrmProviderUsageEntity[] }> {
    const span = Math.min(90, Math.max(1, Math.floor(Number(days) || 14)));
    const from = crmUsageDay(new Date(Date.now() - (span - 1) * 86_400_000));

    return { from, rows: await this.usage.listSince(user.environmentId, from) };
  }

  private settingsOf(setting?: CrmEmailProviderEntity) {
    return {
      routingEnabled: setting?.routingEnabled ?? false,
      order: setting?.order ?? 0,
      perMinute: setting?.perMinute ?? null,
      perHour: setting?.perHour ?? null,
      perDay: setting?.perDay ?? null,
    };
  }

  private async currentCounts(integrationId: string): Promise<CrmEmailProviderRow['current']> {
    if (!this.cacheService.cacheEnabled()) return null;

    const values = await this.cacheService.eval<(string | null)[]>(CRM_QUOTA_READ_LUA, crmQuotaKeys(integrationId), []);

    return {
      minute: Number(values?.[0] ?? 0),
      hour: Number(values?.[1] ?? 0),
      day: Number(values?.[2] ?? 0),
    } satisfies Record<(typeof CRM_QUOTA_WINDOWS)[number]['name'], number>;
  }

  /** Entier positif ou nul ; vide = pas de limite. */
  private integer(value: unknown, label: string, fallback: number | null = null): number | null {
    if (value === undefined || value === null || value === '') return fallback;

    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > MAX_LIMIT) {
      throw new BadRequestException(`${label} : entier entre 0 et ${MAX_LIMIT} attendu`);
    }

    return number;
  }
}
