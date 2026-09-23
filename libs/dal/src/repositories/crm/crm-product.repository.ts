import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { toCrmEntity } from './crm-entity.utils';
import { CrmProductDBModel, CrmProductEntity } from './crm-product.entity';
import { CrmProduct } from './crm-product.schema';

export type CrmProductCreate = Pick<
  CrmProductEntity,
  '_environmentId' | '_organizationId' | 'productId' | 'name' | 'description' | '_createdBy'
>;

/** Ce qu'une modification peut toucher : jamais `productId`, qui rapproche les événements du produit. */
export type CrmProductPatch = Partial<Pick<CrmProductEntity, 'name' | 'description' | 'active'>>;

const DUPLICATE_KEY = 11000;

export class CrmProductRepository extends BaseRepositoryV2<CrmProductDBModel, CrmProductEntity, EnforceEnvId> {
  constructor() {
    super(CrmProduct, CrmProductEntity);
  }

  async list(environmentId: string, options?: { activeOnly?: boolean }): Promise<CrmProductEntity[]> {
    const query: Record<string, unknown> = { _environmentId: environmentId };
    if (options?.activeOnly) query.active = true;

    const docs = await this.MongooseModel.find(query).sort({ name: 1 }).lean();

    return docs.map((doc) => toCrmEntity<CrmProductEntity>(doc));
  }

  async findProduct(environmentId: string, id: string): Promise<CrmProductEntity | null> {
    const doc = await this.MongooseModel.findOne({ _environmentId: environmentId, _id: id }).lean();

    return doc ? toCrmEntity<CrmProductEntity>(doc) : null;
  }

  async findByProductId(environmentId: string, productId: string): Promise<CrmProductEntity | null> {
    const doc = await this.MongooseModel.findOne({ _environmentId: environmentId, productId }).lean();

    return doc ? toCrmEntity<CrmProductEntity>(doc) : null;
  }

  async createProduct(data: CrmProductCreate): Promise<CrmProductEntity> {
    const doc = await this.MongooseModel.create({ ...data, active: true, unnamed: false });

    return toCrmEntity<CrmProductEntity>(doc.toObject());
  }

  /** Une modification nomme le produit : il n'est plus « à nommer ». */
  async updateProduct(environmentId: string, id: string, patch: CrmProductPatch): Promise<CrmProductEntity | null> {
    const set: Record<string, unknown> = { ...patch };
    if (patch.name !== undefined) set.unnamed = false;

    const doc = await this.MongooseModel.findOneAndUpdate(
      { _environmentId: environmentId, _id: id },
      { $set: set },
      { new: true }
    ).lean();

    return doc ? toCrmEntity<CrmProductEntity>(doc) : null;
  }

  /**
   * Déclare les produits rencontrés dans les événements et encore absents du catalogue, libellé provisoire
   * égal à l'identifiant. Une transaction n'est jamais perdue parce que son produit n'a pas été créé à l'avance ;
   * la page Produits les signale « à nommer ».
   *
   * Idempotent : `$setOnInsert` ne touche jamais un produit déjà déclaré, et deux processus qui déclarent
   * le même produit en même temps se soldent par un seul document (l'index unique rejette le second).
   */
  async ensureProducts(environmentId: string, organizationId: string, productIds: string[]): Promise<void> {
    const unique = [...new Set(productIds)].filter(Boolean);
    if (!unique.length) return;

    const operations = unique.map((productId) => ({
      updateOne: {
        filter: { _environmentId: this.convertStringToObjectId(environmentId), productId },
        update: {
          $setOnInsert: {
            _organizationId: this.convertStringToObjectId(organizationId),
            name: productId,
            active: true,
            unnamed: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    try {
      await this.MongooseModel.collection.bulkWrite(operations, { ordered: false });
    } catch (error) {
      if (!isOnlyDuplicateKey(error)) throw error;
    }
  }
}

/** Course entre deux déclarations du même produit : le perdant reçoit une erreur de clé dupliquée, sans gravité. */
function isOnlyDuplicateKey(error: unknown): boolean {
  const writeErrors = (error as { writeErrors?: { code?: number }[] })?.writeErrors;
  if (writeErrors?.length) return writeErrors.every((writeError) => writeError.code === DUPLICATE_KEY);

  return (error as { code?: number })?.code === DUPLICATE_KEY;
}
