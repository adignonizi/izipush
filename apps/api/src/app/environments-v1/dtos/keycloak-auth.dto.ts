import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { verifierUrlSortante } from '../../auth/services/keycloak/jwks.service';

/**
 * Même règle que celle appliquée au moment de l'appel sortant, et volontairement la MÊME
 * fonction : deux validations qui divergent produiraient un réglage accepté à l'enregistrement
 * puis refusé à l'usage, avec un message incompréhensible pour celui qui l'a saisi.
 */
@ValidatorConstraint({ name: 'emetteurKeycloak', async: false })
export class EmetteurKeycloakConstraint implements ValidatorConstraintInterface {
  private raison = '';

  validate(valeur: unknown): boolean {
    if (typeof valeur !== 'string' || valeur.trim() === '') return true;

    try {
      // L'URL réellement appelée porte ce suffixe : on valide ce qui partira, pas l'approximation.
      verifierUrlSortante(`${valeur.trim().replace(/\/+$/, '')}/protocol/openid-connect/certs`);

      return true;
    } catch (erreur) {
      this.raison = (erreur as Error).message;

      return false;
    }
  }

  defaultMessage(): string {
    return this.raison || 'issuer must be an absolute https URL';
  }
}

export class UpdateKeycloakAuthRequestDto {
  /**
   * Emetteur du realm, tel qu'il figure dans le claim `iss` des jetons.
   *
   * **Vide retire l'authentification Keycloak** de cet environnement, qui repasse au JWT
   * d'abonne. C'est le chemin de retour arriere, et il doit rester a un champ vide.
   */
  @ApiPropertyOptional({ example: 'https://keycloak.izichange.com/realms/izichange' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Validate(EmetteurKeycloakConstraint)
  issuer?: string;

  /**
   * Client Keycloak attendu, compare a `azp` puis a `aud`.
   *
   * Facultatif mais vivement conseille : tous les clients d'un realm sont signes par la MEME
   * cle, donc sans ce controle un jeton emis pour un autre client du realm est accepte ici.
   */
  @ApiPropertyOptional({ example: 'izipay-mobile' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  audience?: string;

  /** Claim portant le subscriberId. `sub` par defaut, l'identifiant utilisateur Keycloak. */
  @ApiPropertyOptional({ example: 'sub' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subjectClaim?: string;
}

export class KeycloakAuthResponseDto {
  @ApiPropertyOptional()
  issuer?: string;

  @ApiPropertyOptional()
  audience?: string;

  @ApiPropertyOptional()
  subjectClaim?: string;
}
