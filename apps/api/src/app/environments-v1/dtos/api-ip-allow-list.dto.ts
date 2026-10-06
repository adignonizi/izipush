import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

import { entreeValide } from '../../shared/framework/ip-allow-list';

/** Au-delà, la liste n'est plus relue par personne et le coût de la comparaison croît pour rien. */
const MAX_ENTREES = 50;

@ValidatorConstraint({ name: 'adressesOuCidr', async: false })
export class AdressesOuCidrConstraint implements ValidatorConstraintInterface {
  validate(valeur: unknown): boolean {
    return Array.isArray(valeur) && valeur.every((e) => typeof e === 'string' && (e.trim() === '' || entreeValide(e)));
  }

  defaultMessage(): string {
    return 'each entry must be an IPv4/IPv6 address or a CIDR range, e.g. 203.0.113.7 or 203.0.113.0/24';
  }
}

export class UpdateApiIpAllowListRequestDto {
  /*
   * Les entrées sont validées ici ET ramenées à une forme propre côté contrôleur : une
   * liste acceptée puis silencieusement inopérante — une faute de frappe, un espace —
   * produirait exactement la panne qu'on cherche à éviter, un accès refusé sans cause
   * visible.
   */
  @ApiProperty({
    type: [String],
    description:
      'Addresses allowed to use this environment API keys, in plain or CIDR notation. An empty list removes the restriction.',
    example: ['203.0.113.7', '198.51.100.0/24'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_ENTREES)
  @IsString({ each: true })
  @Validate(AdressesOuCidrConstraint)
  ipAllowList: string[];
}

export class ApiIpAllowListResponseDto {
  @ApiProperty({ type: [String] })
  ipAllowList: string[];
}
