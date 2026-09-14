import { useQuery } from '@tanstack/react-query';
import { getCrmCampaignReport, getCrmReportOverview } from '@/api/crm-reports';
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

export function useCrmReportOverview(days: number) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmReportOverview, currentEnvironment?._id, days],
    queryFn: ({ signal }) => getCrmReportOverview({ environment: currentEnvironment!, days, signal }),
    enabled: !!currentEnvironment?._id,
  });
}
