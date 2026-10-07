import { MemberSectionEnum } from '@novu/shared';
import { useQuery } from '@tanstack/react-query';

import { get } from '@/api/api.client';

/**
 * Sections que le membre courant peut atteindre.
 *
 * **Le masquage n'est pas le contrôle d'accès.** L'API refuse de son côté, par intercepteur :
 * ce hook ne sert qu'à ne pas montrer des portes fermées. Si jamais il se trompe, on affiche
 * une section qui répondra 403 — gênant, pas dangereux.
 *
 * Une liste vide signifie « toutes les sections », et c'est aussi ce qu'on suppose pendant le
 * chargement : afficher le menu complet puis le réduire est moins déroutant que l'inverse.
 */
export function useMySections() {
  const { data, isLoading } = useQuery({
    queryKey: ['myMemberSections'],
    queryFn: async () => (await get<{ data: { sections: MemberSectionEnum[] } }>('/organizations/members/me/sections')).data,
    staleTime: 60_000,
  });

  const sections = data?.sections ?? [];
  const toutesAccordees = sections.length === 0;

  return {
    isLoading,
    /** Vrai si la section doit être affichée. */
    peutVoir: (section: MemberSectionEnum) => toutesAccordees || sections.includes(section),
  };
}
