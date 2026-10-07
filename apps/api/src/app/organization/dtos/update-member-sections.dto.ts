import { ApiProperty } from '@nestjs/swagger';
import { MemberSectionEnum } from '@novu/shared';
import { ArrayUnique, IsArray, IsEnum } from 'class-validator';

export class UpdateMemberSectionsDto {
  /**
   * Sections accordees au membre. Remplace entierement la liste precedente.
   *
   * **Un tableau vide retire la restriction** et redonne acces a tout — ce n'est donc PAS
   * la facon de tout interdire. Pour limiter, on enumere ce qu'on accorde.
   */
  @ApiProperty({ enum: MemberSectionEnum, isArray: true, example: [MemberSectionEnum.CRM] })
  @IsArray()
  @IsEnum(MemberSectionEnum, { each: true })
  @ArrayUnique()
  sections: MemberSectionEnum[];
}
