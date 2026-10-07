import { MemberRoleEnum, MemberSectionEnum } from '@novu/shared';
import { ArrayUnique, IsDefined, IsEmail, IsEnum, IsOptional } from 'class-validator';
import { OrganizationCommand } from '../../../shared/commands/organization.command';

export class InviteMemberCommand extends OrganizationCommand {
  @IsEmail()
  readonly email: string;

  @IsDefined()
  readonly role: MemberRoleEnum;

  /** Sections accordees. Absentes : toutes, comme avant l'introduction du reglage. */
  @IsOptional()
  @IsEnum(MemberSectionEnum, { each: true })
  @ArrayUnique()
  readonly sections?: MemberSectionEnum[];
}
