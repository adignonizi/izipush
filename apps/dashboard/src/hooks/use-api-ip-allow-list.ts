import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApiIpAllowList, updateApiIpAllowList } from '@/api/environments';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

export const useFetchApiIpAllowList = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const { currentEnvironment } = useEnvironment();

  return useQuery<{ data: { ipAllowList: string[] } }>({
    queryKey: [QueryKeys.getApiIpAllowList, currentEnvironment?._id],
    queryFn: async () => await getApiIpAllowList({ environment: currentEnvironment! }),
    enabled: !!currentEnvironment?._id && enabled,
  });
};

export const useUpdateApiIpAllowList = () => {
  const { currentEnvironment } = useEnvironment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ipAllowList: string[]) => updateApiIpAllowList({ environment: currentEnvironment!, ipAllowList }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKeys.getApiIpAllowList, currentEnvironment?._id],
      });
    },
  });
};
