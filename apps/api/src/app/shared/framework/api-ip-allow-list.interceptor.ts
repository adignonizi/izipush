import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { PinoLogger } from '@novu/application-generic';
import { EnvironmentRepository } from '@novu/dal';
import { ApiAuthSchemeEnum, UserSessionData } from '@novu/shared';
import { Observable } from 'rxjs';

import { adresseAutorisee } from './ip-allow-list';

/** Durée de vie d'une liste en mémoire. Un changement met donc jusqu'à ce délai à s'appliquer. */
const CACHE_TTL_MS = 60 * 1000;

/** Borne du cache : au-delà, les entrées les plus anciennes sont évincées. */
const CACHE_MAX = 500;

/**
 * Restreint l'usage des clés API d'un environnement aux adresses déclarées dans ses
 * paramètres de développeur.
 *
 * **Pourquoi un intercepteur et non une garde**, alors qu'un refus d'accès est le travail
 * d'une garde : les gardes globales de NestJS s'exécutent AVANT les gardes de route, donc
 * avant l'authentification Passport. Une garde globale ne verrait ni `request.user` ni
 * `request.authScheme`, et n'aurait aucun environnement à consulter. Les intercepteurs,
 * eux, passent après toutes les gardes. L'effet est le même — on lève avant d'appeler
 * `next.handle()` — et c'est le seul endroit où l'information existe.
 *
 * Trois décisions à retenir :
 *
 *  · **seuls les appels par clé API sont concernés.** Le tableau de bord s'authentifie en
 *    `Bearer`, les appareils passent par `/v1/widgets/*` et `/v1/crm/public/*`. Une liste
 *    mal saisie ne peut donc ni couper les clients, ni enfermer dehors celui qui vient de
 *    la saisir — il lui reste toujours le tableau de bord pour la corriger ;
 *  · **une liste vide n'interdit rien.** La restriction est une option, et un
 *    environnement créé avant son introduction ne doit pas se retrouver coupé ;
 *  · **la décision est mise en cache une minute.** C'est le prix de ne pas lire la base à
 *    chaque requête, et il vaut d'être connu avant de se demander pourquoi la liste « ne
 *    marche pas encore ».
 */
@Injectable()
export class ApiIpAllowListInterceptor implements NestInterceptor {
  /*
   * Cache local plutôt que l'entrepôt partagé `InMemoryLRUCacheStore.ENVIRONMENT` : celui-ci
   * ne retient qu'une projection — `_id`, `echo`, `apiKeys` — qui ne porte pas ce champ.
   * L'élargir toucherait un type partagé par d'autres lecteurs pour un seul besoin.
   */
  private readonly cache = new Map<string, { liste: string[]; expireA: number }>();

  constructor(
    private readonly environmentRepository: EnvironmentRepository,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(this.constructor.name);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();

    if (request.authScheme !== ApiAuthSchemeEnum.API_KEY) return next.handle();

    const user = request.user as UserSessionData | undefined;
    // Pas d'utilisateur : l'authentification a déjà échoué, ou la route est publique.
    // Dans les deux cas il n'y a pas d'environnement à qui demander sa liste.
    if (!user?.environmentId) return next.handle();

    const liste = await this.listePour(user.environmentId);
    if (liste.length === 0) return next.handle();

    /*
     * `request.ip` dépend du réglage `trust proxy` posé au démarrage : sans lui, derrière
     * nginx ou un ALB, il rendrait l'adresse du proxy et la liste refuserait tout le
     * monde. Voir API_TRUSTED_PROXY_HOPS dans bootstrap.ts.
     */
    if (adresseAutorisee(request.ip, liste)) return next.handle();

    this.logger.warn(
      { adresse: request.ip, environmentId: user.environmentId, chemin: request.url },
      'appel par clé API refusé : adresse hors de la liste d’autorisation'
    );

    // Message volontairement sobre : il confirme à un appelant légitime qu'il s'est trompé
    // d'adresse, sans révéler la liste à qui ne devrait pas la connaître.
    throw new ForbiddenException('Source IP address is not allowed for this environment');
  }

  private async listePour(environmentId: string): Promise<string[]> {
    const connue = this.cache.get(environmentId);
    if (connue && connue.expireA > Date.now()) return connue.liste;

    const environment = await this.environmentRepository.findOne({ _id: environmentId }, 'apiIpAllowList');
    const liste = environment?.apiIpAllowList ?? [];

    // Éviction de la plus ancienne entrée : l'ordre d'insertion d'une Map est garanti,
    // la première clé est donc la plus anciennement écrite.
    if (this.cache.size >= CACHE_MAX && !this.cache.has(environmentId)) {
      const plusAncienne = this.cache.keys().next().value;
      if (plusAncienne !== undefined) this.cache.delete(plusAncienne);
    }
    this.cache.set(environmentId, { liste, expireA: Date.now() + CACHE_TTL_MS });

    return liste;
  }
}
