/**
 * Démo du lot 1 : joue le rôle d'Izichange (webhook Keycloak + messages RabbitMQ),
 * puis vérifie dans Mongo ce que crm-ingest en a fait.
 *
 * Prérequis : docker/crm-dev démarré et crm-ingest lancé avec src/.env (copie de src/.example.env).
 *   node apps/crm-ingest/scripts/demo-lot1.mjs
 */
import { createRequire } from 'node:module';
import amqp from 'amqplib';

const require = createRequire(import.meta.url);
const { mongoose } = require('@novu/dal');

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://izipush:izipush@127.0.0.1:5673';
const EXCHANGE = process.env.AMQP_EXCHANGE ?? 'mailwizz-topic';
const DEAD_LETTERS = `${process.env.AMQP_QUEUE ?? 'izipush.crm-ingest'}.dlq`;
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/novu-crm-dev';
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'http://127.0.0.1:3010/v1/webhooks/keycloak';
const ENVIRONMENT_ID = process.env.CRM_ENVIRONMENT_ID ?? '66e5a0000000000000000001';

const userId = `demo-${Date.now()}`;
const t0 = Date.parse('2026-09-01T08:00:00.000Z');
const iso = (offsetMinutes) => new Date(t0 + offsetMinutes * 60_000).toISOString();

// Enveloppe Izichange (02_Contrat_Evenement).
const bus = (eventName, id, offset, { productCode, ...payload } = {}) => ({
  event_id: `${userId}-${id}`,
  event_name: eventName,
  schema_version: 1,
  occurred_at: iso(offset),
  published_at: new Date().toISOString(),
  user_id: userId,
  ...(productCode ? { product_code: productCode } : {}),
  source: 'backend_core',
  test_flag: false,
  payload,
});

const rabbitMessages = [
  bus('kyc.validated', 'kyc', 120),
  bus('transaction.completed', 'tx-1', 180, { productCode: 'crypto', amount_usd: 120.5, type: 'buy', txNo: 1 }),
  bus('transaction.completed', 'tx-2', 240, { productCode: 'crypto', amount_usd: '30', type: 'sell', txNo: 2 }),
  // Doublon exact de tx-1 (republication) : ne doit pas compter deux fois.
  bus('transaction.completed', 'tx-1', 180, { productCode: 'crypto', amount_usd: 120.5, type: 'buy', txNo: 1 }),
  // Événement de recette : acquitté, jamais appliqué au profil.
  { ...bus('transaction.completed', 'tx-test', 305, { productCode: 'crypto', amount_usd: 999 }), test_flag: true },
  // Inexploitable : doit finir dans la file d'erreurs.
  bus('transaction.completed', 'tx-bad', 310, { productCode: 'crypto', amount_usd: 'abc' }),
];

async function main() {
  console.log(`Client de démo : ${userId}\n`);

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `${userId}-register`,
      time: t0,
      type: 'REGISTER',
      realmId: 'izichange',
      userId,
      details: { email: `${userId}@example.com`, firstName: 'Awa', lastName: 'Koné', country: 'ci' },
    }),
  });
  console.log(`Webhook Keycloak REGISTER → HTTP ${response.status}`);

  const connection = await amqp.connect(AMQP_URL);
  const channel = await connection.createChannel();
  const deadLettersBefore = (await channel.checkQueue(DEAD_LETTERS)).messageCount;
  for (const message of rabbitMessages) {
    channel.publish(EXCHANGE, message.event_name, Buffer.from(JSON.stringify(message)), { persistent: true });
  }
  console.log(`RabbitMQ → ${rabbitMessages.length} messages publiés sur ${EXCHANGE}\n`);

  await mongoose.connect(MONGO_URL);
  const db = mongoose.connection.db;
  const envId = new mongoose.Types.ObjectId(ENVIRONMENT_ID);

  let subscriber;
  for (let attempt = 0; attempt < 30; attempt++) {
    subscriber = await db.collection('subscribers').findOne({ _environmentId: envId, subscriberId: userId });
    if (subscriber?.data?.lifetime_tx === 2 && subscriber?.data?.kyc_status) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const activity = await db.collection('crm_activity_daily').find({ subscriberId: userId }).toArray();
  const events = await db.collection('crm_events').countDocuments({ subscriberId: userId });
  const pending = await db.collection('crm_events').countDocuments({ subscriberId: userId, derivedAt: null });
  const deadLettersAfter = (await channel.checkQueue(DEAD_LETTERS)).messageCount;

  console.log('Subscriber :', {
    email: subscriber?.email,
    firstName: subscriber?.firstName,
    lastName: subscriber?.lastName,
    data: subscriber?.data,
  });
  console.log(
    'Activité :',
    activity.map(({ day, productId, tx, volUsd, txFailed }) => ({ day, productId, tx, volUsd, txFailed }))
  );

  const checks = [
    ['profil créé depuis Keycloak', subscriber?.email === `${userId}@example.com` && subscriber?.firstName === 'Awa'],
    ['pays normalisé', subscriber?.data?.country_code === 'CI'],
    ['KYC validé', subscriber?.data?.kyc_status === 'validated'],
    ['doublon ignoré : 2 transactions', subscriber?.data?.lifetime_tx === 2],
    ['volume à vie 150.5 USD', subscriber?.data?.lifetime_vol_usd === 150.5],
    ['activité du jour : 2 transactions', activity.length === 1 && activity[0].tx === 2],
    ['client lié au produit crypto', subscriber?.data?.products?.join() === 'crypto'],
    ['événement de recette écarté', subscriber?.data?.lifetime_vol_usd === 150.5],
    ['4 événements journalisés, aucun en attente', events === 4 && pending === 0],
    ['message invalide dans la file d’erreurs', deadLettersAfter === deadLettersBefore + 1],
  ];

  console.log('');
  for (const [label, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${label}`);

  await channel.close();
  await connection.close();
  await mongoose.disconnect();

  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
