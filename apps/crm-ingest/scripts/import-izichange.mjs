/**
 * Import initial : transforme les exports d'Izichange (utilisateurs, transactions) en événements CRM
 * et les publie sur RabbitMQ, comme le ferait Izichange. crm-ingest les traite ensuite normalement
 * (profils, activité quotidienne, cumuls). Rejouable sans risque : chaque ligne donne toujours le même
 * eventId, un second passage est écarté comme doublon. Les événements importés ne déclenchent aucune campagne.
 *
 *   AMQP_URL=… node scripts/import-izichange.mjs --users users.csv --transactions transactions.csv
 *
 * Options :
 *   --map mapping.json   noms de colonnes et valeurs propres aux exports (voir DEFAULT_MAPPING ci-dessous)
 *   --rate 1000          événements publiés par seconde au plus
 *   --dry-run            n'envoie rien : affiche les premiers événements et les totaux
 *
 * CSV : séparateur « , » ou « ; » détecté sur l'en-tête, guillemets et retours à la ligne dans les champs gérés.
 * Montants : en USD (colonne amountUsd). Dates : ISO 8601 ou « AAAA-MM-JJ HH:MM:SS » (UTC).
 */
import { createReadStream, readFileSync } from 'node:fs';
import amqp from 'amqplib';

const DEFAULT_MAPPING = {
  users: {
    id: 'id',
    email: 'email',
    firstName: 'first_name',
    lastName: 'last_name',
    phone: 'phone',
    country: 'country',
    locale: 'locale',
    createdAt: 'created_at',
    kycStatus: 'kyc_status',
    kycAt: 'kyc_updated_at',
    lastLoginAt: 'last_login_at',
    timezone: 'timezone',
  },
  /** Seule la validation est reprise : l'absence d'événement vaut « non validé ». */
  kycValidatedValues: ['approved', 'validated', 'verified', 'valide', 'validé'],
  transactions: {
    id: 'id',
    userId: 'user_id',
    amountUsd: 'amount_usd',
    status: 'status',
    productId: 'productId',
    type: 'type',
    createdAt: 'created_at',
  },
  /** Seules les transactions réussies alimentent l'activité. */
  transactionStatus: {
    completed: ['completed', 'success', 'successful', 'done', 'validated', 'paid'],
  },
};

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);

  return index === -1 ? undefined : args[index + 1];
};
const flag = (name) => args.includes(`--${name}`);

const usersFile = option('users');
const transactionsFile = option('transactions');
const rate = Math.max(1, Number(option('rate') ?? 1000));
const dryRun = flag('dry-run');
const mapping = mergeMapping(DEFAULT_MAPPING, option('map') ? JSON.parse(readFileSync(option('map'), 'utf8')) : {});

if ((!usersFile && !transactionsFile) || (!dryRun && !process.env.AMQP_URL)) {
  console.error(
    'Usage : AMQP_URL=… node scripts/import-izichange.mjs --users u.csv [--transactions t.csv] [--map m.json] [--dry-run]'
  );
  process.exit(1);
}

const EXCHANGE = process.env.AMQP_EXCHANGE ?? 'mailwizz-topic';
const stats = { published: 0, skipped: {}, byEvent: {} };
const preview = [];

const connection = dryRun ? null : await amqp.connect(process.env.AMQP_URL);
const channel = connection ? await connection.createConfirmChannel() : null;
const startedAt = Date.now();

if (usersFile) await importFile(usersFile, userEvents);
if (transactionsFile) await importFile(transactionsFile, transactionEvents);

if (channel) {
  await channel.waitForConfirms();
  await channel.close();
  await connection.close();
}

if (dryRun) console.log(JSON.stringify(preview, null, 2));
console.log(JSON.stringify({ dryRun, ...stats, seconds: Math.round((Date.now() - startedAt) / 1000) }, null, 2));

// ————————————————————————————————————————————————————————————————

function userEvents(row) {
  const col = (key) => cell(row, mapping.users[key]);
  const userId = col('id');
  if (!userId) return skip('utilisateur sans id');

  const createdAt = date(col('createdAt'));
  if (!createdAt) return skip('utilisateur sans date de création valide');

  const events = [
    event('account.registered', `user:${userId}:registered`, createdAt, userId, {
      email: col('email') || undefined,
      first_name: col('firstName') || undefined,
      last_name: col('lastName') || undefined,
      phone_number: col('phone') || undefined,
      country_code: col('country') || undefined,
      language: col('locale') || undefined,
      timezone: col('timezone') || undefined,
    }),
  ];

  // Seule la validation est reprise : l'absence d'événement vaut « non validé ».
  if (kycValidated(col('kycStatus'))) {
    events.push(event('kyc.validated', `user:${userId}:kyc`, date(col('kycAt')) ?? createdAt, userId));
  }

  const lastLogin = date(col('lastLoginAt'));
  if (lastLogin) events.push(event('account.logged_in', `user:${userId}:last-login`, lastLogin, userId));

  return events;
}

function transactionEvents(row) {
  const col = (key) => cell(row, mapping.transactions[key]);
  const transactionId = col('id');
  const userId = col('userId');
  if (!transactionId || !userId) return skip('transaction sans id ou sans utilisateur');

  const status = col('status').toLowerCase();
  if (!mapping.transactionStatus.completed.includes(status)) {
    return skip(`transaction au statut non suivi (${status || 'vide'})`);
  }

  const occurredAt = date(col('createdAt'));
  if (!occurredAt) return skip('transaction sans date valide');

  const amount = col('amountUsd').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(amount)) return skip('transaction sans montant USD valide');

  return [
    event('transaction.completed', `tx:${transactionId}`, occurredAt, userId, {
      productCode: col('productId') || 'unknown',
      amount_usd: amount,
      type: col('type') || undefined,
    }),
  ];
}

function kycValidated(value) {
  return mapping.kycValidatedValues.includes(value.toLowerCase());
}

// Enveloppe Izichange (02_Contrat_Evenement). `imported` reste dans le payload : il marque les faits
// repris de l'historique, qui ne doivent déclencher aucune campagne.
function event(eventName, id, occurredAt, userId, { productCode, ...payload } = {}) {
  const clean = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

  return {
    event_id: `import:${id}`,
    event_name: eventName,
    schema_version: 1,
    occurred_at: occurredAt.toISOString(),
    published_at: new Date().toISOString(),
    user_id: userId,
    ...(productCode ? { product_code: productCode } : {}),
    source: 'batch_crm',
    test_flag: false,
    payload: { ...clean, imported: true },
  };
}

function skip(reason) {
  stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;

  return [];
}

function cell(row, column) {
  return column ? String(row[column] ?? '').trim() : '';
}

function date(value) {
  if (!value) return null;

  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const parsed = new Date(iso);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function importFile(file, toEvents) {
  let windowStart = Date.now();
  let inWindow = 0;

  for await (const row of readCsv(file)) {
    for (const message of toEvents(row)) {
      stats.byEvent[message.event_name] = (stats.byEvent[message.event_name] ?? 0) + 1;

      if (dryRun) {
        if (preview.length < 5) preview.push(message);
        continue;
      }

      channel.publish(EXCHANGE, message.event_name, Buffer.from(JSON.stringify(message)), { persistent: true });
      stats.published++;
      inWindow++;

      if (stats.published % 1000 === 0) {
        await channel.waitForConfirms();
        process.stdout.write(`\r${stats.published} événements publiés`);
      }

      if (inWindow >= rate) {
        const elapsed = Date.now() - windowStart;
        if (elapsed < 1000) await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
        windowStart = Date.now();
        inWindow = 0;
      }
    }
  }

  if (!dryRun) process.stdout.write('\n');
}

/** Lecteur CSV en flux (RFC 4180) : une ligne = un objet { colonne: valeur }. */
async function* readCsv(file) {
  let header = null;
  let delimiter = null;
  let field = '';
  let record = [];
  let quoted = false;
  let pendingQuote = false;

  const finishRecord = function* () {
    record.push(field);
    field = '';
    if (!header) {
      header = record.map((name) => name.replace(/^﻿/, '').trim());
    } else if (record.length > 1 || record[0] !== '') {
      yield Object.fromEntries(header.map((name, index) => [name, record[index] ?? '']));
    }
    record = [];
  };

  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    if (!delimiter) {
      const firstLine = chunk.split(/\r?\n/, 1)[0];
      delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
    }

    for (const char of chunk) {
      if (quoted) {
        if (pendingQuote) {
          pendingQuote = false;
          if (char === '"') {
            field += '"';
            continue;
          }
          quoted = false;
        } else if (char === '"') {
          pendingQuote = true;
          continue;
        } else {
          field += char;
          continue;
        }
      }

      if (char === '"' && field === '') quoted = true;
      else if (char === delimiter) {
        record.push(field);
        field = '';
      } else if (char === '\n') yield* finishRecord();
      else if (char !== '\r') field += char;
    }
  }

  if (field !== '' || record.length) yield* finishRecord();
}

function mergeMapping(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...base[key], ...value } : value;
  }

  return merged;
}
