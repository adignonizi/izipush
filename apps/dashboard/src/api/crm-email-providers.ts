import { IEnvironment } from '@novu/shared';
import { get, put } from './api.client';

// izipush-crm — répartition des emails de campagne entre fournisseurs (routes /v1/crm/email-providers du fork).

export type CrmQuotaCounts = { minute: number; hour: number; day: number };

export type CrmEmailProviderSettings = {
  routingEnabled: boolean;
  order: number;
  perMinute: number | null;
  perHour: number | null;
  perDay: number | null;
};

export type CrmEmailProvider = CrmEmailProviderSettings & {
  integrationId: string;
  name: string;
  identifier: string;
  providerId: string;
  active: boolean;
  primary: boolean;
  current: CrmQuotaCounts | null;
};

export type CrmProviderUsage = {
  day: string;
  _integrationId: string;
  providerId?: string;
  sent: number;
  failed: number;
  bounced: number;
  complaints: number;
  postponed: number;
};

type WithEnvironment = { environment: IEnvironment; signal?: AbortSignal };

export async function getCrmEmailProviders({ environment, signal }: WithEnvironment): Promise<CrmEmailProvider[]> {
  return (await get<{ data: CrmEmailProvider[] }>('/crm/email-providers', { environment, signal })).data;
}

export async function saveCrmEmailProvider({
  environment,
  integrationId,
  body,
}: WithEnvironment & { integrationId: string; body: CrmEmailProviderSettings }) {
  return (await put<{ data: unknown }>(`/crm/email-providers/${integrationId}`, { environment, body })).data;
}

export async function getCrmEmailUsage({
  environment,
  days,
  signal,
}: WithEnvironment & { days: number }): Promise<{ from: string; rows: CrmProviderUsage[] }> {
  return (
    await get<{ data: { from: string; rows: CrmProviderUsage[] } }>(`/crm/email-providers/usage?days=${days}`, {
      environment,
      signal,
    })
  ).data;
}
