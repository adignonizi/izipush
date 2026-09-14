import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCrmIngestion, replayCrmDeadLetters } from '@/api/crm-monitoring';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

// izipush-crm — hooks de la page « Suivi ».

export function useCrmIngestion(days: number) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmIngestion, currentEnvironment?._id, days],
    queryFn: ({ signal }) => getCrmIngestion({ environment: currentEnvironment!, days, signal }),
    enabled: !!currentEnvironment?._id,
    refetchInterval: 15_000,
  });
}

export function useReplayCrmDeadLetters() {
  const { currentEnvironment } = useEnvironment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (limit: number) => replayCrmDeadLetters({ environment: currentEnvironment!, limit }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmIngestion, currentEnvironment?._id] }),
  });
}
