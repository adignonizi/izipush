import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  CreateOrUpdateSubscriberCommand,
  CreateOrUpdateSubscriberUseCase,
  PinoLogger,
} from '@novu/application-generic';
import { EnvironmentEntity, EnvironmentRepository, SubscriberRepository } from '@novu/dal';
import { ApiAuthSchemeEnum } from '@novu/shared';

import { SubscriberSession } from '../../../shared/framework/user.decorator';
import { JwksService } from './jwks.service';
import {
  KeycloakExpectation,
  KeycloakTokenError,
  lireEntete,
  profilDepuisClaims,
  verifierEmetteurAnnonce,
  verifierJeton,
} from './keycloak-token';

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
    private readonly createOrUpdateSubscriber: CreateOrUpdateSubscriberUseCase,
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
    request: { headers: Record<string, unknown>; body?: Record<string, unknown> },
    environnement: EnvironmentEntity
  ): Promise<SubscriberSession> {
    const reglages = environnement.keycloakAuth!;
    const issuer = reglages.issuer.replace(/\/+$/, '');

    const attendu: KeycloakExpectation = {
      issuer,
      audience: reglages.audience,
      subjectClaim: reglages.subjectClaim,
    };

    let verifie: { subscriberId: string; charge: Record<string, unknown> };
    try {
      const jeton = this.jetonPorteur(request);
      const { kid } = lireEntete(jeton);
      // Avant d'aller chercher les clés : un émetteur mal saisi doit dire « émetteur inattendu »
      // et non « realm injoignable », qui enverrait chercher une panne réseau inexistante.
      verifierEmetteurAnnonce(jeton, issuer);
      const cle = await this.jwksService.cle(issuer, kid);
      verifie = verifierJeton(jeton, cle, attendu);
    } catch (erreur) {
      if (erreur instanceof KeycloakTokenError) {
        this.logger.warn({ raison: erreur.message, environmentId: environnement._id }, 'jeton Keycloak refusé');

        throw new UnauthorizedException(erreur.message);
      }

      throw erreur;
    }

    /*
     * L'abonné est celui que l'APPELANT désigne — l'identifiant Izichange, celui du `user_id` des
     * événements métier et des liens de souscription. Le jeton Keycloak, lui, prouve que l'appelant
     * est un client authentifié.
     *
     * Le claim ne sert donc que de repli, quand le corps ne porte rien : un appelant plus ancien,
     * ou un essai à la main.
     */
    const demande = typeof request.body?.subscriberId === 'string' ? request.body.subscriberId.trim() : '';
    const subscriberId = demande || verifie.subscriberId;

    /*
     * **L'identifiant demandé doit être celui du jeton.** C'est le contrôle qui ferme l'usurpation,
     * et il la ferme ENTIÈREMENT — y compris à la toute première inscription, que la seule liaison
     * laissait ouverte.
     *
     * Il repose sur une propriété du système d'Izichange : l'identifiant d'un client EST son
     * identifiant Keycloak, donc le claim de sujet. Le corps de la requête reste la source — c'est
     * lisible, et c'est ce que le SDK transmet — mais il ne peut plus désigner quelqu'un d'autre.
     *
     * Sans ce contrôle, « authentifié » suffirait : n'importe quel client muni de SON jeton
     * enregistrerait son appareil sous l'identifiant d'un autre, recevrait ses notifications, et la
     * victime continuerait de tout recevoir — la route faisant l'union des jetons — donc rien ne le
     * signalerait.
     *
     * **Si un déploiement a besoin que les deux diffèrent**, c'est `subjectClaim` qui le règle :
     * pointer le claim qui porte réellement l'identifiant attendu. Le contrôle reste alors en place,
     * sur la bonne valeur. Ce n'est donc pas une impasse.
     */
    if (demande && demande !== verifie.subscriberId) {
      this.logger.error(
        { demande, porteur: verifie.subscriberId, environmentId: environnement._id },
        'subscriberId demandé différent du claim du jeton : refusé'
      );

      throw new UnauthorizedException('The requested subscriberId does not match the authenticated identity');
    }

    /*
     * La liaison reste, en seconde barrière : elle couvre le cas où `subjectClaim` serait un jour
     * pointé ailleurs, et rend explicite en base quel sujet Keycloak possède cet abonné.
     */
    const existant = await this.subscriberRepository.findBySubscriberId(String(environnement._id), subscriberId);

    if (existant?.keycloakSubject && existant.keycloakSubject !== verifie.subscriberId) {
      this.logger.error(
        { subscriberId, porteur: verifie.subscriberId, environmentId: environnement._id },
        'tentative d’enregistrement sur un abonné lié à un autre sujet Keycloak'
      );

      throw new UnauthorizedException('This subscriber is bound to a different Keycloak identity');
    }

    /*
     * **On crée l'abonné s'il n'existe pas**, exactement comme le faisait `session/initialize`.
     *
     * C'est indispensable : cette route étant refusée sur un environnement migré, il n'y aurait
     * plus AUCUN endroit où un nouvel utilisateur pourrait apparaître. Il resterait bloqué, sans
     * notification, jusqu'à ce que l'ingestion CRM le crée — un délai qu'on ne maîtrise pas.
     *
     * Et le profil est meilleur qu'avant : `email`, `given_name`, `family_name` et `phone_number`
     * viennent d'un jeton dont la signature est VÉRIFIÉE, là où `session/initialize` les prenait
     * dans le corps de la requête, donc chez le client. D'où `allowUpdate: true` — l'ancienne route
     * le conditionnait à la détention du HMAC, précisément parce qu'elle ne pouvait pas savoir si
     * les champs étaient dignes de foi. Ici, elle le sait.
     */
    const subscriber = await this.createOrUpdateSubscriber.execute(
      CreateOrUpdateSubscriberCommand.create({
        environmentId: String(environnement._id),
        organizationId: String(environnement._organizationId),
        subscriberId,
        ...profilDepuisClaims(verifie.charge),
        allowUpdate: true,
      })
    );

    if (!subscriber) {
      throw new UnauthorizedException(`Subscriber ${subscriberId} could not be resolved`);
    }

    // Première liaison : on la pose. Les suivantes ont déjà été vérifiées plus haut.
    if (!existant?.keycloakSubject) {
      await this.subscriberRepository.update(
        { _environmentId: String(environnement._id), subscriberId },
        { $set: { keycloakSubject: verifie.subscriberId } }
      );
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
