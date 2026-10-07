import { createPublicKey, createVerify, KeyObject } from 'crypto';

/**
 * Vérification d'un jeton d'accès Keycloak.
 *
 * Écrit ici plutôt que pris de `jose`, qui n'est présent qu'en dépendance transitive et
 * n'est pas résoluble depuis `apps/api`. Node sait lire un JWK nativement
 * (`createPublicKey({ format: 'jwk' })`) et vérifier RS256, donc la vérification tient en
 * une page — et elle est testée contre de vraies signatures.
 *
 * La récupération des clés vit à côté, dans `jwks.service.ts` : ce fichier ne fait aucune
 * entrée-sortie, pour que les contrôles soient éprouvables sans réseau.
 */

/** Réglages attendus, lus sur l'environnement — jamais sur la requête. */
export type KeycloakExpectation = {
  issuer: string;
  audience?: string;
  subjectClaim?: string;
};

export class KeycloakTokenError extends Error {}

/** Un JWK tel que Keycloak le publie, réduit à ce dont on a besoin. */
export type Jwk = { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string };

/**
 * **Seul RS256 est accepté.** Pas par paresse : accepter la liste que le jeton propose est
 * la faille classique des JWT. `none` ferait passer un jeton sans signature, et HS256 ferait
 * vérifier une signature symétrique avec la clé PUBLIQUE du realm — qui est publique, donc
 * forgeable par n'importe qui.
 */
const ALGORITHME = 'RS256';

/** Tolérance d'horloge. Deux machines ne sont jamais exactement à la même heure. */
const DERIVE_HORLOGE_S = 30;

function decoderSegment(segment: string): Record<string, unknown> {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    const valeur = JSON.parse(json);
    if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) {
      throw new Error('objet attendu');
    }

    return valeur as Record<string, unknown>;
  } catch {
    throw new KeycloakTokenError('jeton illisible');
  }
}

/** En-tête d'un jeton, lu SANS rien vérifier — uniquement pour savoir quelle clé demander. */
export function lireEntete(jeton: string): { alg: string; kid: string } {
  const segments = jeton.split('.');
  if (segments.length !== 3) throw new KeycloakTokenError('jeton malformé');

  const entete = decoderSegment(segments[0]);
  const { alg, kid } = entete;

  if (alg !== ALGORITHME) throw new KeycloakTokenError(`algorithme refusé : ${String(alg)}`);
  if (typeof kid !== 'string' || !kid) throw new KeycloakTokenError('kid absent de l’en-tête');

  return { alg, kid };
}

/** Construit une clé publique vérifiable à partir d'un JWK publié par le realm. */
export function cleDepuisJwk(jwk: Jwk): KeyObject {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new KeycloakTokenError('JWK RSA attendu');

  try {
    return createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch {
    throw new KeycloakTokenError('JWK illisible');
  }
}

/**
 * Vérifie un jeton et rend l'identifiant de l'abonné.
 *
 * Les contrôles, dans l'ordre, et chacun pour une raison :
 *
 *  1. **signature** contre la clé du realm — le seul qui prouve quoi que ce soit. Tout le
 *     reste n'a de sens qu'après lui ;
 *  2. **`iss` exactement l'émetteur attendu** — sans quoi n'importe quel realm, y compris
 *     celui d'un attaquant, ferait l'affaire ;
 *  3. **`azp` ou `aud` contre le client attendu** — tous les clients d'un realm partagent la
 *     même clé de signature, donc un jeton émis pour un autre client passerait. Keycloak met
 *     le client dans `azp`, `aud` valant souvent `account` : on regarde les deux ;
 *  4. **`exp` / `nbf`** ;
 *  5. **le claim de sujet**, non vide.
 */
export function verifierJeton(jeton: string, cle: KeyObject, attendu: KeycloakExpectation, maintenant = Date.now()): string {
  const segments = jeton.split('.');
  if (segments.length !== 3) throw new KeycloakTokenError('jeton malformé');

  const [enteteB64, chargeB64, signatureB64] = segments;

  const verificateur = createVerify('RSA-SHA256');
  verificateur.update(`${enteteB64}.${chargeB64}`);
  if (!verificateur.verify(cle, Buffer.from(signatureB64, 'base64url'))) {
    throw new KeycloakTokenError('signature invalide');
  }

  const charge = decoderSegment(chargeB64);

  if (charge.iss !== attendu.issuer) {
    throw new KeycloakTokenError('émetteur inattendu');
  }

  if (attendu.audience) {
    const aud = charge.aud;
    const audiences = Array.isArray(aud) ? aud.map(String) : typeof aud === 'string' ? [aud] : [];
    const accepte = charge.azp === attendu.audience || audiences.includes(attendu.audience);
    if (!accepte) throw new KeycloakTokenError('client inattendu');
  }

  const secondes = Math.floor(maintenant / 1000);

  if (typeof charge.exp !== 'number' || charge.exp + DERIVE_HORLOGE_S < secondes) {
    throw new KeycloakTokenError('jeton expiré');
  }

  if (typeof charge.nbf === 'number' && charge.nbf - DERIVE_HORLOGE_S > secondes) {
    throw new KeycloakTokenError('jeton pas encore valide');
  }

  const claim = attendu.subjectClaim || 'sub';
  const sujet = charge[claim];
  if (typeof sujet !== 'string' || !sujet.trim()) {
    throw new KeycloakTokenError(`claim « ${claim} » absent ou vide`);
  }

  return sujet;
}
