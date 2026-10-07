import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CRM_PRODUCT_ID_MAX_LENGTH,
  CRM_UNKNOWN_PRODUCT_ID,
  CrmActivityDailyRepository,
  CrmAudienceRepository,
  CrmCampaignRepository,
  CrmProductActivity,
  CrmProductEntity,
  CrmProductRepository,
} from '@novu/dal';
import { UserSessionData } from '@novu/shared';

import { isDuplicateKey, optionalText, requiredName } from '../crm-http.utils';
import { CrmReportsService } from '../reports/crm-reports.service';

export type CrmProductBody = {
  productId?: unknown;
  name?: unknown;
  description?: unknown;
  active?: unknown;
};

/** Produit enrichi de ce qu'il pèse : clients liés et activité. */
export type CrmProductRow = CrmProductEntity & {
  subscribers: number;
  tx: number;
  txFailed: number;
  volUsd: number;
};

const EMPTY_ACTIVITY = { tx: 0, txFailed: 0, volUsd: 0 };
const DETAIL_DAYS = 30;

@Injectable()
export class CrmProductsService {
  constructor(
    private products: CrmProductRepository,
    private activity: CrmActivityDailyRepository,
    private audience: CrmAudienceRepository,
    private campaigns: CrmCampaignRepository,
    private reports: CrmReportsService
  ) {}

  /** Le catalogue, chaque produit avec ses clients et son activité depuis toujours. */
  async list(user: UserSessionData): Promise<CrmProductRow[]> {
    const products = await this.products.list(user.environmentId);
    const [totals, subscribers] = await Promise.all([
      this.activity.totalsByProduct(user.environmentId),
      this.audience.countByProduct(
        user.environmentId,
        products.map((product) => product.productId)
      ),
    ]);

    return products.map((product) => this.decorate(product, totals, subscribers));
  }

  async get(user: UserSessionData, id: string): Promise<CrmProductEntity> {
    const product = await this.products.findProduct(user.environmentId, id);
    if (!product) throw new NotFoundException('Produit introuvable');

    return product;
  }

  /** Fiche d'un produit : son poids, et les campagnes qui en font la promotion avec leurs résultats. */
  async detail(user: UserSessionData, id: string, days?: unknown) {
    const product = await this.get(user, id);
    const [totals, subscribers, report] = await Promise.all([
      this.activity.totalsByProduct(user.environmentId),
      this.audience.countByProduct(user.environmentId, [product.productId]),
      this.reports.overview(user, days ?? DETAIL_DAYS, product.productId),
    ]);

    return { product: this.decorate(product, totals, subscribers), report };
  }

  async create(user: UserSessionData, body: CrmProductBody): Promise<CrmProductEntity> {
    const productId = requiredProductId(body.productId);

    try {
      return await this.products.createProduct({
        _environmentId: user.environmentId,
        _organizationId: user.organizationId,
        productId,
        name: requiredName(body.name),
        description: optionalText(body.description),
        _createdBy: user._id,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException(`Le produit « ${productId} » existe déjà`);
      throw error;
    }
  }

  /** L'identifiant n'est jamais modifiable : c'est lui qui rattache les événements déjà reçus au produit. */
  async update(user: UserSessionData, id: string, body: CrmProductBody): Promise<CrmProductEntity> {
    await this.get(user, id);

    const updated = await this.products.updateProduct(user.environmentId, id, {
      ...(body.name !== undefined ? { name: requiredName(body.name) } : {}),
      ...(body.description !== undefined ? { description: optionalText(body.description) } : {}),
      ...(body.active !== undefined ? { active: body.active === true } : {}),
    });
    if (!updated) throw new NotFoundException('Produit introuvable');

    return updated;
  }

  /**
   * Suppression réservée aux produits jamais utilisés : dès qu'une transaction ou une campagne s'y rattache,
   * le supprimer rendrait illisibles l'activité et les rapports. Pour retirer un produit du constructeur
   * de segments sans rien perdre, on l'archive (`active: false`).
   */
  async remove(user: UserSessionData, id: string): Promise<void> {
    const product = await this.get(user, id);

    if (product.productId === CRM_UNKNOWN_PRODUCT_ID) {
      throw new ConflictException('Le bac « sans produit » ne peut pas être supprimé ; renommez-le');
    }

    const [totals, campaigns] = await Promise.all([
      this.activity.totalsByProduct(user.environmentId),
      this.campaigns.countByProduct(user.environmentId, product.productId),
    ]);

    if (campaigns > 0) throw new ConflictException('Ce produit porte des campagnes : archivez-le plutôt');
    if (totals.some((total) => total.productId === product.productId)) {
      throw new ConflictException('Ce produit a de l’activité : archivez-le plutôt');
    }

    await this.products.delete({ _environmentId: user.environmentId, _id: id });
  }

  private decorate(
    product: CrmProductEntity,
    totals: CrmProductActivity[],
    subscribers: Record<string, number>
  ): CrmProductRow {
    const total = totals.find((row) => row.productId === product.productId) ?? EMPTY_ACTIVITY;

    return {
      ...product,
      subscribers: subscribers[product.productId] ?? 0,
      tx: total.tx,
      txFailed: total.txFailed,
      volUsd: Math.round(total.volUsd * 100) / 100,
    };
  }
}

/** Identifiant Izichange : repris tel quel, jamais réécrit — c'est la clé de rapprochement des événements. */
export function requiredProductId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException("L'identifiant est obligatoire");

  const productId = value.trim();
  if (productId.length > CRM_PRODUCT_ID_MAX_LENGTH) {
    throw new BadRequestException(`L'identifiant ne doit pas dépasser ${CRM_PRODUCT_ID_MAX_LENGTH} caractères`);
  }

  return productId;
}
