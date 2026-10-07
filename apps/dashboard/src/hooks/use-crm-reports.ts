import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  type CrmRecipientFilter,
  getCrmCampaignReport,
  getCrmReportOverview,
  getCrmRunRecipients,
} from '@/api/crm-reports';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

// izipush-crm — hooks des rapports de campagnes.

export function useCrmCampaignReport(campaignId?: string) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmCampaignReport, currentEnvironment?._id, campaignId],
    queryFn: ({ signal }) =>
      getCrmCampaignReport({ environment: currentEnvironment!, campaignId: campaignId!, signal }),
    enabled: !!currentEnvironment?._id && !!campaignId,
  });
}

/** Destinataires d'une exécution ; la page précédente reste affichée pendant le chargement de la suivante. */
export function useCrmRunRecipients(params: {
  campaignId: string;
  runId: string;
  filter: CrmRecipientFilter;
  search: string;
  cursor?: string;
  limit: number;
}) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmRunRecipients, currentEnvironment?._id, params],
    queryFn: ({ signal }) => getCrmRunRecipients({ environment: currentEnvironment!, ...params, signal }),
    enabled: !!currentEnvironment?._id && !!params.campaignId && !!params.runId,
    placeholderData: keepPreviousData,
  });
}

export function useCrmReportOverview(days: number) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmReportOverview, currentEnvironment?._id, days],
    queryFn: ({ signal }) => getCrmReportOverview({ environment: currentEnvironment!, days, signal }),
    enabled: !!currentEnvironment?._id,
  });
}
