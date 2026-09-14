import { IEnvironment } from '@novu/shared';
import { del, get, patch, post } from './api.client';

// izipush-crm — templates email (routes /v1/crm/templates du fork).

export type CrmTemplateSummary = {
  _id: string;
  name: string;
  subject?: string;
  version: number;
  updatedAt?: string;
};

export type CrmTemplate = CrmTemplateSummary & {
  design: Record<string, unknown>;
  html: string;
  usedBySteps?: number;
};

export type CrmTemplateBody = { name: string; subject?: string; design: Record<string, unknown>; html: string };

type WithEnvironment = { environment: IEnvironment; signal?: AbortSignal };

export async function getCrmTemplates({ environment, signal }: WithEnvironment): Promise<CrmTemplateSummary[]> {
  return (await get<{ data: CrmTemplateSummary[] }>('/crm/templates', { environment, signal })).data;
}

export async function getCrmTemplate({
  environment,
  templateId,
  signal,
}: WithEnvironment & { templateId: string }): Promise<CrmTemplate> {
  return (await get<{ data: CrmTemplate }>(`/crm/templates/${templateId}`, { environment, signal })).data;
}

export async function createCrmTemplate({
  environment,
  body,
}: WithEnvironment & { body: CrmTemplateBody }): Promise<CrmTemplate> {
  return (await post<{ data: CrmTemplate }>('/crm/templates', { environment, body })).data;
}

export async function updateCrmTemplate({
  environment,
  templateId,
  body,
}: WithEnvironment & { templateId: string; body: Partial<CrmTemplateBody> }): Promise<
  CrmTemplate & { propagatedSteps: number }
> {
  return (
    await patch<{ data: CrmTemplate & { propagatedSteps: number } }>(`/crm/templates/${templateId}`, {
      environment,
      body,
    })
  ).data;
}

export async function deleteCrmTemplate({ environment, templateId }: WithEnvironment & { templateId: string }) {
  await del(`/crm/templates/${templateId}`, { environment });
}
