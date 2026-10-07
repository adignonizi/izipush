import { expect } from 'chai';
import { createSign, generateKeyPairSync, KeyObject } from 'crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { JwksService, verifierUrlSortante } from './jwks.service';
import { KeycloakTokenError, verifierJeton } from './keycloak-token';

/* Un vrai serveur HTTP qui répond comme le ferait un realm Keycloak. Docker n'est pas
   disponible ici, mais ce qu'on veut éprouver est le DIALOGUE : le chemin interrogé, le
   rechargement sur `kid` inconnu, l'anti-rafale, et la survie à une panne du realm. Un
   faux objet ne dirait rien de tout ça. */
type Realm = {
  url: string;
  requetes: () => number;
  servirCles: (cles: Array<{ kid: string; cle: KeyObject; use?: string; alg?: string }>) => void;
  tomber: (enPanne: boolean) => void;
  fermer: () => Promise<void>;
  cheminsVus: string[];
};

async function demarrerRealm(): Promise<Realm> {
  let cles: Array<{ kid: string; cle: KeyObject; use?: string; alg?: string }> = [];
  let enPanne = false;
  let requetes = 0;
  const cheminsVus: string[] = [];

  const serveur: Server = createServer((req, res) => {
    requetes += 1;
    cheminsVus.push(req.url ?? '');

    if (enPanne) {
      res.writeHead(503).end();

      return;
    }

    const keys = cles.map(({ kid, cle, use, alg }) => ({
      ...(cle.export({ format: 'jwk' }) as object),
      kid,
      use: use ?? 'sig',
      alg: alg ?? 'RS256',
    }));

    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys }));
  });

  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const { port } = serveur.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/realms/izi`,
    requetes: () => requetes,
    servirCles: (nouvelles) => {
      cles = nouvelles;
    },
    tomber: (valeur) => {
      enPanne = valeur;
    },
    fermer: () => new Promise<void>((resolve) => serveur.close(() => resolve())),
    cheminsVus,
  };
}

const journal = { setContext: () => undefined, warn: () => undefined, error: () => undefined } as never;

describe('JwksService — dialogue avec un realm', () => {
  let realm: Realm;
  const paire1 = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const paire2 = generateKeyPairSync('rsa', { modulusLength: 2048 });

  beforeEach(async () => {
    realm = await demarrerRealm();
    realm.servirCles([{ kid: 'cle-1', cle: paire1.publicKey }]);
  });

  afterEach(async () => {
    await realm.fermer();
  });

  it('interroge le chemin JWKS de Keycloak', async () => {
    await new JwksService(journal).cle(realm.url, 'cle-1');

    expect(realm.cheminsVus[0]).to.equal('/realms/izi/protocol/openid-connect/certs');
  });

  it('rend une clé qui vérifie réellement un jeton', async () => {
    const cle = await new JwksService(journal).cle(realm.url, 'cle-1');

    const entete = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'cle-1' })).toString('base64url');
    const charge = Buffer.from(
      JSON.stringify({ iss: realm.url, sub: 'usr_1', exp: Math.floor(Date.now() / 1000) + 300 })
    ).toString('base64url');
    const signeur = createSign('RSA-SHA256');
    signeur.update(`${entete}.${charge}`);
    const jeton = `${entete}.${charge}.${signeur.sign(paire1.privateKey).toString('base64url')}`;

    expect(verifierJeton(jeton, cle, { issuer: realm.url })).to.equal('usr_1');
  });

  it('met le jeu de clés en cache : une seule requête pour deux lectures', async () => {
    const service = new JwksService(journal);

    await service.cle(realm.url, 'cle-1');
    await service.cle(realm.url, 'cle-1');

    expect(realm.requetes()).to.equal(1);
  });

  /* La rotation de clés d'un realm se manifeste exactement comme ça : un `kid` inconnu.
     Sans rechargement, tous les enregistrements échoueraient jusqu'à l'expiration du cache. */
  it('recharge quand le kid est inconnu, et trouve la clé neuve', async () => {
    const service = new JwksService(journal);
    await service.cle(realm.url, 'cle-1');

    realm.servirCles([
      { kid: 'cle-1', cle: paire1.publicKey },
      { kid: 'cle-2', cle: paire2.publicKey },
    ]);

    expect(await service.cle(realm.url, 'cle-2')).to.be.ok;
    expect(realm.requetes()).to.equal(2);
  });

  /* Sans anti-rafale, une rafale de jetons au `kid` bidon déclencherait une requête par jeton :
     on transformerait une tentative en déni de service contre notre propre fournisseur
     d'identité. */
  it('ne recharge pas en rafale pour un kid introuvable', async () => {
    const service = new JwksService(journal);
    await service.cle(realm.url, 'cle-1');

    for (let i = 0; i < 5; i += 1) {
      await service.cle(realm.url, 'inconnu').catch(() => undefined);
    }

    expect(realm.requetes(), 'une seule tentative de rechargement').to.equal(2);
  });

  it('lève pour un kid introuvable', async () => {
    let leve: unknown;
    try {
      await new JwksService(journal).cle(realm.url, 'absent');
    } catch (erreur) {
      leve = erreur;
    }

    expect(leve).to.be.instanceOf(KeycloakTokenError);
  });

  /* Le comportement qui compte en exploitation : une panne Keycloak ne doit pas interrompre
     les enregistrements de jetons push. */
  it('continue de servir le jeu précédent quand le realm tombe', async () => {
    const service = new JwksService(journal);
    await service.cle(realm.url, 'cle-1');

    realm.tomber(true);

    expect(await service.cle(realm.url, 'cle-1')).to.be.ok;
  });

  it('refuse d’emblée si le realm est injoignable et qu’on n’a rien en cache', async () => {
    realm.tomber(true);

    let leve: unknown;
    try {
      await new JwksService(journal).cle(realm.url, 'cle-1');
    } catch (erreur) {
      leve = erreur;
    }

    expect(leve).to.be.instanceOf(KeycloakTokenError);
  });

  /* Keycloak publie aussi des clés de chiffrement : elles ne vérifieront jamais une signature,
     et les retenir ferait croire qu'on a la bonne clé. */
  it('ignore les clés qui ne servent pas à signer', async () => {
    realm.servirCles([{ kid: 'chiffrement', cle: paire1.publicKey, use: 'enc' }]);

    let leve: unknown;
    try {
      await new JwksService(journal).cle(realm.url, 'chiffrement');
    } catch (erreur) {
      leve = erreur;
    }

    expect(leve).to.be.instanceOf(KeycloakTokenError);
  });
});

describe('JwksService — URL sortante', () => {
  /* L'émetteur détermine l'URL que l'API va chercher : une valeur réglée dans le tableau de
     bord déclenche un appel sortant depuis nos serveurs. Ces refus sont ce qui empêche de
     s'en servir pour viser l'intérieur du réseau. */
  it('refuse http vers autre chose qu’un hôte local', () => {
    for (const url of ['http://keycloak.exemple.com/realms/x', 'http://10.0.0.5/realms/x']) {
      expect(() => verifierUrlSortante(url), url).to.throw(KeycloakTokenError, /https exigé/);
    }
  });

  it('refuse une adresse IP littérale, même en https', () => {
    for (const url of ['https://10.0.0.5/realms/x', 'https://169.254.169.254/realms/x']) {
      expect(() => verifierUrlSortante(url), url).to.throw(KeycloakTokenError, /adresse IP littérale/);
    }
  });

  it('accepte https vers un nom d’hôte, et http vers localhost', () => {
    expect(() => verifierUrlSortante('https://keycloak.izichange.com/realms/izichange')).to.not.throw();
    expect(() => verifierUrlSortante('http://localhost:8088/realms/izichange')).to.not.throw();
    expect(() => verifierUrlSortante('http://127.0.0.1:8088/realms/izichange')).to.not.throw();
  });

  it('refuse ce qui n’est pas une URL', () => {
    expect(() => verifierUrlSortante('pas-une-url')).to.throw(KeycloakTokenError, /URL invalide/);
  });
});
