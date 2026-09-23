/**
 * izipush-crm — migration « product » (texte libre) → « productId » (identifiant du catalogue produits).
 *
 *   pnpm --filter @novu/crm-ingest migrate:products [--dry-run]
 *
 * Ce que fait la migration, dans l'ordre, et pourquoi :
 *
 *  1. Supprime `crm_events_activity` et `crm_activity_unique_day`. Ces deux index gardent leur nom mais
 *     changent de clé : Mongo refuse de recréer un index existant sous une autre définition, la création
 *     au démarrage échouerait donc tant que les anciens sont là.
 *  2. Renomme le champ `product` en `productId` dans le journal et dans l'activité.
 *  3. Déclare dans `crm_products` chaque produit rencontré, plus le bac `unknown`.
 *  4. Réécrit sur chaque profil `data.products`, `data.product_count` et `data.product_state`, en reprenant
 *     les dates portées par les anciennes clés `data.first_tx_at_{produit}`, puis efface ces clés.
 *  5. Pose les compteurs à zéro sur les clients sans activité : un champ absent ne répond pas à « = 0 »,
 *     et « KYC validé sans transaction » ne les trouverait pas.
 *
 * Rejouable : chaque étape est idempotente, une exécution interrompue se relance sans effet de bord.
 */
import { CrmActivityDaily, CrmEvent, CrmProduct, DalService, Subscriber } from '@novu/dal';

/**
 * Les collections sont prises sur les modèles du DAL plutôt que sur une connexion mongoose ouverte à part :
 * `mongoose` n'est qu'une dépendance indirecte de crm-ingest, et n'est donc pas résolvable dans l'image de
 * production. Passer par les modèles fait aussi porter au script exactement la même connexion que l'app.
 */
type Coll = (typeof CrmEvent)['collection'];
type BulkWrite = Parameters<(typeof Subscriber)['collection']['bulkWrite']>[0][number];

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 500;

type ProductRow = { _id: { subscriberId: string; productId: string }; tx: number; volUsd: number; txFailed: number };

async function main(): Promise<void> {
  const dal = new DalService();
  await dal.connect(process.env.MONGO_URL);

  const events = CrmEvent.collection;
  const activity = CrmActivityDaily.collection;
  const products = CrmProduct.collection;
  const subscribers = Subscriber.collection;

  log('1/5 · anciens index');
  await dropIndex(events, 'crm_events_activity');
  await dropIndex(activity, 'crm_activity_unique_day');

  log('2/5 · product → productId');
  await rename(events, 'crm_events');
  await rename(activity, 'crm_activity_daily');

  log('3/5 · catalogue produits');
  const seen = (await activity.distinct('productId')) as string[];
  const catalogue = [...new Set([...seen.filter(Boolean), 'unknown'])];
  log(`   ${catalogue.length} produit(s) : ${catalogue.join(', ')}`);

  for (const environment of await activity.distinct('_environmentId')) {
    const organizationId = (await activity.findOne({ _environmentId: environment }))?._organizationId;
    if (!organizationId) continue;

    for (const productId of catalogue) {
      if (DRY_RUN) continue;
      await products.updateOne(
        { _environmentId: environment, productId },
        {
          $setOnInsert: {
            _organizationId: organizationId,
            name: productId,
            active: true,
            unnamed: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }
  }

  log('4/5 · profils');
  let touched = 0;

  for (const environment of await activity.distinct('_environmentId')) {
    const cursor = activity.aggregate<ProductRow>([
      { $match: { _environmentId: environment } },
      {
        $group: {
          _id: { subscriberId: '$subscriberId', productId: '$productId' },
          tx: { $sum: '$tx' },
          volUsd: { $sum: '$volUsd' },
          txFailed: { $sum: '$txFailed' },
        },
      },
      { $sort: { '_id.subscriberId': 1 } },
    ]);

    let current: string | undefined;
    let rows: ProductRow[] = [];
    const writes: BulkWrite[] = [];

    const flush = async (force = false) => {
      if (writes.length >= BATCH || (force && writes.length)) {
        if (!DRY_RUN) await subscribers.bulkWrite(writes, { ordered: false });
        writes.length = 0;
      }
    };

    const emit = async () => {
      if (!current || !rows.length) return;
      const write = await buildWrite(subscribers, environment, current, rows);
      if (write) {
        writes.push(write);
        touched++;
      }
      await flush();
    };

    for await (const row of cursor) {
      if (row._id.subscriberId !== current) {
        await emit();
        current = row._id.subscriberId;
        rows = [];
      }
      rows.push(row);
    }

    await emit();
    await flush(true);
  }

  log(`${touched} profil(s) ${DRY_RUN ? 'à mettre à jour' : 'mis à jour'}`);

  log('5/5 · compteurs des clients sans activité');
  const withoutCounters = {
    'data.account_created_at': { $exists: true },
    'data.product_count': { $exists: false },
  };
  const pending = await subscribers.countDocuments(withoutCounters);
  log(`   ${pending} client(s)`);

  if (pending && !DRY_RUN) {
    await subscribers.updateMany(withoutCounters, {
      $set: { 'data.lifetime_tx': 0, 'data.lifetime_vol_usd': 0, 'data.products': [], 'data.product_count': 0 },
    });
  }

  await dal.disconnect();
}

/** Un profil : produits utilisés, compteur, état par produit, et retrait des anciennes clés par produit. */
async function buildWrite(subscribers: Coll, environmentId: unknown, subscriberId: string, rows: ProductRow[]) {
  const doc = await subscribers.findOne({ _environmentId: environmentId, subscriberId }, { projection: { data: 1 } });
  if (!doc) return undefined;

  const data = (doc.data ?? {}) as Record<string, unknown>;
  type State = { tx: number; tx_failed: number; vol_usd: number; first_tx_at?: string; last_tx_at?: string };
  // `unknown` figure toujours, même à zéro : data.product_state est alors lisible sans garde.
  const state: Record<string, State> = { unknown: { tx: 0, tx_failed: 0, vol_usd: 0 } };

  for (const row of rows) {
    const { productId } = row._id;
    // La date précise vivait dans data.first_tx_at_{produit} : on la reprend plutôt que de la perdre.
    const firstTxAt = data[`first_tx_at_${productId}`];

    state[productId] = {
      tx: row.tx,
      tx_failed: row.txFailed,
      vol_usd: Math.round(row.volUsd * 100) / 100,
      ...(typeof firstTxAt === 'string' ? { first_tx_at: firstTxAt } : {}),
    };
  }

  // Une tentative suffit à lier : une transaction échouée dit que le client a essayé le produit.
  const owned = Object.entries(state)
    .filter(([, product]) => product.tx > 0 || product.tx_failed > 0 || !!product.first_tx_at)
    .map(([productId]) => productId)
    .sort();

  const unset: Record<string, ''> = {};
  for (const key of Object.keys(data)) if (key.startsWith('first_tx_at_')) unset[`data.${key}`] = '';

  return {
    updateOne: {
      filter: { _id: doc._id },
      update: {
        $set: { 'data.products': owned, 'data.product_count': owned.length, 'data.product_state': state },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
    },
  };
}

async function rename(collection: Coll, label: string): Promise<void> {
  const pending = await collection.countDocuments({ product: { $exists: true } });
  log(`   ${label} : ${pending} document(s)`);
  if (!pending || DRY_RUN) return;

  await collection.updateMany({ product: { $exists: true } }, [
    { $set: { productId: { $ifNull: ['$productId', '$product'] } } },
    { $unset: 'product' },
  ]);
}

async function dropIndex(collection: Coll, name: string): Promise<void> {
  try {
    if (!DRY_RUN) await collection.dropIndex(name);
    log(`   ${name} supprimé`);
  } catch {
    log(`   ${name} déjà absent`);
  }
}

function log(message: string): void {
  process.stdout.write(`${DRY_RUN ? '[à blanc] ' : ''}${message}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
