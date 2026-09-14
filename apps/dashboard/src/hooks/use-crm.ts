import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreateCrmCampaignBody,
  CreateCrmSegmentBody,
  CrmConditionGroup,
  createCrmCampaign,
  createCrmSegment,
  deleteCrmCampaign,
  deleteCrmSegment,
  getCrmCampaignRuns,
  getCrmCampaigns,
  getCrmFields,
  getCrmSegments,
  previewCrmSegment,
  retryCrmSegmentFreeze,
  setCrmCampaignState,
} from '@/api/crm';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

// izipush-crm — hooks des pages Segments et Campagnes.

/** Les segments en cours de figeage et les campagnes actives changent seuls : on rafraîchit régulièrement. */
const LIVE_REFRESH_MS = 5000;

export function useCrmFields() {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmFields, currentEnvironment?._id],
    queryFn: ({ signal }) => getCrmFields({ environment: currentEnvironment!, signal }),
    enabled: !!currentEnvironment?._id,
    staleTime: Infinity,
  });
}

export function useCrmSegments() {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmSegments, currentEnvironment?._id],
    queryFn: ({ signal }) => getCrmSegments({ environment: currentEnvironment!, signal }),
    enabled: !!currentEnvironment?._id,
    refetchInterval: (query) =>
      query.state.data?.some((segment) => segment.status === 'freezing') ? LIVE_REFRESH_MS : false,
  });
}

export function useCrmCampaigns() {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmCampaigns, currentEnvironment?._id],
    queryFn: ({ signal }) => getCrmCampaigns({ environment: currentEnvironment!, signal }),
    enabled: !!currentEnvironment?._id,
    refetchInterval: (query) =>
      query.state.data?.some((campaign) => campaign.status === 'active') ? LIVE_REFRESH_MS : false,
  });
}

export function useCrmCampaignRuns(campaignId?: string) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmCampaignRuns, currentEnvironment?._id, campaignId],
    queryFn: ({ signal }) => getCrmCampaignRuns({ environment: currentEnvironment!, campaignId: campaignId!, signal }),
    enabled: !!currentEnvironment?._id && !!campaignId,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function usePreviewCrmSegment() {
  const { currentEnvironment } = useEnvironment();

  return useMutation({
    mutationFn: (audience: CrmConditionGroup) => previewCrmSegment({ environment: currentEnvironment!, audience }),
  });
}

function useInvalidate(key: string) {
  const queryClient = useQueryClient();
  const { currentEnvironment } = useEnvironment();

  return () => queryClient.invalidateQueries({ queryKey: [key, currentEnvironment?._id] });
}

export function useCreateCrmSegment() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidate(QueryKeys.fetchCrmSegments);

  return useMutation({
    mutationFn: (body: CreateCrmSegmentBody) => createCrmSegment({ environment: currentEnvironment!, body }),
    onSuccess: invalidate,
  });
}

export function useDeleteCrmSegment() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidate(QueryKeys.fetchCrmSegments);

  return useMutation({
    mutationFn: (segmentId: string) => deleteCrmSegment({ environment: currentEnvironment!, segmentId }),
    onSuccess: invalidate,
  });
}

export function useCreateCrmCampaign() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidate(QueryKeys.fetchCrmCampaigns);

  return useMutation({
    mutationFn: (body: CreateCrmCampaignBody) => createCrmCampaign({ environment: currentEnvironment!, body }),
    onSuccess: invalidate,
  });
}

export function useSetCrmCampaignState() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidate(QueryKeys.fetchCrmCampaigns);

  return useMutation({
    mutationFn: ({ campaignId, action }: { campaignId: string; action: 'activate' | 'pause' }) =>
      setCrmCampaignState({ environment: currentEnvironment!, campaignId, action }),
    onSuccess: invalidate,
  });
}

export function useDeleteCrmCampaign() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidate(QueryKeys.fetchCrmCampaigns);

  return useMutation({
    mutationFn: (campaignId: string) => deleteCrmCampaign({ environment: currentEnvironment!, campaignId }),
    onSuccess: invalidate,
  });
}

export function useRetryCrmSegmentFreeze() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidate(QueryKeys.fetchCrmSegments);

  return useMutation({
    mutationFn: (segmentId: string) => retryCrmSegmentFreeze({ environment: currentEnvironment!, segmentId }),
    onSuccess: invalidate,
  });
}
