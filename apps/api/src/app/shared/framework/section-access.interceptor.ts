import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { PinoLogger } from '@novu/application-generic';
import { MemberRepository } from '@novu/dal';
import { ApiAuthSchemeEnum, MemberSectionEnum, UserSessionData } from '@novu/shared';
import { Observable } from 'rxjs';

import { sectionAutorisee, sectionDuChemin } from './section-access';

/**
 * Durée de vie des sections d'un membre en mémoire.
 *
 * Court volontairement : c'est le délai au bout duquel un retrait d'accès prend effet. Trente
 * secondes restent acceptables pour un humain qui révoque, et évitent une lecture par requête.
 */
const CACHE_TTL_MS = 30 * 1000;

const CACHE_MAX = 2000;

/**
 * Refuse à un membre les routes des sections qu'on ne lui a pas accordées.
 *
 * **Pourquoi un intercepteur et non une garde** — les gardes globales de NestJS s'exécutent
 * avant les gardes de route, donc avant l'authentification Passport : une garde globale ne
 * verrait ni `request.user` ni `request.authScheme`. Les intercepteurs passent après toutes
 * les gardes. L'effet est identique, on lève avant `next.handle()`.
 *
 * **Les sections sont lues en base, PAS dans le jeton.** Le JWT du tableau de bord vit trente
 * jours : y ranger les sections rendrait tout retrait d'accès inopérant pendant un mois, ce
 * qui n'est pas un contrôle d'accès mais une suggestion. Le prix est une lecture par membre
 * et par demi-minute.
 *
 * **Seules les sessions `Bearer` sont concernées.** Un appel par clé API garde tous ses
 * droits : une clé n'est pas une personne, et c'est elle que la passerelle utilise. Restreindre
 * les clés ici casserait l'ingestion CRM et l'enregistrement des jetons push.
 */
@Injectable()
export class SectionAccessInterceptor implements NestInterceptor {
  private readonly cache = new Map<string, { sections?: MemberSectionEnum[]; expireA: number }>();

  constructor(
    private readonly memberRepository: MemberRepository,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(this.constructor.name);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();

    if (request.authScheme !== ApiAuthSchemeEnum.BEARER) return next.handle();

    // La section est déterminée AVANT toute lecture : la grande majorité des routes n'est pas
    // restreinte, et il ne faut pas payer une requête de membre pour rien.
    const requise = sectionDuChemin(request.originalUrl ?? request.url);
    if (requise === null) return next.handle();

    const user = request.user as UserSessionData | undefined;
    if (!user?._id || !user.organizationId) return next.handle();

    const sections = await this.sectionsDe(user.organizationId, user._id);
    if (sectionAutorisee(sections, requise)) return next.handle();

    this.logger.warn(
      { section: requise, chemin: request.url, userId: user._id, organizationId: user.organizationId },
      'accès refusé : section non accordée au membre'
    );

    throw new ForbiddenException(`Your account does not have access to the "${requise}" section`);
  }

  private async sectionsDe(organizationId: string, userId: string): Promise<MemberSectionEnum[] | undefined> {
    const cle = `${organizationId}:${userId}`;
    const connue = this.cache.get(cle);
    if (connue && connue.expireA > Date.now()) return connue.sections;

    const membre = await this.memberRepository.findMemberByUserId(organizationId, userId);

    /*
     * Membre introuvable : on NE restreint PAS. L'appartenance à l'organisation est vérifiée
     * en amont par l'authentification ; si le document manque ici, c'est une anomalie de
     * données, et transformer une anomalie en refus généralisé serait la pire des réponses.
     */
    const sections = membre?.sections;

    if (this.cache.size >= CACHE_MAX && !this.cache.has(cle)) {
      const plusAncienne = this.cache.keys().next().value;
      if (plusAncienne !== undefined) this.cache.delete(plusAncienne);
    }
    this.cache.set(cle, { sections, expireA: Date.now() + CACHE_TTL_MS });

    return sections;
  }
}
