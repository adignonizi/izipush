import { ForbiddenException } from '@nestjs/common';

/**
 * izipush-crm — topics gérés par le CRM (segments figés, listes d'exécution de campagne).
 * Un abonné ne peut ni s'y inscrire, ni s'en retirer, ni les consulter ; l'API serveur les gère librement.
 */
const RESERVED_TOPIC_PREFIXES = ['segment:', 'campaign:'];

export function assertTopicKeyNotReserved(topicKey: string): void {
  if (RESERVED_TOPIC_PREFIXES.some((prefix) => topicKey?.startsWith(prefix))) {
    throw new ForbiddenException('This topic is managed by the CRM and cannot be accessed by subscribers');
  }
}
