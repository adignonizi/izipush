import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getKeycloakAuth, updateKeycloakAuth, type KeycloakAuthSettings } from '@/api/environments';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

export const useFetchKeycloakAuth = () => {
  const { currentEnvironment } = useEnvironment();

  return useQuery<{ data: KeycloakAuthSettings }>({
    queryKey: [QueryKeys.getKeycloakAuth, currentEnvironment?._id],
    queryFn: async () => await getKeycloakAuth({ environment: currentEnvironment! }),
    enabled: !!currentEnvironment?._id,
  });
};

export const useUpdateKeycloakAuth = () => {
  const { currentEnvironment } = useEnvironment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: KeycloakAuthSettings) => updateKeycloakAuth({ environment: currentEnvironment!, settings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.getKeycloakAuth, currentEnvironment?._id] });
    },
  });
};
