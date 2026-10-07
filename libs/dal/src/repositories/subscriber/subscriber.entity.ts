import { IChannelSettings, ISubscriber, SubscriberCustomData } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';
import type { EnvironmentId } from '../environment';
import type { OrganizationId } from '../organization';
import { ExternalSubscriberId } from './types';

export class SubscriberEntity implements ISubscriber {
  // TODO: Use SubscriberId. Means lot of changes across whole codebase. Cool down.
  _id: string;

  firstName: string;

  lastName: string;

  email: string;

  phone?: string;

  avatar?: string;

  locale?: string;

  subscriberId: ExternalSubscriberId;

  /**
   * Sujet Keycloak (`sub`) du premier jeton ayant enregistre un appareil pour cet abonne.
   *
   * **C'est ce qui empeche un client authentifie d'en usurper un autre.** Le `subscriberId`
   * est fourni par l'appelant — c'est l'identifiant Izichange, celui du contrat d'evenements —
   * et le jeton Keycloak ne prouve que son authentification. Sans liaison, n'importe quel
   * client muni d'un jeton valide pourrait enregistrer son appareil sous l'identifiant d'un
   * autre, et recevrait ses notifications sans que rien ne le signale, la route faisant
   * l'union des jetons.
   *
   * Pose au premier enregistrement, compare ensuite. Absent : aucun enregistrement Keycloak
   * n'a encore eu lieu pour cet abonne.
   */
  keycloakSubject?: string;

  /**
   * @deprecated: use channelEndpoint instead
   */
  channels?: IChannelSettings[];

  topics?: string[];

  _organizationId: OrganizationId;

  _environmentId: EnvironmentId;

  deleted: boolean;

  createdAt: string;

  updatedAt: string;

  __v?: number;

  isOnline?: boolean;

  lastOnlineAt?: string;

  data?: SubscriberCustomData;

  timezone?: string;
}

export type SubscriberDBModel = ChangePropsValueType<SubscriberEntity, '_environmentId' | '_organizationId'>;
