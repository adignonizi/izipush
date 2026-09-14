import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CrmTemplateBody,
  createCrmTemplate,
  deleteCrmTemplate,
  getCrmTemplate,
  getCrmTemplates,
  updateCrmTemplate,
} from '@/api/crm-templates';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

// izipush-crm — hooks des templates email.

export function useCrmTemplates() {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmTemplates, currentEnvironment?._id],
    queryFn: ({ signal }) => getCrmTemplates({ environment: currentEnvironment!, signal }),
    enabled: !!currentEnvironment?._id,
  });
}

export function useCrmTemplate(templateId?: string) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmTemplate, currentEnvironment?._id, templateId],
    queryFn: ({ signal }) => getCrmTemplate({ environment: currentEnvironment!, templateId: templateId!, signal }),
    enabled: !!currentEnvironment?._id && !!templateId,
    refetchOnWindowFocus: false,
  });
}

export function useSaveCrmTemplate() {
  const { currentEnvironment } = useEnvironment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ templateId, body }: { templateId?: string; body: CrmTemplateBody }) =>
      templateId
        ? updateCrmTemplate({ environment: currentEnvironment!, templateId, body })
        : createCrmTemplate({ environment: currentEnvironment!, body }).then((template) => ({
            ...template,
            propagatedSteps: 0,
          })),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmTemplates, currentEnvironment?._id] }),
  });
}

export function useDeleteCrmTemplate() {
  const { currentEnvironment } = useEnvironment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (templateId: string) => deleteCrmTemplate({ environment: currentEnvironment!, templateId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmTemplates, currentEnvironment?._id] }),
  });
}
