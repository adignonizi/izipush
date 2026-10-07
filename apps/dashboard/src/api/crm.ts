import { IEnvironment } from '@novu/shared';
import { del, get, patch, post } from './api.client';

// izipush-crm — segments et campagnes (routes /v1/crm/* du fork).

export type CrmFieldType = 'string' | 'enum' | 'number' | 'date' | 'boolean' | 'set';

export type CrmProfileOperator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'not_exists'
  | 'within_last_days'
  | 'more_than_days_ago'
  // Champs « set » (produits utilisés par le client).
  | 'has'
  | 'has_not'
  | 'has_all'
  | 'has_any';

export type CrmProfileField = {
  key: string;
  label: string;
  path: string;
  type: CrmFieldType;
  values?: { value: string; label: string }[];
  /** Champ « set » dont les valeurs viennent du catalogue produits. */
  valuesFrom?: 'products';
  operators: CrmProfileOperator[];
};

export type CrmActivityMetric = 'tx' | 'volUsd' | 'txFailed';

/** Un client sans activité compte pour 0 : « lt », « lte » et « eq 0 » l'incluent. */
export type CrmActivityOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

export type CrmFields = {
  profile: CrmProfileField[];
  activity: { metrics: { key: CrmActivityMetric; label: string }[]; operators: CrmActivityOperator[] };
  events: string[];
  /** Catalogue des produits actifs : valeurs des champs « set » et des conditions d'activité. */
  products: { value: string; label: string }[];
};

export type CrmProfileCondition = { type: 'profile'; field: string; operator: CrmProfileOperator; value?: unknown };

export type CrmActivityCondition = {
  type: 'activity';
  metric: CrmActivityMetric;
  windowDays: number;
  productId?: string;
  operator: CrmActivityOperator;
  value: number;
};

export type CrmConditionGroup = { type: 'group'; combinator: 'and' | 'or'; conditions: CrmCondition[] };

export type CrmCondition = CrmProfileCondition | CrmActivityCondition | CrmConditionGroup;

export type CrmSegmentStatus = 'ready' | 'freezing' | 'deleting' | 'failed';

export type CrmSegment = {
  _id: string;
  name: string;
  description?: string;
  audience: CrmConditionGroup;
  frozen: boolean;
  status: CrmSegmentStatus;
  memberCount?: number;
  frozenAt?: string;
  error?: string;
  createdAt?: string;
};

export type CrmScheduleMode = 'immediate' | 'scheduled' | 'recurring' | 'on_event';

export type CrmSchedule = { mode: CrmScheduleMode; at?: string; cron?: string; timezone?: string; eventName?: string };

export type CrmCampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

export type CrmCampaign = {
  _id: string;
  name: string;
  description?: string;
  workflowKey: string;
  segmentId: string;
  /** Produit promu, facultatif : rattache la campagne à sa fiche produit. */
  productId?: string;
  /** Campagne de recrutement : les clients qui utilisent déjà le produit ne sont pas sollicités. */
  excludeProductUsers?: boolean;
  payload?: Record<string, unknown>;
  schedule: CrmSchedule;
  status: CrmCampaignStatus;
  nextRunAt?: string | null;
  lastRunAt?: string;
  runCount?: number;
  error?: string;
  createdAt?: string;
};

export type CrmCampaignRun = {
  _id: string;
  campaignId: string;
  scheduledFor: string;
  status: 'resolving' | 'triggering' | 'triggered' | 'failed';
  audienceSize?: number;
  excludedCount?: number;
  error?: string;
  triggeredAt?: string;
};

export type CreateCrmSegmentBody = {
  name: string;
  description?: string;
  audience: CrmConditionGroup;
  frozen: boolean;
};

export type CreateCrmCampaignBody = {
  name: string;
  description?: string;
  workflowKey: string;
  segmentId: string;
  productId?: string;
  excludeProductUsers?: boolean;
  schedule: CrmSchedule;
  payload?: Record<string, unknown>;
};

type WithEnvironment = { environment: IEnvironment; signal?: AbortSignal };

export async function getCrmFields({ environment, signal }: WithEnvironment): Promise<CrmFields> {
  return (await get<{ data: CrmFields }>('/crm/fields', { environment, signal })).data;
}

export async function getCrmSegments({ environment, signal }: WithEnvironment): Promise<CrmSegment[]> {
  return (await get<{ data: CrmSegment[] }>('/crm/segments', { environment, signal })).data;
}

export async function previewCrmSegment({
  environment,
  audience,
}: WithEnvironment & { audience: CrmConditionGroup }): Promise<{ count: number }> {
  return (await post<{ data: { count: number } }>('/crm/segments/preview', { environment, body: { audience } })).data;
}

export async function createCrmSegment({
  environment,
  body,
}: WithEnvironment & { body: CreateCrmSegmentBody }): Promise<CrmSegment> {
  return (await post<{ data: CrmSegment }>('/crm/segments', { environment, body })).data;
}

export async function deleteCrmSegment({ environment, segmentId }: WithEnvironment & { segmentId: string }) {
  await del(`/crm/segments/${segmentId}`, { environment });
}

export async function getCrmCampaigns({ environment, signal }: WithEnvironment): Promise<CrmCampaign[]> {
  return (await get<{ data: CrmCampaign[] }>('/crm/campaigns', { environment, signal })).data;
}

export async function getCrmCampaign({
  environment,
  campaignId,
  signal,
}: WithEnvironment & { campaignId: string }): Promise<CrmCampaign> {
  return (await get<{ data: CrmCampaign }>(`/crm/campaigns/${campaignId}`, { environment, signal })).data;
}

export async function createCrmCampaign({
  environment,
  body,
}: WithEnvironment & { body: CreateCrmCampaignBody }): Promise<CrmCampaign> {
  return (await post<{ data: CrmCampaign }>('/crm/campaigns', { environment, body })).data;
}

export async function updateCrmCampaign({
  environment,
  campaignId,
  body,
}: WithEnvironment & { campaignId: string; body: Partial<CreateCrmCampaignBody> }): Promise<CrmCampaign> {
  return (await patch<{ data: CrmCampaign }>(`/crm/campaigns/${campaignId}`, { environment, body })).data;
}

export async function setCrmCampaignState({
  environment,
  campaignId,
  action,
}: WithEnvironment & { campaignId: string; action: 'activate' | 'pause' }): Promise<CrmCampaign> {
  return (await post<{ data: CrmCampaign }>(`/crm/campaigns/${campaignId}/${action}`, { environment })).data;
}

export async function deleteCrmCampaign({ environment, campaignId }: WithEnvironment & { campaignId: string }) {
  await del(`/crm/campaigns/${campaignId}`, { environment });
}

export async function getCrmCampaignRuns({
  environment,
  campaignId,
  signal,
}: WithEnvironment & { campaignId: string }): Promise<CrmCampaignRun[]> {
  return (await get<{ data: CrmCampaignRun[] }>(`/crm/campaigns/${campaignId}/runs`, { environment, signal })).data;
}

export async function retryCrmSegmentFreeze({ environment, segmentId }: WithEnvironment & { segmentId: string }) {
  return (await post<{ data: CrmSegment }>(`/crm/segments/${segmentId}/retry-freeze`, { environment })).data;
}
