import { expect } from 'chai';
import { createSign, generateKeyPairSync, KeyObject } from 'crypto';

import {
  cleDepuisJwk,
  KeycloakTokenError,
  lireEntete,
  profilDepuisClaims,
  verifierEmetteurAnnonce,
  verifierJeton,
} from './keycloak-token';

const ISSUER = 'https://keycloak.exemple.com/realms/izichange';
const CLIENT = 'izipay-mobile';

/* De vraies paires de clés et de vraies signatures : une vérification de signature testée
   avec des jetons factices ne prouverait rien du tout. */
const realm = generateKeyPairSync('rsa', { modulusLength: 2048 });
const autre = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (valeur: unknown) => Buffer.from(JSON.stringify(valeur)).toString('base64url');

function forger(
  charge: Record<string, unknown>,
  options: { cle?: KeyObject; alg?: string; kid?: string | null } = {}
): string {
  const entete: Record<string, unknown> = { alg: options.alg ?? 'RS256', typ: 'JWT' };
  if (options.kid !== null) entete.kid = options.kid ?? 'cle-1';

  const corps = `${b64(entete)}.${b64(charge)}`;
  const signeur = createSign('RSA-SHA256');
  signeur.update(corps);

  return `${corps}.${signeur.sign(options.cle ?? realm.privateKey).toString('base64url')}`;
}

const dans = (secondes: number) => Math.floor(Date.now() / 1000) + secondes;

/**
 * Charge d'un jeton Keycloak normal, relevée sur un realm RÉEL.
 *
 * **`aud` est volontairement absent.** C'est la forme qu'un Keycloak 26 produit pour un client
 * public : seul `azp` porte le client. Un test qui supposerait `aud: 'account'` passerait tout en
 * validant une forme qui n'existe pas — et le contrôle du client ne serait éprouvé que sur la
 * branche qui ne sert jamais.
 */
const valide = (extra: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  sub: 'usr_8H2K9LM',
  azp: CLIENT,
  exp: dans(300),
  ...extra,
});

const attendu = { issuer: ISSUER, audience: CLIENT };
const cle = () => cleDepuisJwk(realm.publicKey.export({ format: 'jwk' }) as never);

describe('jeton Keycloak — en-tête', () => {
  it('rend l’algorithme et le kid', () => {
    expect(lireEntete(forger(valide()))).to.deep.equal({ alg: 'RS256', kid: 'cle-1' });
  });

  /* La faille classique des JWT : faire confiance à l'algorithme que le jeton annonce.
     `none` passerait sans signature, et HS256 ferait vérifier une signature symétrique avec
     la clé PUBLIQUE du realm — publique, donc forgeable par quiconque. */
  it('refuse tout algorithme autre que RS256', () => {
    for (const alg of ['none', 'HS256', 'RS512', 'ES256']) {
      expect(() => lireEntete(forger(valide(), { alg })), alg).to.throw(KeycloakTokenError, /algorithme refusé/);
    }
  });

  it('refuse un en-tête sans kid — on ne saurait quelle clé demander', () => {
    expect(() => lireEntete(forger(valide(), { kid: null }))).to.throw(KeycloakTokenError, /kid absent/);
  });

  it('refuse un jeton malformé', () => {
    for (const texte of ['', 'abc', 'a.b', 'a.b.c.d']) {
      expect(() => lireEntete(texte), JSON.stringify(texte)).to.throw(KeycloakTokenError);
    }
  });
});

describe('jeton Keycloak — vérification', () => {
  it('accepte un jeton normal et rend le sub', () => {
    expect(verifierJeton(forger(valide()), cle(), attendu).subscriberId).to.equal('usr_8H2K9LM');
  });

  /* Le contrôle qui porte tout le reste. */
  it('refuse une signature d’une autre clé', () => {
    expect(() => verifierJeton(forger(valide(), { cle: autre.privateKey }), cle(), attendu)).to.throw(
      KeycloakTokenError,
      /signature invalide/
    );
  });

  it('refuse une charge altérée après signature', () => {
    const [h, , s] = forger(valide()).split('.');
    const falsifie = `${h}.${b64(valide({ sub: 'victime' }))}.${s}`;

    expect(() => verifierJeton(falsifie, cle(), attendu)).to.throw(KeycloakTokenError, /signature invalide/);
  });

  /* Sans ce contrôle, un attaquant monte son propre Keycloak, y émet un jeton portant le sub
     de sa victime, et le fait valider ici. C'est pour ça que l'émetteur vient de la
     configuration de l'environnement et jamais de la requête. */
  it('refuse un émetteur inattendu, même parfaitement signé', () => {
    const jeton = forger(valide({ iss: 'https://keycloak-attaquant.exemple/realms/izichange' }));

    expect(() => verifierJeton(jeton, cle(), attendu)).to.throw(KeycloakTokenError, /émetteur inattendu/);
  });

  /* Tous les clients d'un realm partagent la même clé de signature : un jeton émis pour un
     outil interne serait sinon accepté pour enregistrer un appareil. */
  it('refuse un jeton émis pour un autre client du même realm', () => {
    const jeton = forger(valide({ azp: 'outil-interne' }));

    expect(() => verifierJeton(jeton, cle(), attendu)).to.throw(KeycloakTokenError, /client inattendu/);
  });

  it('accepte le client trouvé dans aud plutôt que dans azp', () => {
    const jeton = forger(valide({ azp: undefined, aud: ['account', CLIENT] }));

    expect(verifierJeton(jeton, cle(), attendu).subscriberId).to.equal('usr_8H2K9LM');
  });

  it('sans audience configurée, ne contrôle pas le client', () => {
    const jeton = forger(valide({ azp: 'nimporte-quoi' }));

    expect(verifierJeton(jeton, cle(), { issuer: ISSUER }).subscriberId).to.equal('usr_8H2K9LM');
  });

  it('refuse un jeton expiré, et tolère une dérive d’horloge', () => {
    expect(() => verifierJeton(forger(valide({ exp: dans(-120) })), cle(), attendu)).to.throw(
      KeycloakTokenError,
      /expiré/
    );
    // Expiré de 10 s : accepté, deux machines ne sont jamais à la même heure.
    expect(verifierJeton(forger(valide({ exp: dans(-10) })), cle(), attendu).subscriberId).to.equal('usr_8H2K9LM');
  });

  it('refuse un jeton sans exp — un jeton sans expiration n’en est pas un', () => {
    expect(() => verifierJeton(forger(valide({ exp: undefined })), cle(), attendu)).to.throw(
      KeycloakTokenError,
      /expiré/
    );
  });

  it('refuse un jeton pas encore valide', () => {
    expect(() => verifierJeton(forger(valide({ nbf: dans(300) })), cle(), attendu)).to.throw(
      KeycloakTokenError,
      /pas encore valide/
    );
  });

  it('refuse un sujet absent ou vide', () => {
    for (const sub of [undefined, '', '   ', 42]) {
      expect(() => verifierJeton(forger(valide({ sub })), cle(), attendu), String(sub)).to.throw(
        KeycloakTokenError,
        /absent ou vide/
      );
    }
  });

  it('lit un autre claim quand la configuration le demande', () => {
    const jeton = forger(valide({ preferred_username: 'izi-42' }));

    expect(verifierJeton(jeton, cle(), { ...attendu, subjectClaim: 'preferred_username' }).subscriberId).to.equal('izi-42');
  });
});

describe('jeton Keycloak — émetteur annoncé', () => {
  /* Sans ce filtre, un émetteur mal saisi fait d'abord échouer la récupération des clés — vers un
     realm inexistant — et l'on répond « realm injoignable ». Constaté contre un vrai Keycloak :
     celui qui débogue cherche alors un pare-feu, alors qu'il s'agit d'une faute de frappe. */
  it('refuse d’emblée un émetteur qui ne correspond pas', () => {
    expect(() => verifierEmetteurAnnonce(forger(valide()), 'https://autre/realms/x')).to.throw(
      KeycloakTokenError,
      /émetteur inattendu/
    );
  });

  it('laisse passer l’émetteur attendu', () => {
    expect(() => verifierEmetteurAnnonce(forger(valide()), ISSUER)).to.not.throw();
  });

  /* Il ne vérifie AUCUNE signature — c'est volontaire, il ne sert qu'à refuser — donc un jeton
     non signé doit quand même être filtré sur son émetteur, puis échouer plus loin. */
  it('ne prétend pas vérifier la signature', () => {
    const forge = forger(valide(), { cle: autre.privateKey });

    expect(() => verifierEmetteurAnnonce(forge, ISSUER)).to.not.throw();
    expect(() => verifierJeton(forge, cle(), attendu)).to.throw(KeycloakTokenError, /signature invalide/);
  });

  it('refuse un jeton malformé', () => {
    expect(() => verifierEmetteurAnnonce('a.b', ISSUER)).to.throw(KeycloakTokenError);
  });
});

describe('jeton Keycloak — profil', () => {
  /* Ces claims servent à CRÉER l'abonné : ils viennent d'une source vérifiée, alors que
     `session/initialize` les prenait dans le corps de la requête, donc chez le client. */
  it('lit les claims standard d’OpenID Connect', () => {
    const jeton = forger(
      valide({ email: 'a@izichange.test', given_name: 'Ada', family_name: 'Lovelace', phone_number: '+22890000000' })
    );
    const { charge } = verifierJeton(jeton, cle(), attendu);

    expect(profilDepuisClaims(charge)).to.deep.equal({
      email: 'a@izichange.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+22890000000',
    });
  });

  /* Les claims dépendent des scopes accordés au client : un claim absent doit laisser le champ
     tel quel, jamais l'effacer. D'où `undefined` et non chaîne vide. */
  it('rend undefined pour un claim absent, vide ou non textuel', () => {
    const { charge } = verifierJeton(forger(valide({ email: '   ', given_name: 42 })), cle(), attendu);

    expect(profilDepuisClaims(charge)).to.deep.equal({
      email: undefined,
      firstName: undefined,
      lastName: undefined,
      phone: undefined,
    });
  });
});

describe('jeton Keycloak — JWK', () => {
  it('construit une clé vérifiable depuis un JWK RSA', () => {
    const jeton = forger(valide());

    expect(
      verifierJeton(jeton, cleDepuisJwk(realm.publicKey.export({ format: 'jwk' }) as never), attendu).subscriberId
    ).to.equal('usr_8H2K9LM');
  });

  it('refuse un JWK qui n’est pas RSA ou qui est incomplet', () => {
    for (const jwk of [{ kty: 'EC', n: 'x', e: 'AQAB' }, { kty: 'RSA', e: 'AQAB' }, { kty: 'RSA', n: 'x' }, {}]) {
      expect(() => cleDepuisJwk(jwk), JSON.stringify(jwk)).to.throw(KeycloakTokenError);
    }
  });
});
