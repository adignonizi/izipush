import { MemberSectionEnum } from '@novu/shared';
import { expect } from 'chai';

import { sectionAutorisee, sectionDuChemin } from './section-access';

describe('sections — correspondance des chemins', () => {
  it('range chaque famille de routes dans sa section', () => {
    const attendu: Array<[string, MemberSectionEnum]> = [
      ['/v1/crm/campaigns', MemberSectionEnum.CRM],
      ['/v1/agents/abc', MemberSectionEnum.AGENTS],
      ['/v1/workflows', MemberSectionEnum.NOTIFICATIONS],
      ['/v2/workflows/wf-1/steps', MemberSectionEnum.NOTIFICATIONS],
      ['/v1/layouts', MemberSectionEnum.NOTIFICATIONS],
      ['/v1/subscribers/usr_1', MemberSectionEnum.DATA],
      ['/v1/topics/t-1/subscribers', MemberSectionEnum.DATA],
      ['/v1/activity', MemberSectionEnum.MONITOR],
      ['/v1/messages/m-1', MemberSectionEnum.MONITOR],
      ['/v1/environments/api-keys', MemberSectionEnum.DEVELOPERS],
      ['/v1/environments/api-ip-allow-list', MemberSectionEnum.DEVELOPERS],
    ];

    for (const [chemin, section] of attendu) {
      expect(sectionDuChemin(chemin), chemin).to.equal(section);
    }
  });

  /* L'ordre de la table est porteur de sens : `/v1/environments` n'est pas restreint — il
     faut bien pouvoir changer d'environnement — mais `/v1/environments/api-keys` l'est. Un
     préfixe générique examiné en premier emporterait le spécifique. */
  it('fait gagner le préfixe le plus spécifique', () => {
    expect(sectionDuChemin('/v1/environments/api-keys')).to.equal(MemberSectionEnum.DEVELOPERS);
    expect(sectionDuChemin('/v1/environments/me'), 'changer d’environnement reste libre').to.equal(null);
    expect(sectionDuChemin('/v1/environments')).to.equal(null);
  });

  it('ne correspond que sur une frontière de segment', () => {
    // `/v1/crmauditlog` n'est pas du CRM : sans le contrôle de frontière, il le deviendrait.
    expect(sectionDuChemin('/v1/crmauditlog')).to.equal(null);
    expect(sectionDuChemin('/v1/crm')).to.equal(MemberSectionEnum.CRM);
    expect(sectionDuChemin('/v1/crm/')).to.equal(MemberSectionEnum.CRM);
  });

  it('ignore la chaîne de requête et les slashs en trop', () => {
    expect(sectionDuChemin('/v1/crm/campaigns?page=2')).to.equal(MemberSectionEnum.CRM);
    expect(sectionDuChemin('//v1/crm/campaigns')).to.equal(MemberSectionEnum.CRM);
  });

  /* Tout ce qui n'est pas dans la table reste accessible. Une route oubliée produit donc une
     permission trop large, jamais une panne d'accès — et c'est le bon compromis pour un
     déploiement : la régression d'accès se voit, l'ouverture non. */
  it('rend null pour ce qui n’est pas restreint', () => {
    for (const chemin of ['/v1/organizations', '/v1/users/me', '/v1/integrations', '/v1/tags', undefined]) {
      expect(sectionDuChemin(chemin), String(chemin)).to.equal(null);
    }
  });
});

describe('sections — décision', () => {
  const quelquesUnes = [MemberSectionEnum.CRM, MemberSectionEnum.MONITOR];

  /* Le défaut qui rend le déploiement sans danger : aucun membre existant ne porte de
     sections, et aucun ne doit rien perdre. */
  it('une liste vide ou absente donne tout', () => {
    for (const sections of [undefined, []]) {
      expect(sectionAutorisee(sections, MemberSectionEnum.DEVELOPERS), String(sections)).to.equal(true);
    }
  });

  it('autorise une section accordée, refuse les autres', () => {
    expect(sectionAutorisee(quelquesUnes, MemberSectionEnum.CRM)).to.equal(true);
    expect(sectionAutorisee(quelquesUnes, MemberSectionEnum.MONITOR)).to.equal(true);
    expect(sectionAutorisee(quelquesUnes, MemberSectionEnum.DEVELOPERS)).to.equal(false);
    expect(sectionAutorisee(quelquesUnes, MemberSectionEnum.DATA)).to.equal(false);
  });

  it('laisse passer une route non restreinte, même avec des sections limitées', () => {
    expect(sectionAutorisee(quelquesUnes, null)).to.equal(true);
  });
});
