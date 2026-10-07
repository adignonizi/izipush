import type { CrmCampaign } from '@/api/crm';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { t } from './crm-i18n';
import { describeSchedule } from './crm-labels';

// izipush-crm — une activation n'est jamais silencieuse : on rappelle qui reçoit quoi, et quand.

export function ActivateCampaignDialog({
  campaign,
  segmentName,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: {
  campaign?: Pick<CrmCampaign, 'name' | 'schedule'>;
  segmentName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isLoading?: boolean;
}) {
  const description = !campaign
    ? ''
    : campaign.schedule.mode === 'immediate'
      ? t('campaigns.activate.now', { segment: segmentName ?? '' })
      : t('campaigns.activate.later', { when: describeSchedule(campaign.schedule) });

  return (
    <ConfirmationModal
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      title={t('campaigns.activate.title')}
      description={description}
      confirmButtonText={t('campaigns.activate.confirm')}
      confirmButtonVariant="primary"
      isLoading={isLoading}
    />
  );
}
