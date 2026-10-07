/**
 * Envoie des événements de test sur RabbitMQ, au format d'Izichange, pour un ou plusieurs clients.
 * À lancer là où crm-ingest tourne (mêmes variables AMQP_URL / AMQP_EXCHANGE) :
 *
 *   node scripts/send-events.mjs <subscriberId> [<subscriberId>…]
 *       → inscription (pays, prénom), KYC validé, deux transactions crypto récentes, pour chaque client
 *   node scripts/send-events.mjs --event kyc.validated <subscriberId>
 *       → un seul événement, horodaté maintenant (utile pour une campagne « sur événement »)
 *
 * Options : --country CI  --amount 150  --product crypto   (identifiant du produit)
 */
import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';

const AMQP_URL = process.env.AMQP_URL;
const EXCHANGE = process.env.AMQP_EXCHANGE ?? 'mailwizz-topic';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const [value] = args.splice(index, 2).slice(1);

  return value;
};
const singleEvent = option('event');
const country = option('country', 'CI');
const amount = Number(option('amount', '150'));
const product = option('product', 'crypto');
const subscriberIds = args;

if (!AMQP_URL || !subscriberIds.length) {
  console.error('Usage : AMQP_URL=… node scripts/send-events.mjs [--event <nom>] <subscriberId> […]');
  process.exit(1);
}

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
// Enveloppe Izichange (02_Contrat_Evenement) : product_code à la racine, payload à part.
const message = (eventName, userId, minutes, { productCode, ...payload } = {}) => ({
  event_id: `test-${randomUUID()}`,
  event_name: eventName,
  schema_version: 1,
  occurred_at: minutesAgo(minutes),
  published_at: new Date().toISOString(),
  user_id: userId,
  ...(productCode ? { product_code: productCode } : {}),
  source: 'batch_crm',
  test_flag: false,
  payload,
});

function eventsFor(userId) {
  if (singleEvent) return [message(singleEvent, userId, 0)];

  return [
    message('account.profile_updated', userId, 120, { country_code: country, first_name: 'Client test' }),
    message('kyc.validated', userId, 90),
    message('transaction.completed', userId, 60, { productCode: product, amount_usd: amount, type: 'buy', txNo: 1 }),
    message('transaction.completed', userId, 30, { productCode: product, amount_usd: amount / 2, type: 'sell', txNo: 2 }),
  ];
}

const connection = await amqp.connect(AMQP_URL);
const channel = await connection.createConfirmChannel();

let sent = 0;
for (const userId of subscriberIds) {
  for (const event of eventsFor(userId)) {
    channel.publish(EXCHANGE, event.event_name, Buffer.from(JSON.stringify(event)), { persistent: true });
    sent++;
  }
}
await channel.waitForConfirms();
console.log(`${sent} événement(s) publiés sur ${EXCHANGE} pour ${subscriberIds.length} client(s)`);

await channel.close();
await connection.close();
