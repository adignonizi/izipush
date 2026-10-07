import { SubscriberEntity } from '@novu/dal';
import { MemberSectionEnum } from '@novu/shared';
import { Type } from 'class-transformer';
import { ArrayUnique, IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, ValidateNested } from 'class-validator';

export class InviteMemberDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /**
   * Sections du tableau de bord accordees a l'invite.
   *
   * FACULTATIF, et l'omettre donne TOUTES les sections : c'est le comportement d'avant, pour
   * que les appels existants et les scripts ne changent pas de sens du jour au lendemain.
   * L'interface, elle, demande toujours un choix explicite.
   */
  @IsOptional()
  @IsEnum(MemberSectionEnum, { each: true })
  @ArrayUnique()
  sections?: MemberSectionEnum[];
}

export class InviteWebhookDto {
  @IsObject()
  @ValidateNested()
  @Type(() => SubscriberEntity)
  subscriber: SubscriberEntity;

  @IsObject()
  payload: { organizationId: string };
}
