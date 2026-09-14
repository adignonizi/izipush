/**
 * Démo du lot 2 : segments et campagnes exécutés par crm-ingest.
 *
 * Joue Izichange (événements RabbitMQ) et remplace l'API Novu par un faux serveur qui enregistre
 * les déclenchements reçus. Segments et campagnes sont écrits directement en base, dans l'état où
 * l'API du dashboard les laisse (le dashboard n'est pas nécessaire pour la démo).
 *
 * Prérequis : docker/crm-dev démarré ; crm-ingest lancé avec
 *   NOVU_API_URL=http://127.0.0.1:3999 NOVU_SECRET_KEY=demo CRM_TICK_MS=2000
 *   node apps/crm-ingest/scripts/demo-lot2.mjs
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import amqp from 'amqplib';

const require = createRequire(import.meta.url);
const { mongoose } = require('@novu/dal');

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://izipush:izipush@127.0.0.1:5673';
const EXCHANGE = process.env.AMQP_EXCHANGE ?? 'mailwizz-topic';
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27018/novu-crm-dev';
const ENVIRONMENT_ID = process.env.CRM_ENVIRONMENT_ID ?? '66e5a0000000000000000001';
const ORGANIZATION_ID = process.env.CRM_ORGANIZATION_ID ?? '66e5a0000000000000000002';
const MOCK_PORT = 3999;

const tag = `d2-${Date.now()}`;
const now = new Date();
const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
const [awa, bintou, cheikh] = ['awa', 'bintou', 'cheikh'].map((name) => `${tag}-${name}`);

// ---- faux Novu : enregistre chaque déclenchement ------------------------------------------------
const triggers = [];
const mock = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    if (request.url === '/v1/events/trigger') {
      triggers.push({ auth: request.headers.authorization, ...JSON.parse(body) });
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: { acknowledged: true, status: 'processed' } }));
    } else {
      response.writeHead(404).end();
    }
  });
});

function event(eventType, userId, minutes, data = {}) {
  return {
    eventType,
    eventId: `${userId}-${eventType}-${minutes}`,
    timestamp: minutesAgo(minutes),
    data: { userId, ...data },
  };
}

async function waitFor(label, check, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Délai dépassé : ${label}`);
}

async function main() {
  await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));
  await mongoose.connect(MONGO_URL);
  const db = mongoose.connection.db;
  const env = new mongoose.Types.ObjectId(ENVIRONMENT_ID);
  const org = new mongoose.Types.ObjectId(ORGANIZATION_ID);

  // ---- 1. Trois clients, via le flux d'événements d'Izichange --------------------------------------
  const connection = await amqp.connect(AMQP_URL);
  const channel = await connection.createChannel();
  const publish = (message) =>
    channel.publish(EXCHANGE, message.eventType, Buffer.from(JSON.stringify(message)), { persistent: true });

  const clients = [
    { id: awa, country: 'CI', volume: 600 },
    { id: bintou, country: 'SN', volume: 120 },
    { id: cheikh, country: 'CI', volume: 800 },
  ];
  for (const client of clients) {
    publish(
      event('account.profile_updated', client.id, 3000, { email: `${client.id}@example.com`, country: client.country })
    );
    publish(event('kyc.approved', client.id, 2900));
    publish(
      event('transaction.completed', client.id, 2800, {
        transactionId: `${client.id}-t1`,
        amount: client.volume,
        product: 'crypto',
      })
    );
  }
  console.log(`Clients : ${clients.map((client) => client.id).join(', ')}`);

  await waitFor('profils à jour', async () => {
    const count = await db
      .collection('subscribers')
      .countDocuments({ _environmentId: env, subscriberId: { $in: [awa, bintou, cheikh] }, 'data.lifetime_tx': 1 });

    return count === 3;
  });
  // Cheikh refuse le marketing (préférence qui arrivera par un événement de consentement).
  await db
    .collection('subscribers')
    .updateOne({ _environmentId: env, subscriberId: cheikh }, { $set: { 'data.marketing_optin': false } });

  // ---- 2. Segments : dynamique (CI ou SN, KYC validé, > 100 USD sur 30 j) et figé (CI) --------------
  const base = { _environmentId: env, _organizationId: org, createdAt: now, updatedAt: now, lockedUntil: null };
  const dynamic = {
    ...base,
    name: `${tag} actifs UEMOA`,
    frozen: false,
    status: 'ready',
    audience: {
      type: 'group',
      combinator: 'and',
      conditions: [
        { type: 'profile', field: 'country_code', operator: 'in', value: ['CI', 'SN'] },
        { type: 'profile', field: 'kyc_status', operator: 'eq', value: 'validated' },
        { type: 'profile', field: 'email', operator: 'in', value: clients.map((client) => `${client.id}@example.com`) },
        { type: 'activity', metric: 'volUsd', windowDays: 30, operator: 'gt', value: 100 },
      ],
    },
  };
  const frozen = {
    ...base,
    name: `${tag} Côte d'Ivoire (figé)`,
    frozen: true,
    status: 'freezing',
    audience: {
      type: 'group',
      combinator: 'and',
      conditions: [
        { type: 'profile', field: 'country_code', operator: 'eq', value: 'CI' },
        { type: 'profile', field: 'email', operator: 'in', value: clients.map((client) => `${client.id}@example.com`) },
      ],
    },
  };
  const { insertedId: dynamicId } = await db.collection('crm_segments').insertOne(dynamic);
  const { insertedId: frozenId } = await db.collection('crm_segments').insertOne(frozen);

  const frozenReady = await waitFor('segment figé', () =>
    db.collection('crm_segments').findOne({ _id: frozenId, status: 'ready' })
  );
  console.log(`Segment figé prêt : ${frozenReady.memberCount} membre(s) dans ${frozenReady.topicKey}`);

  // ---- 3. Campagnes : immédiate sur chaque segment, et « sur événement » kyc.approved ---------------
  const campaign = (name, segmentId, schedule, nextRunAt) => ({
    ...base,
    name: `${tag} ${name}`,
    workflowKey: 'crm-demo',
    segmentId: String(segmentId),
    payload: { offre: 'bonus-crypto' },
    schedule,
    status: 'active',
    nextRunAt,
    runCount: 0,
  });
  const { insertedId: dynamicCampaignId } = await db
    .collection('crm_campaigns')
    .insertOne(campaign('relance dynamique', dynamicId, { mode: 'immediate' }, now));
  const { insertedId: frozenCampaignId } = await db
    .collection('crm_campaigns')
    .insertOne(campaign('relance figée', frozenId, { mode: 'immediate' }, now));
  const { insertedId: onEventCampaignId } = await db
    .collection('crm_campaigns')
    .insertOne(campaign('bienvenue KYC', dynamicId, { mode: 'on_event', eventName: 'kyc.approved' }, null));

  const runOf = (campaignId) =>
    waitFor(`exécution ${campaignId}`, () =>
      db.collection('crm_campaign_runs').findOne({ campaignId: String(campaignId), status: 'triggered' })
    );
  const dynamicRun = await runOf(dynamicCampaignId);
  const frozenRun = await runOf(frozenCampaignId);

  // Nouvel événement récent pour Bintou : doit déclencher la campagne « sur événement », pour elle seule.
  publish(event('kyc.approved', bintou, 1));
  const onEventTrigger = await waitFor('déclenchement sur événement', () =>
    triggers.find((trigger) => trigger.payload?.__crm?.campaignId === String(onEventCampaignId))
  );

  // ---- 4. Résultats -------------------------------------------------------------------------------
  const members = async (topicKey) =>
    (await db.collection('topicsubscribers').find({ topicKey }).toArray())
      .map((row) => row.externalSubscriberId)
      .sort();
  const dynamicMembers = await members(dynamicRun.topicKey);
  const frozenMembers = await members(frozenRun.topicKey);
  const triggerFor = (run) => triggers.filter((trigger) => trigger.transactionId === String(run._id));
  const campaignAfter = await db.collection('crm_campaigns').findOne({ _id: dynamicCampaignId });

  console.log('Exécution dynamique :', {
    audience: dynamicRun.audienceSize,
    exclus: dynamicRun.excludedCount,
    dynamicMembers,
  });
  console.log('Exécution figée     :', {
    audience: frozenRun.audienceSize,
    exclus: frozenRun.excludedCount,
    frozenMembers,
  });
  console.log(
    'Déclenchements reçus par Novu :',
    triggers.map(({ name, to, transactionId }) => ({ name, to, transactionId }))
  );

  const checks = [
    ['segment figé : 2 membres (Awa, Cheikh)', frozenReady.memberCount === 2],
    [
      'exécution dynamique : Awa + Bintou, Cheikh exclu (refus marketing)',
      dynamicMembers.join() === [awa, bintou].sort().join() && dynamicRun.excludedCount === 1,
    ],
    ['exécution figée : Awa seule, Cheikh exclu', frozenMembers.join() === awa && frozenRun.excludedCount === 1],
    [
      'un seul déclenchement par exécution, sur son topic',
      triggerFor(dynamicRun).length === 1 &&
        triggerFor(frozenRun).length === 1 &&
        triggerFor(dynamicRun)[0].to[0].topicKey === dynamicRun.topicKey,
    ],
    [
      'clé secrète et données de campagne transmises',
      triggers.every((trigger) => trigger.auth === 'ApiKey demo' && trigger.payload?.offre === 'bonus-crypto'),
    ],
    [
      'campagne immédiate passée en « completed »',
      campaignAfter.status === 'completed' && campaignAfter.runCount === 1,
    ],
    [
      'sur événement : Bintou seule, avec l’événement',
      onEventTrigger.to.join() === bintou && onEventTrigger.payload.event?.name === 'kyc.approved',
    ],
    [
      'événements anciens ignorés par la campagne sur événement',
      triggers.filter((trigger) => trigger.payload?.__crm?.campaignId === String(onEventCampaignId)).length === 1,
    ],
  ];

  console.log('');
  for (const [label, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${label}`);

  await channel.close();
  await connection.close();
  await mongoose.disconnect();
  mock.close();

  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  mock.close();
  process.exit(1);
});
