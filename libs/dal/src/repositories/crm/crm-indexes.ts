import { Logger } from '@nestjs/common';
import type { Model, mongo } from 'mongoose';

const CRM_INDEXES_CONTEXT = '[@novu/dal][crm]';

// biome-ignore lint/suspicious/noExplicitAny: registre générique, accepte tout modèle Mongoose
type AnyModel = Model<any>;

type CrmIndex = { model: AnyModel; fields: mongo.IndexSpecification; options?: mongo.CreateIndexesOptions };

const crmModels = new Set<AnyModel>();
const crmIndexes: CrmIndex[] = [];

/**
 * izipush-crm — Novu ne crée pas les index en production (MONGO_AUTO_CREATE_INDEXES=false).
 * Chaque collection crm_* s'enregistre ici pour que ses index soient créés explicitement au démarrage.
 */
export function registerCrmModel<T extends AnyModel>(model: T): T {
  crmModels.add(model);

  return model;
}

/**
 * izipush-crm — index ajouté par le CRM sur une collection Novu existante (ex. subscribers.data.*),
 * sans recréer les index Novu de cette collection.
 */
export function registerCrmIndex(
  model: AnyModel,
  fields: mongo.IndexSpecification,
  options?: mongo.CreateIndexesOptions
): void {
  crmIndexes.push({ model, fields, options });
}

/** Crée les index des collections CRM et les index CRM sur les collections Novu. Idempotent. */
export async function ensureCrmIndexes(): Promise<void> {
  for (const model of crmModels) {
    await model.createIndexes();
    Logger.log(`Index prêts : ${model.collection.collectionName}`, CRM_INDEXES_CONTEXT);
  }

  for (const { model, fields, options } of crmIndexes) {
    await model.collection.createIndex(fields, options);
    Logger.log(`Index prêt : ${model.collection.collectionName} ${JSON.stringify(fields)}`, CRM_INDEXES_CONTEXT);
  }
}
