import type { EnvironmentId, OrganizationId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';
import type { CrmConditionGroup } from './crm-audience.types';

/** ready : utilisable · freezing : liste en cours de photographie · deleting : suppression en cours · failed : figeage en échec. */
export type CrmSegmentStatus = 'ready' | 'freezing' | 'deleting' | 'failed';

export class CrmSegmentEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _organizationId: OrganizationId;

  name: string;

  description?: string;

  audience: CrmConditionGroup;

  /** Figé : la liste est photographiée à la création (topic segment:{id}) ; sinon recalculée à chaque exécution. */
  frozen: boolean;

  status: CrmSegmentStatus;

  memberCount?: number;

  frozenAt?: Date;

  topicKey?: string;

  error?: string;

  /** Verrou de traitement par crm-ingest (figeage, suppression). */
  lockedUntil?: Date | null;

  _createdBy?: string;

  createdAt?: string;

  updatedAt?: string;
}

export type CrmSegmentDBModel = ChangePropsValueType<CrmSegmentEntity, '_environmentId' | '_organizationId'>;
