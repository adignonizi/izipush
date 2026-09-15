import { useMemo, useState } from 'react';
import { RiDeleteBin2Line, RiEditLine, RiMegaphoneLine, RiPauseLine, RiPlayLine } from 'react-icons/ri';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { ActivateCampaignDialog } from '@/components/crm/activate-campaign-dialog';
import { formatDateTime, formatNumber, t } from '@/components/crm/crm-i18n';
import { CAMPAIGN_STATUS, describeSchedule, RUN_STATUS } from '@/components/crm/crm-labels';
import { CrmBreadcrumbHeader, CrmRowMenu, CrmSection, CrmStat, CrmTitleBar } from '@/components/crm/crm-page';
import { describeChannels, rate, totalStats, workflowChannels } from '@/components/crm/crm-stats';
import { DashboardLayout } from '@/components/dashboard-layout';
import { DetailsSidebar, DetailsSidebarCard, DetailsSidebarRow } from '@/components/details-sidebar';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { HelpTooltipIndicator } from '@/components/primitives/help-tooltip-indicator';
import { InlineToast } from '@/components/primitives/inline-toast';
import { Skeleton } from '@/components/primitives/skeleton';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/tooltip';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmCampaign, useCrmSegments, useDeleteCrmCampaign, useSetCrmCampaignState } from '@/hooks/use-crm';
import { useCrmCampaignReport } from '@/hooks/use-crm-reports';
import { useFetchWorkflows } from '@/hooks/use-fetch-workflows';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — une campagne : ce qu'elle envoie, à qui, quand, et ce que ça a donné.

function SidebarValue({ children }: { children: React.ReactNode }) {
  return <span className="text-text-sub text-label-xs max-w-[170px] truncate text-right">{children}</span>;
}

export function CrmCampaignDetailPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { currentEnvironment } = useEnvironment();
  const environmentSlug = currentEnvironment?.slug ?? '';
  const listHref = buildRoute(ROUTES.CRM_CAMPAIGNS, { environmentSlug });

  const { data: campaign, isLoading } = useCrmCampaign(campaignId);
  const { data: report, isLoading: isLoadingReport } = useCrmCampaignReport(campaignId);
  const { data: segments = [] } = useCrmSegments();
  const { data: workflowsData } = useFetchWorkflows({ limit: 100 });
  const setState = useSetCrmCampaignState();
  const remove = useDeleteCrmCampaign();
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const segment = segments.find((candidate) => candidate._id === campaign?.segmentId);
  const workflow = workflowsData?.workflows.find((candidate) => candidate.workflowId === campaign?.workflowKey);
  const runs = report?.runs ?? [];
  const isActive = campaign?.status === 'active';

  const totals = useMemo(() => {
    const stats = totalStats([...runs.flatMap((run) => run.stats), ...(report?.onEvent?.stats ?? [])]);
    const audience = runs.reduce((sum, run) => sum + (run.audienceSize ?? 0), 0);

    return { ...stats, audience };
  }, [runs, report?.onEvent]);

  const changeState = async (action: 'activate' | 'pause') => {
    try {
      await setState.mutateAsync({ campaignId, action });
      showSuccessToast(action === 'activate' ? t('campaigns.toast.activated') : t('campaigns.toast.paused'));
    } catch (error) {
      showErrorToast(
        (error as Error).message,
        action === 'activate' ? t('campaigns.toast.activateFailed') : t('campaigns.toast.pauseFailed')
      );
    } finally {
      setConfirmActivate(false);
    }
  };

  const deleteCampaign = async () => {
    try {
      await remove.mutateAsync(campaignId);
      showSuccessToast(t('campaigns.toast.deleted'));
      navigate(listHref);
    } catch (error) {
      showErrorToast((error as Error).message, t('campaigns.toast.deleteFailed'));
    } finally {
      setConfirmDelete(false);
    }
  };

  const editHref = buildRoute(ROUTES.CRM_CAMPAIGN_EDIT, { environmentSlug, campaignId });

  const editButton = (
    <Button
      variant="secondary"
      mode="outline"
      size="xs"
      leadingIcon={RiEditLine}
      disabled={!campaign || isActive}
      onClick={() => navigate(editHref)}
    >
      {t('common.edit')}
    </Button>
  );

  return (
    <>
      <PageMeta title={campaign?.name ?? t('nav.campaigns')} />
      <DashboardLayout
        headerStartItems={
          <CrmBreadcrumbHeader
            parentLabel={t('nav.campaigns')}
            parentTo={listHref}
            current={campaign?.name}
            icon={RiMegaphoneLine}
            isLoading={isLoading}
          />
        }
      >
        <div className="flex h-full flex-col">
          <CrmTitleBar
            isLoading={isLoading}
            title={campaign?.name}
            badge={
              campaign && (
                <Badge variant="lighter" color={CAMPAIGN_STATUS[campaign.status].color} size="md">
                  {CAMPAIGN_STATUS[campaign.status].label}
                </Badge>
              )
            }
            description={campaign ? describeSchedule(campaign.schedule) : undefined}
            actions={
              campaign && (
                <>
                  {isActive ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{editButton}</span>
                      </TooltipTrigger>
                      <TooltipContent>{t('campaigns.pauseToEdit')}</TooltipContent>
                    </Tooltip>
                  ) : (
                    editButton
                  )}
                  {isActive ? (
                    <Button
                      variant="secondary"
                      mode="outline"
                      size="xs"
                      leadingIcon={RiPauseLine}
                      isLoading={setState.isPending}
                      onClick={() => changeState('pause')}
                    >
                      {t('campaigns.action.pause')}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="xs"
                      leadingIcon={RiPlayLine}
                      onClick={() => setConfirmActivate(true)}
                    >
                      {t('campaigns.action.activate')}
                    </Button>
                  )}
                  <CrmRowMenu
                    items={[
                      {
                        label: isActive ? t('campaigns.pauseToDelete') : t('common.delete'),
                        icon: RiDeleteBin2Line,
                        destructive: true,
                        disabled: isActive,
                        onSelect: () => setConfirmDelete(true),
                      },
                    ]}
                  />
                </>
              )
            }
          />

          <div className="flex-1 overflow-auto">
            <div className="flex flex-col gap-6 px-4 pb-6 pt-4 md:flex-row md:px-6">
              <div className="md:sticky md:top-4 md:self-start">
                <DetailsSidebar className="w-full md:w-[300px]">
                  <DetailsSidebarCard>
                    <DetailsSidebarRow label={t('detail.row.audience')}>
                      {isLoading ? (
                        <Skeleton className="h-4 w-28" />
                      ) : (
                        <SidebarValue>{segment?.name ?? '—'}</SidebarValue>
                      )}
                    </DetailsSidebarRow>
                    <DetailsSidebarRow label={t('detail.row.workflow')}>
                      {isLoading ? (
                        <Skeleton className="h-4 w-28" />
                      ) : (
                        <SidebarValue>{workflow?.name ?? campaign?.workflowKey ?? '—'}</SidebarValue>
                      )}
                    </DetailsSidebarRow>
                    {workflow && (
                      <DetailsSidebarRow label=" ">
                        <SidebarValue>{workflowChannels(workflow.stepTypeOverviews).join(' · ')}</SidebarValue>
                      </DetailsSidebarRow>
                    )}
                    <DetailsSidebarRow label={t('detail.row.next')}>
                      <SidebarValue>{formatDateTime(campaign?.nextRunAt)}</SidebarValue>
                    </DetailsSidebarRow>
                    <DetailsSidebarRow label={t('detail.row.last')}>
                      <SidebarValue>{formatDateTime(campaign?.lastRunAt)}</SidebarValue>
                    </DetailsSidebarRow>
                    <DetailsSidebarRow label={t('detail.row.created')}>
                      <SidebarValue>{formatDateTime(campaign?.createdAt)}</SidebarValue>
                    </DetailsSidebarRow>
                  </DetailsSidebarCard>
                </DetailsSidebar>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-8">
                {campaign?.error && (
                  <InlineToast variant="error" title={t('detail.error')} description={campaign.error} />
                )}

                <CrmSection title={t('detail.results')}>
                  <div className="border-stroke-soft flex flex-wrap gap-6 rounded-lg border p-4">
                    <CrmStat
                      label={t('stat.audience')}
                      value={formatNumber(totals.audience)}
                      isLoading={isLoadingReport}
                    />
                    <CrmStat label={t('stat.sent')} value={formatNumber(totals.sent)} isLoading={isLoadingReport} />
                    <CrmStat label={t('stat.errors')} value={formatNumber(totals.errors)} isLoading={isLoadingReport} />
                    <CrmStat
                      label={t('stat.openRate')}
                      value={rate(totals.opened, totals.sent)}
                      hint={formatNumber(totals.opened)}
                      help={t('stat.openHint')}
                      isLoading={isLoadingReport}
                    />
                    <CrmStat
                      label={t('stat.clickRate')}
                      value={rate(totals.clicked, totals.sent)}
                      hint={formatNumber(totals.clicked)}
                      isLoading={isLoadingReport}
                    />
                  </div>
                  {report?.onEvent && (
                    <p className="text-text-soft text-paragraph-xs">
                      {t('detail.onEvent')} : {describeChannels(report.onEvent.stats)}
                    </p>
                  )}
                </CrmSection>

                <CrmSection title={t('detail.runs')}>
                  <Table isLoading={isLoadingReport} loadingRowsCount={3}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('run.col.date')}</TableHead>
                        <TableHead>{t('detail.row.status')}</TableHead>
                        <TableHead className="text-right">{t('stat.audience')}</TableHead>
                        <TableHead className="text-right">
                          <span className="inline-flex items-center gap-1">
                            {t('stat.excluded')}
                            <HelpTooltipIndicator text={t('stat.excludedHint')} size="3" />
                          </span>
                        </TableHead>
                        <TableHead>{t('stat.sent')}</TableHead>
                        <TableHead className="text-right">{t('stat.errors')}</TableHead>
                        <TableHead className="text-right">{t('stat.opened')}</TableHead>
                        <TableHead className="text-right">{t('stat.clicked')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => {
                        const total = totalStats(run.stats);

                        return (
                          <TableRow key={run._id}>
                            <TableCell className="text-text-sub whitespace-nowrap">
                              {formatDateTime(run.scheduledFor)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="lighter" color={RUN_STATUS[run.status].color} size="md">
                                {RUN_STATUS[run.status].label}
                              </Badge>
                              {run.error && (
                                <p className="text-error-base text-paragraph-xs mt-1 max-w-[260px]">{run.error}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatNumber(run.audienceSize)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatNumber(run.excludedCount)}</TableCell>
                            <TableCell className="text-text-sub text-paragraph-xs">
                              {describeChannels(run.stats)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatNumber(total.errors)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatNumber(total.opened)}{' '}
                              <span className="text-text-soft text-paragraph-xs">{rate(total.opened, total.sent)}</span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatNumber(total.clicked)}{' '}
                              <span className="text-text-soft text-paragraph-xs">
                                {rate(total.clicked, total.sent)}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!isLoadingReport && runs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-text-soft text-paragraph-sm py-8 text-center">
                            {t('detail.runs.empty')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CrmSection>
              </div>
            </div>
          </div>
        </div>

        <ActivateCampaignDialog
          open={confirmActivate}
          onOpenChange={setConfirmActivate}
          campaign={campaign}
          segmentName={segment?.name}
          onConfirm={() => changeState('activate')}
          isLoading={setState.isPending}
        />
        <ConfirmationModal
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onConfirm={deleteCampaign}
          title={t('campaigns.delete.title')}
          description={t('campaigns.delete.text', { name: campaign?.name ?? '' })}
          confirmButtonText={t('common.delete')}
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
