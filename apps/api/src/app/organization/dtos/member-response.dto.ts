import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRoleEnum, MemberSectionEnum, MemberStatusEnum } from '@novu/shared';
import { IsDate, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class MemberUserDto {
  @ApiProperty()
  @IsString()
  _id: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty()
  @IsString()
  email: string;
}

export class MemberInviteDTO {
  @ApiProperty()
  @IsString()
  email: string;

  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsDate()
  invitationDate: Date;

  @ApiPropertyOptional()
  @IsDate()
  answerDate?: Date;

  @ApiProperty()
  @IsString()
  _inviterId: string;
}

export class MemberResponseDto {
  @ApiProperty()
  @IsString()
  _id: string;

  @ApiProperty()
  @IsString()
  _userId: string;

  @ApiPropertyOptional()
  @IsObject()
  user?: MemberUserDto;

  @ApiPropertyOptional({ enum: MemberRoleEnum })
  @IsEnum(MemberRoleEnum)
  roles?: MemberRoleEnum;

  /** Sections du tableau de bord accordees. Absentes ou vides : toutes. */
  @ApiPropertyOptional({ enum: MemberSectionEnum, isArray: true })
  @IsOptional()
  @IsEnum(MemberSectionEnum, { each: true })
  sections?: MemberSectionEnum[];

  @ApiPropertyOptional()
  @IsObject()
  invite?: MemberInviteDTO;

  @ApiPropertyOptional({
    enum: { ...MemberStatusEnum },
  })
  @IsEnum(MemberStatusEnum)
  memberStatus?: MemberStatusEnum;

  @ApiProperty()
  @IsString()
  _organizationId: string;
}
