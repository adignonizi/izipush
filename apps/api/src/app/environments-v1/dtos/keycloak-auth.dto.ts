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
      const propre = valeur.trim().replace(/\/+$/, '');
      verifierUrlSortante(`${propre}/protocol/openid-connect/certs`);

      /*
       * Un emetteur Keycloak finit toujours par `/realms/<nom>`. Ce controle n'est pas de la
       * securite — un emetteur erronne echoue de toute facon a la verification du jeton — mais il
       * attrape la faute de frappe au moment de la saisie, au lieu de la laisser se manifester
       * plus tard par un « emetteur inattendu » que personne ne relie au champ.
       *
       * Il vit ici ET dans la carte du tableau de bord : deux validations qui divergeraient
       * produiraient un reglage accepte par l'une et refuse par l'autre.
       */
      if (!/\/realms\/[^/]+$/.test(new URL(propre).pathname)) {
        this.raison = 'a Keycloak issuer ends with /realms/<realm>';

        return false;
      }

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
