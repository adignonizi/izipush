import { useState } from 'react';
import {
  RiAddLine,
  RiBarChartBoxLine,
  RiDeleteBin2Line,
  RiEditLine,
  RiMegaphoneLine,
  RiPauseLine,
  RiPlayLine,
} from 'react-icons/ri';
import { useNavigate } from 'react-router-dom';
import type { CrmCampaign } from '@/api/crm';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { ActivateCampaignDialog } from '@/components/crm/activate-campaign-dialog';
import { formatDateTime, t } from '@/components/crm/crm-i18n';
import { CAMPAIGN_STATUS, describeSchedule } from '@/components/crm/crm-labels';
import { CrmBlankState, CrmLinkedCell, CrmListIntro, CrmRowMenu, CrmRowTitle } from '@/components/crm/crm-page';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmCampaigns, useCrmSegments, useDeleteCrmCampaign, useSetCrmCampaignState } from '@/hooks/use-crm';
import { useFetchWorkflows } from '@/hooks/use-fetch-workflows';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — liste des campagnes : état, prochain envoi, et actions rapides.

export function CrmCampaignsPage() {
  const navigate = useNavigate();
  const { currentEnvironment } = useEnvironment();
  const environmentSlug = currentEnvironment?.slug ?? '';
  const { data: campaigns = [], isLoading } = useCrmCampaigns();
  const { data: segments = [] } = useCrmSegments();
  const { data: workflowsData } = useFetchWorkflows({ limit: 100 });
  const setState = useSetCrmCampaignState();
  const remove = useDeleteCrmCampaign();
  const [toActivate, setToActivate] = useState<CrmCampaign>();
  const [toDelete, setToDelete] = useState<CrmCampaign>();

  const newHref = buildRoute(ROUTES.CRM_CAMPAIGN_NEW, { environmentSlug });
  const detailHref = (campaign: CrmCampaign) =>
    buildRoute(ROUTES.CRM_CAMPAIGN_DETAIL, { environmentSlug, campaignId: campaign._id });
  const segmentName = (segmentId: string) => segments.find((segment) => segment._id === segmentId)?.name ?? '—';
  const workflowName = (key: string) =>
    workflowsData?.workflows.find((workflow) => workflow.workflowId === key)?.name ?? key;

  const changeState = async (campaign: CrmCampaign, action: 'activate' | 'pause') => {
    try {
      await setState.mutateAsync({ campaignId: campaign._id, action });
      showSuccessToast(action === 'activate' ? t('campaigns.toast.activated') : t('campaigns.toast.paused'));
    } catch (error) {
      showErrorToast(
        (error as Error).message,
        action === 'activate' ? t('campaigns.toast.activateFailed') : t('campaigns.toast.pauseFailed')
      );
    } finally {
      setToActivate(undefined);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;

    try {
      await remove.mutateAsync(toDelete._id);
      showSuccessToast(t('campaigns.toast.deleted'));
    } catch (error) {
      showErrorToast((error as Error).message, t('campaigns.toast.deleteFailed'));
    } finally {
      setToDelete(undefined);
    }
  };

  const newButton = (
    <Button variant="primary" size="xs" leadingIcon={RiAddLine} onClick={() => navigate(newHref)}>
      {t('campaigns.new')}
    </Button>
  );

  return (
    <>
      <PageMeta title={t('nav.campaigns')} />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">{t('nav.campaigns')}</h1>}>
        <div className="flex flex-col px-2.5 pb-6 md:px-4">
          {!isLoading && campaigns.length === 0 ? (
            <CrmBlankState
              icon={RiMegaphoneLine}
              title={t('campaigns.blank.title')}
              description={t('campaigns.blank.text')}
              action={newButton}
            />
          ) : (
            <>
              <CrmListIntro description={t('campaigns.description')} action={newButton} />
              <Table isLoading={isLoading} loadingRowsCount={5}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaigns.col.name')}</TableHead>
                    <TableHead>{t('campaigns.col.schedule')}</TableHead>
                    <TableHead>{t('campaigns.col.status')}</TableHead>
                    <TableHead>{t('campaigns.col.next')}</TableHead>
                    <TableHead>{t('campaigns.col.last')}</TableHead>
                    <TableHead className="w-1">
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => {
                    const href = detailHref(campaign);
                    const isActive = campaign.status === 'active';

                    return (
                      <TableRow key={campaign._id} className="group relative isolate cursor-pointer">
                        <CrmLinkedCell to={href}>
                          <CrmRowTitle
                            to={href}
                            title={campaign.name}
                            subtitle={`${segmentName(campaign.segmentId)} · ${workflowName(campaign.workflowKey)}`}
                          />
                          {campaign.error && (
                            <span className="text-error-base text-paragraph-xs relative z-10 block max-w-[320px] truncate">
                              {campaign.error}
                            </span>
                          )}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="text-paragraph-sm">
                          {describeSchedule(campaign.schedule)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href}>
                          <Badge variant="lighter" color={CAMPAIGN_STATUS[campaign.status].color} size="md">
                            {CAMPAIGN_STATUS[campaign.status].label}
                          </Badge>
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs whitespace-nowrap">
                          {formatDateTime(campaign.nextRunAt)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs whitespace-nowrap">
                          {formatDateTime(campaign.lastRunAt)}
                        </CrmLinkedCell>
                        <TableCell className="group-hover:bg-neutral-alpha-50 w-1">
                          <CrmRowMenu
                            items={[
                              {
                                label: t('campaigns.action.view'),
                                icon: RiBarChartBoxLine,
                                onSelect: () => navigate(href),
                              },
                              {
                                label: isActive ? t('campaigns.pauseToEdit') : t('common.edit'),
                                icon: RiEditLine,
                                disabled: isActive,
                                onSelect: () =>
                                  navigate(
                                    buildRoute(ROUTES.CRM_CAMPAIGN_EDIT, { environmentSlug, campaignId: campaign._id })
                                  ),
                              },
                              isActive
                                ? {
                                    label: t('campaigns.action.pause'),
                                    icon: RiPauseLine,
                                    onSelect: () => changeState(campaign, 'pause'),
                                  }
                                : {
                                    label: t('campaigns.action.activate'),
                                    icon: RiPlayLine,
                                    onSelect: () => setToActivate(campaign),
                                  },
                              {
                                label: t('common.delete'),
                                icon: RiDeleteBin2Line,
                                destructive: true,
                                disabled: isActive,
                                separatorBefore: true,
                                onSelect: () => setToDelete(campaign),
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </div>

        <ActivateCampaignDialog
          open={!!toActivate}
          onOpenChange={(open) => !open && setToActivate(undefined)}
          campaign={toActivate}
          segmentName={toActivate ? segmentName(toActivate.segmentId) : undefined}
          onConfirm={() => toActivate && changeState(toActivate, 'activate')}
          isLoading={setState.isPending}
        />
        <ConfirmationModal
          open={!!toDelete}
          onOpenChange={(open) => !open && setToDelete(undefined)}
          onConfirm={confirmDelete}
          title={t('campaigns.delete.title')}
          description={t('campaigns.delete.text', { name: toDelete?.name ?? '' })}
          confirmButtonText={t('common.delete')}
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
