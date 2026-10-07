import type { EnvironmentId } from '@novu/shared';
import type { ChangePropsValueType } from '../../types/helpers';

export type CrmProviderUsageCounter = 'sent' | 'failed' | 'bounced' | 'complaints' | 'postponed';

/** izipush-crm — compteurs quotidiens par intégration email, pour la page de suivi des envois. */
export class CrmProviderUsageEntity {
  _id: string;

  _environmentId: EnvironmentId;

  _integrationId: string;

  providerId?: string;

  /** Jour UTC, AAAA-MM-JJ. */
  day: string;

  sent: number;

  failed: number;

  bounced: number;

  complaints: number;

  /** Envois repoussés faute de place chez tous les fournisseurs. */
  postponed: number;
}

export type CrmProviderUsageDBModel = ChangePropsValueType<CrmProviderUsageEntity, '_environmentId'>;
