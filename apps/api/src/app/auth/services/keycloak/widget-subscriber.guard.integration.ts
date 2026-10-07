/**
 * Éprouve la garde avec de VRAIES dépendances : MongoDB, et un Keycloak qui tourne.
 *
 * Ce n'est pas un test unitaire — il exige des services externes, d'où l'extension `.integration`
 * qui le tient hors de la campagne habituelle. Il répond aux questions qu'aucun test en isolation
 * ne peut trancher, et surtout à celle-ci : **le chemin historique fonctionne-t-il encore** pour un
 * environnement non migré, alors que la garde a remplacé `AuthGuard('subscriberJwt')` ?
 *
 * La garde est instanciée À LA MAIN plutôt que par un module NestJS. Les modules de l'application
 * se chargent mutuellement par `forwardRef` et ne se compilent pas hors d'`AppModule` ; une
 * instanciation directe vérifie le COMPORTEMENT, qui est ce qui nous intéresse ici. L'injection,
 * elle, se vérifie au démarrage de l'API.
 *
 * La création de l'abonné est observée par un double : c'est l'usecase de Novu, déjà éprouvé par
 * `session/initialize` dont il vient. Ce qu'on vérifie est qu'on l'appelle avec les bons arguments
 * — les claims du jeton, et non un corps de requête.
 */
import mongoose from 'mongoose';

import { JwksService } from './jwks.service';
import { WidgetSubscriberGuard } from './widget-subscriber.guard';

const ISSUER = process.env.KEYCLOAK_ISSUER!;
const CLIENT = 'izipay-mobile';

const journal = { setContext: () => undefined, warn: () => undefined, error: () => undefined } as never;

function contexte(headers: Record<string, string>) {
  const request: Record<string, unknown> = { headers, url: '/v1/widgets/credentials' };

  return {
    requete: request,
    ctx: {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
      getHandler: () => () => undefined,
      getClass: () => class {},
      getType: () => 'http',
    } as never,
  };
}

async function jetonKeycloak(client: string): Promise<string> {
  const reponse = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, grant_type: 'password', username: 'client-test', password: 'test' }),
  });
  const corps = (await reponse.json()) as { access_token?: string; error_description?: string };
  if (!corps.access_token) throw new Error(`jeton refusé par Keycloak : ${corps.error_description}`);

  return corps.access_token;
}

let reussis = 0;
let echoues = 0;

async function essai(nom: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  OK      ${nom}`);
    reussis += 1;
  } catch (erreur) {
    console.log(`  ECHEC   ${nom}`);
    console.log(`          ${(erreur as Error).message.split('\n')[0]}`);
    echoues += 1;
  }
}

function affirmer(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

/** Message de l'erreur levée, ou chaîne vide si la garde a accepté. */
async function refus(garde: WidgetSubscriberGuard, ctx: never): Promise<string> {
  try {
    await garde.canActivate(ctx);

    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

(async () => {
  /*
   * `DalService` et non `mongoose.connect` : les modèles du DAL sont enregistrés sur SA connexion,
   * pas sur celle par défaut. Avec la mauvaise, chaque écriture reste en tampon puis expire au bout
   * de dix secondes — un symptôme qui ne dit pas du tout qu'on s'est trompé de connexion.
   */
  const { DalService, EnvironmentRepository } = require('@novu/dal');
  const dal = new DalService();
  await dal.connect(process.env.MONGO_URL!);

  const environnements = new EnvironmentRepository();

  // Double de l'usecase : on observe l'appel, sans réimplémenter la création.
  const creations: Array<Record<string, unknown>> = [];
  const creation = {
    execute: async (commande: Record<string, unknown>) => {
      creations.push(commande);

      return { _id: 'abonne-fictif', subscriberId: commande.subscriberId, email: commande.email };
    },
  };

  const garde = new WidgetSubscriberGuard(environnements, new JwksService(journal), creation as never, journal);

  const identifiant = `essai-${Date.now()}`;
  const env = await environnements.create({
    name: 'Essai local',
    identifier: identifiant,
    _organizationId: new mongoose.Types.ObjectId().toString(),
    apiKeys: [],
  });
  const envId = String(env._id);

  console.log('── 1. environnement NON migré : le chemin historique doit survivre ──');

  await essai('sans en-tête d’environnement, la garde ne prend PAS le chemin Keycloak', async () => {
    const message = await refus(garde, contexte({ authorization: 'Bearer pas-un-jwt' }).ctx);
    affirmer(message, 'la garde aurait dû refuser un JWT bidon');
    affirmer(
      !/émetteur|client inattendu|kid|realm|Keycloak/.test(message),
      `refus de type Keycloak alors que l’environnement n’est pas migré : ${message}`
    );
  });

  await essai('avec en-tête mais sans émetteur réglé, délègue aussi', async () => {
    const message = await refus(
      garde,
      contexte({ authorization: 'Bearer pas-un-jwt', 'novu-application-identifier': identifiant }).ctx
    );
    affirmer(message, 'la garde aurait dû refuser');
    affirmer(!/émetteur|realm|Keycloak/.test(message), `chemin Keycloak emprunté à tort : ${message}`);
  });

  console.log('\n── 2. environnement migré : le jeton Keycloak ──');
  await environnements.update({ _id: envId }, { $set: { keycloakAuth: { issuer: ISSUER, audience: CLIENT } } });

  await essai('un vrai jeton est accepté, et la session porte le profil du jeton', async () => {
    const jeton = await jetonKeycloak(CLIENT);
    const { ctx, requete } = contexte({
      authorization: `Bearer ${jeton}`,
      'novu-application-identifier': identifiant,
    });

    affirmer(await garde.canActivate(ctx), 'la garde aurait dû accepter');

    const session = requete.user as { subscriberId?: string; environmentId?: string };
    affirmer(session?.subscriberId, 'aucune session posée sur la requête');
    affirmer(session.environmentId === envId, `environnement inattendu : ${session.environmentId}`);
  });

  await essai('l’abonné est créé depuis les claims VÉRIFIÉS, pas depuis un corps', async () => {
    affirmer(creations.length === 1, `${creations.length} création(s) au lieu d’une`);
    const c = creations[0];
    affirmer(c.email === 'client-test@izichange.test', `email inattendu : ${c.email}`);
    affirmer(c.firstName === 'Client', `prénom inattendu : ${c.firstName}`);
    affirmer(c.lastName === 'Test', `nom inattendu : ${c.lastName}`);
    affirmer(c.phone === undefined, `phone devrait être absent du jeton, obtenu : ${c.phone}`);
    affirmer(c.allowUpdate === true, 'allowUpdate attendu à true : la source est vérifiée');
    affirmer(String(c.environmentId) === envId, 'environnement inattendu dans la commande');
  });

  await essai('un jeton d’un AUTRE client du realm est refusé', async () => {
    const jeton = await jetonKeycloak('outil-interne');
    const message = await refus(
      garde,
      contexte({ authorization: `Bearer ${jeton}`, 'novu-application-identifier': identifiant }).ctx
    );
    affirmer(/client inattendu/.test(message), `refus attendu sur le client, obtenu : ${message || '(accepté !)'}`);
  });

  await essai('une signature bricolée est refusée', async () => {
    const jeton = await jetonKeycloak(CLIENT);
    const [h, p, s] = jeton.split('.');
    const message = await refus(
      garde,
      contexte({
        authorization: `Bearer ${h}.${p}.${s.slice(0, -4)}AAAA`,
        'novu-application-identifier': identifiant,
      }).ctx
    );
    affirmer(/signature invalide/.test(message), `refus attendu sur la signature, obtenu : ${message || '(accepté !)'}`);
  });

  await essai('un émetteur mal réglé dit « émetteur inattendu », pas une panne réseau', async () => {
    await environnements.update(
      { _id: envId },
      { $set: { keycloakAuth: { issuer: `${ISSUER}-inexistant`, audience: CLIENT } } }
    );
    const jeton = await jetonKeycloak(CLIENT);
    const message = await refus(
      garde,
      contexte({ authorization: `Bearer ${jeton}`, 'novu-application-identifier': identifiant }).ctx
    );
    affirmer(/émetteur inattendu/.test(message), `message attendu « émetteur inattendu », obtenu : ${message}`);
  });

  await environnements.delete({ _id: envId }).catch(() => undefined);
  await dal.disconnect().catch(() => undefined);

  console.log(`\n${reussis} réussis, ${echoues} échoués`);
  process.exit(echoues ? 1 : 0);
})().catch((e) => {
  console.error('ARRÊT :', e.message);
  process.exit(2);
});
