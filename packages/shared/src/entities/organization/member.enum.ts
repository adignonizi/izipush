export enum MemberRoleEnum {
  ADMIN = 'org:admin',
  OWNER = 'org:owner',
  AUTHOR = 'org:author',
  VIEWER = 'org:viewer',
  /**
   * @deprecated member is used only in OSS
   */
  OSS_MEMBER = 'member',
  /**
   * @deprecated admin is used only in OSS
   */
  OSS_ADMIN = 'admin',
}

/**
 * Sections du tableau de bord, telles qu'un membre peut les avoir ou non.
 *
 * Volontairement distinct de `PermissionsEnum` : celui-ci n'est appliqué par rien dans ce
 * dépôt — `@RequirePermissions` ne pose qu'une métadonnée, et le garde qui la lit vit dans
 * le module entreprise, absent. Réveiller cette machinerie serait plus risqué que de poser
 * un concept propre, à la granularité qui nous intéresse.
 *
 * Les valeurs correspondent aux groupes de la navigation, pour qu'une section cachée dans
 * l'interface soit exactement une section refusée par l'API.
 */
export enum MemberSectionEnum {
  AGENTS = 'agents',
  NOTIFICATIONS = 'notifications',
  DATA = 'data',
  MONITOR = 'monitor',
  CRM = 'crm',
  /** Clés API, liste d'adresses, réglages Keycloak — la zone de configuration. */
  DEVELOPERS = 'developers',
}
