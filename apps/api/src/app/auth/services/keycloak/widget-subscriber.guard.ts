import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PinoLogger } from '@novu/application-generic';
import { EnvironmentEntity, EnvironmentRepository, SubscriberRepository } from '@novu/dal';
import { ApiAuthSchemeEnum } from '@novu/shared';

import { SubscriberSession } from '../../../shared/framework/user.decorator';
import { JwksService } from './jwks.service';
import { KeycloakExpectation, KeycloakTokenError, lireEntete, verifierJeton } from './keycloak-token';

/**
 * En-tête qui désigne l'environnement visé.
 *
 * Nécessaire parce qu'un jeton Keycloak ne sait rien d'izipush : il faut bien savoir contre quel
 * émetteur le vérifier. `applicationIdentifier` est public par construction, et ne sert ici que
 * d'aiguillage — l'identité vient entièrement du jeton. La faille qu'on refusait d'ouvrir
 * (« applicationIdentifier seul ») n'existe donc pas : le `subscriberId` n'est jamais lu dans la
 * requête, il est lu dans un jeton dont la signature a été vérifiée.
 */
const EN_TETE_ENVIRONNEMENT = 'novu-application-identifier';

/**
 * Authentifie l'abonné sur `PUT /v1/widgets/credentials`, par jeton Keycloak ou par JWT d'abonné.
 *
 * **La bascule est pilotée par la configuration, environnement par environnement** : si
 * l'environnement visé déclare un `keycloakAuth.issuer`, le jeton Keycloak est exigé et le
 * `subscriberId` est lu dans son claim `sub`, vérifié ; sinon on retombe sur le JWT d'abonné émis
 * par `/session/initialize`, strictement inchangé. On migre donc un environnement quand on le
 * décide, et on revient en arrière en vidant un champ.
 *
 * **L'émetteur vient du tableau de bord, et c'est la section `DEVELOPERS` qui le protège.** Qui
 * peut écrire ce champ peut déjà lire la clé API de l'environnement, laquelle permet d'enregistrer
 * les credentials de n'importe quel abonné par `PATCH /v1/subscribers/ID/credentials` : le réglage
 * n'accorde aucun pouvoir supplémentaire, et une liste d'émetteurs en variable d'environnement
 * n'aurait ajouté que de la friction — un déploiement pour changer un realm.
 *
 * Ce que l'émetteur commande en revanche, c'est **l'URL que l'API va chercher** pour récupérer les
 * clés publiques du realm. C'est un appel sortant depuis nos serveurs : la contrainte de schéma et
 * d'hôte est posée dans `jwks.service.ts`, pas ici.
 *
 * Écrit en garde de route et non en stratégie Passport : `passport-custom` n'est pas une dépendance
 * déclarée, et une garde fait exactement le même travail — elle pose `request.user`, qui est ce que
 * lit le décorateur `@SubscriberSession()`.
 */
@Injectable()
export class WidgetSubscriberGuard extends AuthGuard('subscriberJwt') {
  constructor(
    private readonly environmentRepository: EnvironmentRepository,
    private readonly subscriberRepository: SubscriberRepository,
    private readonly jwksService: JwksService,
    private readonly logger: PinoLogger
  ) {
    super();
    this.logger.setContext(this.constructor.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const environnement = await this.environnementVise(request);

    // Pas d'en-tête, ou environnement sans Keycloak : chemin historique, strictement inchangé.
    if (!environnement?.keycloakAuth?.issuer) {
      return (await super.canActivate(context)) as boolean;
    }

    request.user = await this.sessionDepuisKeycloak(request, environnement);
    request.authScheme = ApiAuthSchemeEnum.BEARER;

    return true;
  }

  private async sessionDepuisKeycloak(
    request: { headers: Record<string, unknown> },
    environnement: EnvironmentEntity
  ): Promise<SubscriberSession> {
    const reglages = environnement.keycloakAuth!;
    const issuer = reglages.issuer.replace(/\/+$/, '');

    const attendu: KeycloakExpectation = {
      issuer,
      audience: reglages.audience,
      subjectClaim: reglages.subjectClaim,
    };

    let subscriberId: string;
    try {
      const jeton = this.jetonPorteur(request);
      const { kid } = lireEntete(jeton);
      const cle = await this.jwksService.cle(issuer, kid);
      subscriberId = verifierJeton(jeton, cle, attendu);
    } catch (erreur) {
      if (erreur instanceof KeycloakTokenError) {
        this.logger.warn({ raison: erreur.message, environmentId: environnement._id }, 'jeton Keycloak refusé');

        throw new UnauthorizedException(erreur.message);
      }

      throw erreur;
    }

    const subscriber = await this.subscriberRepository.findBySubscriberId(String(environnement._id), subscriberId);

    /*
     * `session/initialize` créait l'abonné au passage ; ce chemin ne le fait pas. Chez Izichange
     * le webhook Keycloak et l'ingestion CRM le créent, mais un inscrit de la minute précédente
     * peut arriver avant son événement. Message explicite, pour que l'appelant sache qu'il s'agit
     * d'un cas à réessayer et non d'un jeton invalide.
     */
    if (!subscriber) {
      throw new UnauthorizedException(`Subscriber ${subscriberId} does not exist yet in this environment`);
    }

    return {
      ...subscriber,
      organizationId: String(environnement._organizationId),
      environmentId: String(environnement._id),
      contextKeys: [],
      scheme: ApiAuthSchemeEnum.BEARER,
    };
  }

  private jetonPorteur(request: { headers: Record<string, unknown> }): string {
    const entete = request.headers.authorization;
    const [schema, valeur] = (typeof entete === 'string' ? entete : '').split(' ');

    if (schema?.toLowerCase() !== 'bearer' || !valeur) throw new KeycloakTokenError('jeton porteur absent');

    return valeur;
  }

  /** Environnement désigné par l'en-tête, ou `null` s'il n'y en a pas — on ne devine pas. */
  private async environnementVise(request: {
    headers: Record<string, unknown>;
  }): Promise<EnvironmentEntity | null> {
    const brut = request.headers[EN_TETE_ENVIRONNEMENT];
    const identifiant = (Array.isArray(brut) ? brut[0] : brut) as string | undefined;

    if (!identifiant?.trim()) return null;

    return this.environmentRepository.findEnvironmentByIdentifier(identifiant.trim());
  }
}
