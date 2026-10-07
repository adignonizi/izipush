import { MemberSectionEnum } from '@novu/shared';

/**
 * Correspondance entre un chemin d'API et la section du tableau de bord dont il relève.
 *
 * **Une table, et non un décorateur par route.** Il y a des dizaines de contrôleurs : des
 * annotations éparpillées rendraient impossible de répondre à la question qui compte pour un
 * contrôle d'accès — « qu'est-ce qui n'est couvert par rien ? ». Ici, la réponse se lit d'un
 * coup d'œil, et une route ajoutée demain sans entrée dans cette table est visible.
 *
 * L'ordre importe : le premier préfixe qui correspond gagne, donc les plus spécifiques
 * d'abord. `/v1/environments/api-keys` doit être examiné avant `/v1/environments`.
 */
const TABLE: ReadonlyArray<readonly [string, MemberSectionEnum]> = [
  // ── Zone de configuration. En premier, car plus spécifique que /v1/environments. ──
  ['/v1/environments/api-keys', MemberSectionEnum.DEVELOPERS],
  ['/v1/environments/api-ip-allow-list', MemberSectionEnum.DEVELOPERS],
  ['/v1/environments/keycloak-auth', MemberSectionEnum.DEVELOPERS],

  // ── CRM ──
  ['/v1/crm', MemberSectionEnum.CRM],

  // ── Agents ──
  ['/v1/agents', MemberSectionEnum.AGENTS],

  // ── Notifications : ce qui définit ce qui part ──
  ['/v1/workflows', MemberSectionEnum.NOTIFICATIONS],
  ['/v1/notification-templates', MemberSectionEnum.NOTIFICATIONS],
  ['/v1/layouts', MemberSectionEnum.NOTIFICATIONS],
  ['/v1/blueprints', MemberSectionEnum.NOTIFICATIONS],
  ['/v2/workflows', MemberSectionEnum.NOTIFICATIONS],
  ['/v2/layouts', MemberSectionEnum.NOTIFICATIONS],

  // ── Data : à qui et à quels regroupements on envoie ──
  ['/v1/subscribers', MemberSectionEnum.DATA],
  ['/v1/topics', MemberSectionEnum.DATA],
  ['/v1/tenants', MemberSectionEnum.DATA],
  ['/v2/subscribers', MemberSectionEnum.DATA],

  // ── Monitor : ce qui s'est passé ──
  ['/v1/activity', MemberSectionEnum.MONITOR],
  ['/v1/messages', MemberSectionEnum.MONITOR],
  ['/v1/execution-details', MemberSectionEnum.MONITOR],
  ['/v1/notifications', MemberSectionEnum.MONITOR],
  ['/v1/events', MemberSectionEnum.MONITOR],
];

/**
 * Section dont relève un chemin, ou `null` si aucune.
 *
 * `null` veut dire **non restreint** : l'authentification s'applique toujours, mais la
 * section ne décide de rien. C'est délibérément le défaut pour tout ce qui n'est pas dans la
 * table — l'organisation, le profil, les intégrations, le changement d'environnement. Une
 * route oubliée reste donc accessible plutôt que de casser, ce qui est le bon sens d'un
 * déploiement : une régression d'accès se voit tout de suite, une fuite non.
 */
export function sectionDuChemin(chemin: string | undefined): MemberSectionEnum | null {
  if (!chemin) return null;

  // On travaille sur le chemin seul : une chaîne de requête ne doit pas faire échouer la
  // correspondance, et un `//` en tête non plus.
  const propre = `/${chemin.split('?')[0].replace(/^\/+/, '')}`;

  for (const [prefixe, section] of TABLE) {
    if (propre === prefixe || propre.startsWith(`${prefixe}/`)) return section;
  }

  return null;
}

/**
 * Décide si un membre peut atteindre une section.
 *
 * **Une liste vide ou absente donne TOUT.** C'est ce qui rend l'arrivée de la fonctionnalité
 * sans danger : aucun membre existant ne perd l'accès au déploiement, et la restriction ne
 * prend effet qu'une fois les sections attribuées explicitement.
 */
export function sectionAutorisee(
  sections: MemberSectionEnum[] | undefined,
  requise: MemberSectionEnum | null
): boolean {
  if (requise === null) return true;
  if (!sections?.length) return true;

  return sections.includes(requise);
}
