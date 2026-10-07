import { Injectable } from '@nestjs/common';
import { PinoLogger } from '@novu/application-generic';
import { KeyObject } from 'crypto';

import { cleDepuisJwk, Jwk, KeycloakTokenError } from './keycloak-token';

/** Durée de vie d'un jeu de clés. Un realm change de clé rarement, et la rotation est gérée à part. */
const TTL_MS = 10 * 60 * 1000;

/**
 * Délai minimal entre deux récupérations, une fois le quota de `kid` inconnus épuisé.
 *
 * Sans garde-fou, une rafale de jetons portant des `kid` inventés déclencherait une requête vers
 * Keycloak par jeton reçu : on transformerait une tentative en déni de service contre notre
 * propre fournisseur d'identité.
 */
const ANTI_RAFALE_MS = 30 * 1000;

/**
 * Nombre de `kid` inconnus distincts qui peuvent déclencher un rechargement avant que
 * l'anti-rafale ne prenne le relais.
 *
 * **Ce quota est ce qui réconcilie deux besoins opposés.** Un anti-rafale appliqué à tous les
 * `kid` empêcherait aussi de suivre une ROTATION DE CLÉS — qui se manifeste exactement comme un
 * `kid` inconnu — et tous les enregistrements échoueraient jusqu'à l'expiration du cache. À
 * l'inverse, recharger pour chaque `kid` inédit laisse marteler Keycloak. Quelques `kid` inédits
 * rechargent donc, puis on se calme.
 */
const MAX_ABSENTS = 5;

/** Au-delà, on n'attend plus : mieux vaut refuser l'enregistrement que retenir la requête. */
const TIMEOUT_MS = 5000;

/**
 * Hôtes pour lesquels `http://` reste acceptable : un bac à sable local, et rien d'autre.
 */
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Refuse une URL d'émetteur vers laquelle on ne doit pas appeler.
 *
 * **C'est le vrai enjeu de l'émetteur.** Il ne sert pas qu'à comparer un claim : il détermine
 * l'URL que l'API va CHERCHER pour récupérer les clés du realm. C'est donc un appel sortant
 * depuis nos serveurs, déclenché par une valeur réglée dans le tableau de bord — autrement dit un
 * aller simple vers une requête côté serveur vers une adresse arbitraire, y compris une adresse
 * interne que l'extérieur ne peut pas joindre.
 *
 * La réponse n'est jamais renvoyée à l'appelant, ce qui limite la portée, mais la requête part
 * bel et bien. Deux contraintes suffisent à fermer ça sans gêner personne :
 *
 *  · **`https` exigé**, sauf vers un hôte local — un realm de production est en HTTPS de toute
 *    façon, et un émetteur en clair signalerait déjà un problème ;
 *  · **adresses IP littérales refusées** hors boucle locale. Un realm se désigne par un nom
 *    d'hôte ; une IP nue dans ce champ ne sert qu'à viser l'intérieur du réseau.
 */
export function verifierUrlSortante(url: string): void {
  let analysee: URL;
  try {
    analysee = new URL(url);
  } catch {
    throw new KeycloakTokenError('émetteur Keycloak : URL invalide');
  }

  const hote = analysee.hostname;
  const estLocal = HOTES_LOCAUX.has(hote);

  if (analysee.protocol !== 'https:' && !(analysee.protocol === 'http:' && estLocal)) {
    throw new KeycloakTokenError('émetteur Keycloak : https exigé hors hôte local');
  }

  // Une IP littérale ne désigne pas un realm : elle ne sert qu'à viser l'intérieur du réseau.
  const estIpLitterale = /^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || hote.includes(':');
  if (estIpLitterale && !estLocal) {
    throw new KeycloakTokenError('émetteur Keycloak : adresse IP littérale refusée');
  }
}

type Entree = {
  cles: Map<string, KeyObject>;
  chargeA: number;
  /** `kid` cherchés en vain depuis le dernier rechargement : on ne les redemande pas. */
  absents: Set<string>;
  derniereTentative: number;
};

/**
 * Clés publiques des realms Keycloak, mises en cache.
 *
 * **Validation locale, et non introspection.** Appeler
 * `/protocol/openid-connect/token/introspect` à chaque requête serait plus simple à écrire,
 * mais ajouterait un aller-retour réseau par enregistrement de jeton et rendrait izipush
 * indisponible dès que Keycloak tousse. Avec les clés en cache, une panne Keycloak n'empêche
 * pas les enregistrements — c'est le comportement qu'on veut d'un service de notifications.
 */
@Injectable()
export class JwksService {
  private readonly cache = new Map<string, Entree>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name);
  }

  /**
   * Rend la clé publique d'un `kid`, en rechargeant le jeu si le `kid` est inconnu.
   *
   * La rotation de clés d'un realm se manifeste exactement comme ça : un `kid` qu'on n'a pas.
   * Sans ce rechargement, tous les enregistrements échoueraient jusqu'à l'expiration du cache
   * — dix minutes de panne à chaque rotation, pour rien.
   */
  async cle(issuer: string, kid: string): Promise<KeyObject> {
    const connue = this.cache.get(issuer);

    if (connue && Date.now() - connue.chargeA < TTL_MS) {
      const cle = connue.cles.get(kid);
      if (cle) return cle;

      // Déjà cherché en vain, ou quota de recherches épuisé : on ne redemande pas au realm.
      if (connue.absents.has(kid) || this.enRafale(connue)) {
        throw new KeycloakTokenError(`clé inconnue du realm : ${kid}`);
      }
    }

    const recharge = await this.recharger(issuer, connue);
    const cle = recharge.cles.get(kid);
    if (!cle) {
      recharge.absents.add(kid);

      throw new KeycloakTokenError(`clé inconnue du realm : ${kid}`);
    }

    return cle;
  }

  private enRafale(entree: Entree): boolean {
    return entree.absents.size >= MAX_ABSENTS && Date.now() - entree.derniereTentative < ANTI_RAFALE_MS;
  }

  private async recharger(issuer: string, connue?: Entree): Promise<Entree> {
    const url = `${issuer.replace(/\/+$/, '')}/protocol/openid-connect/certs`;
    verifierUrlSortante(url);

    let cles: Map<string, KeyObject>;
    try {
      const reponse = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

      const corps = (await reponse.json()) as { keys?: Jwk[] };
      cles = new Map();
      for (const jwk of corps.keys ?? []) {
        // Keycloak publie aussi ses clés de chiffrement : seules les clés de SIGNATURE
        // nous concernent, et une clé de chiffrement ne vérifiera jamais une signature.
        if (jwk.use && jwk.use !== 'sig') continue;
        if (jwk.alg && jwk.alg !== 'RS256') continue;
        if (!jwk.kid) continue;

        try {
          cles.set(jwk.kid, cleDepuisJwk(jwk));
        } catch {
          // Une clé illisible ne doit pas emporter les autres avec elle.
          this.logger.warn({ issuer, kid: jwk.kid }, 'JWK ignoré : illisible');
        }
      }
    } catch (erreur) {
      this.logger.error({ issuer, url, err: erreur }, 'récupération du JWKS impossible');

      // On conserve le jeu précédent s'il existe : une coupure réseau passagère ne doit pas
      // interrompre les enregistrements. L'anti-rafale empêche de réessayer trop souvent.
      if (connue) {
        connue.derniereTentative = Date.now();

        return connue;
      }

      throw new KeycloakTokenError('realm injoignable');
    }

    if (cles.size === 0) throw new KeycloakTokenError('le realm ne publie aucune clé de signature RS256');

    // `absents` repart vide : le jeu vient d'être relu, ce qui manquait avant peut exister.
    const entree: Entree = { cles, chargeA: Date.now(), absents: new Set(), derniereTentative: Date.now() };
    this.cache.set(issuer, entree);

    return entree;
  }
}
