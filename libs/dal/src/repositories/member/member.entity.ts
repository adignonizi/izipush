import { IMemberInvite, MemberRoleEnum, MemberStatusEnum, MemberSectionEnum } from '@novu/shared';
import { Types } from 'mongoose';
import type { ChangePropsValueType } from '../../types/helpers';
import type { OrganizationId } from '../organization';
import { UserEntity } from '../user';

export class MemberEntity {
  _id: string;

  _userId: string;

  user?: Pick<UserEntity, 'firstName' | '_id' | 'lastName' | 'email'>;

  roles: MemberRoleEnum[];

  /**
   * Sections du tableau de bord accessibles a ce membre.
   *
   * **Absent ou vide : TOUTES les sections.** C'est ce qui rend l'arrivee de la
   * fonctionnalite sans danger — aucun membre existant ne perd quoi que ce soit au
   * deploiement, et la restriction ne s'applique qu'une fois attribuee explicitement.
   */
  sections?: MemberSectionEnum[];

  invite?: IMemberInvite;

  memberStatus: MemberStatusEnum;

  _organizationId: OrganizationId;
}

export type MemberDBModel = ChangePropsValueType<Omit<MemberEntity, 'invite'>, '_userId' | '_organizationId'> & {
  invite?: IMemberInvite & {
    _inviterId: Types.ObjectId;
  };
};
