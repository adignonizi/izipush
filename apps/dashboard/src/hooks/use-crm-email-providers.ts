import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CrmEmailProviderSettings,
  getCrmEmailProviders,
  getCrmEmailUsage,
  saveCrmEmailProvider,
} from '@/api/crm-email-providers';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

// izipush-crm — hooks des fournisseurs email et de leur suivi.

export function useCrmEmailProviders() {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmEmailProviders, currentEnvironment?._id],
    queryFn: ({ signal }) => getCrmEmailProviders({ environment: currentEnvironment!, signal }),
    enabled: !!currentEnvironment?._id,
    // Compteurs de la minute en cours : rafraîchis régulièrement.
    refetchInterval: 15_000,
  });
}

export function useCrmEmailUsage(days: number) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmEmailUsage, currentEnvironment?._id, days],
    queryFn: ({ signal }) => getCrmEmailUsage({ environment: currentEnvironment!, days, signal }),
    enabled: !!currentEnvironment?._id,
    refetchInterval: 60_000,
  });
}

export function useSaveCrmEmailProvider() {
  const { currentEnvironment } = useEnvironment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ integrationId, body }: { integrationId: string; body: CrmEmailProviderSettings }) =>
      saveCrmEmailProvider({ environment: currentEnvironment!, integrationId, body }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmEmailProviders, currentEnvironment?._id] }),
  });
}
