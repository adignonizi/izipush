import { IEnvironment } from '@novu/shared';
import { del, get, patch, post } from './api.client';
import type { CrmReportRow } from './crm-reports';

// izipush-crm — catalogue produits (routes /v1/crm/products du fork).

/** Bac des transactions reçues sans produit. Renommable, jamais supprimable. */
export const CRM_UNKNOWN_PRODUCT_ID = 'unknown';

export type CrmProduct = {
  _id: string;
  /** Identifiant Izichange : figé, c'est lui qui rattache les événements au produit. */
  productId: string;
  name: string;
  description?: string;
  active: boolean;
  /** Produit créé d'office à la réception d'un identifiant inconnu : son libellé reste à saisir. */
  unnamed?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** Ce que pèse un produit : clients qui l'utilisent et activité depuis toujours. */
export type CrmProductRow = CrmProduct & {
  subscribers: number;
  tx: number;
  txFailed: number;
  volUsd: number;
};

export type CrmProductDetail = {
  product: CrmProductRow;
  /** Les campagnes de ce produit, toutes rendues — y compris celles qui n'ont encore rien envoyé. */
  report: { from: string; days: number; truncated: boolean; rows: CrmReportRow[] };
};

export type CrmProductBody = { productId?: string; name?: string; description?: string; active?: boolean };

type WithEnvironment = { environment: IEnvironment; signal?: AbortSignal };

export async function getCrmProducts({ environment, signal }: WithEnvironment): Promise<CrmProductRow[]> {
  return (await get<{ data: CrmProductRow[] }>('/crm/products', { environment, signal })).data;
}

export async function getCrmProduct({
  environment,
  productId,
  days,
  signal,
}: WithEnvironment & { productId: string; days?: number }): Promise<CrmProductDetail> {
  const query = days ? `?days=${days}` : '';

  return (await get<{ data: CrmProductDetail }>(`/crm/products/${productId}${query}`, { environment, signal })).data;
}

export async function createCrmProduct({
  environment,
  body,
}: WithEnvironment & { body: CrmProductBody }): Promise<CrmProduct> {
  return (await post<{ data: CrmProduct }>('/crm/products', { environment, body })).data;
}

export async function updateCrmProduct({
  environment,
  productId,
  body,
}: WithEnvironment & { productId: string; body: CrmProductBody }): Promise<CrmProduct> {
  return (await patch<{ data: CrmProduct }>(`/crm/products/${productId}`, { environment, body })).data;
}

export async function deleteCrmProduct({ environment, productId }: WithEnvironment & { productId: string }) {
  await del(`/crm/products/${productId}`, { environment });
}
