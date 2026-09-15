import { useState } from 'react';
import { RiAddLine, RiDeleteBin2Line, RiFilter3Line, RiRefreshLine } from 'react-icons/ri';
import { useNavigate } from 'react-router-dom';
import type { CrmSegment } from '@/api/crm';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { formatDateTime, formatDay, formatNumber, t } from '@/components/crm/crm-i18n';
import { SEGMENT_STATUS } from '@/components/crm/crm-labels';
import { CrmBlankState, CrmListIntro, CrmRowMenu } from '@/components/crm/crm-page';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmSegments, useDeleteCrmSegment, useRetryCrmSegmentFreeze } from '@/hooks/use-crm';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — liste des segments.

export function CrmSegmentsPage() {
  const navigate = useNavigate();
  const { currentEnvironment } = useEnvironment();
  const { data: segments = [], isLoading } = useCrmSegments();
  const remove = useDeleteCrmSegment();
  const retry = useRetryCrmSegmentFreeze();
  const [toDelete, setToDelete] = useState<CrmSegment>();

  const newHref = buildRoute(ROUTES.CRM_SEGMENT_NEW, { environmentSlug: currentEnvironment?.slug ?? '' });

  const retryFreeze = async (segment: CrmSegment) => {
    try {
      await retry.mutateAsync(segment._id);
      showSuccessToast(t('segments.toast.retried'));
    } catch (error) {
      showErrorToast((error as Error).message, t('segments.toast.retryFailed'));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;

    try {
      await remove.mutateAsync(toDelete._id);
      showSuccessToast(t('segments.toast.deleted'));
    } catch (error) {
      showErrorToast((error as Error).message, t('segments.toast.deleteFailed'));
    } finally {
      setToDelete(undefined);
    }
  };

  const newButton = (
    <Button variant="primary" size="xs" leadingIcon={RiAddLine} onClick={() => navigate(newHref)}>
      {t('segments.new')}
    </Button>
  );

  return (
    <>
      <PageMeta title={t('nav.segments')} />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">{t('nav.segments')}</h1>}>
        <div className="flex flex-col px-2.5 pb-6 md:px-4">
          {!isLoading && segments.length === 0 ? (
            <CrmBlankState
              icon={RiFilter3Line}
              title={t('segments.blank.title')}
              description={t('segments.blank.text')}
              action={newButton}
            />
          ) : (
            <>
              <CrmListIntro description={t('segments.description')} action={newButton} />
              <Table isLoading={isLoading} loadingRowsCount={5}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('segments.col.name')}</TableHead>
                    <TableHead>{t('segments.col.type')}</TableHead>
                    <TableHead className="text-right">{t('segments.col.count')}</TableHead>
                    <TableHead>{t('segments.col.status')}</TableHead>
                    <TableHead>{t('segments.col.created')}</TableHead>
                    <TableHead className="w-1">
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {segments.map((segment) => (
                    <TableRow key={segment._id}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="text-text-strong truncate font-medium">{segment.name}</span>
                          {segment.description && (
                            <span className="text-text-soft text-paragraph-xs max-w-[420px] truncate">
                              {segment.description}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-text-sub text-paragraph-sm">
                        {segment.frozen
                          ? t('segments.type.frozen', { date: formatDay(segment.frozenAt) })
                          : t('segments.type.dynamic')}
                      </TableCell>
                      <TableCell className="text-text-sub text-right tabular-nums">
                        {segment.frozen ? (
                          formatNumber(segment.memberCount)
                        ) : (
                          <span className="text-text-soft text-paragraph-xs">{t('segments.count.dynamic')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="lighter" color={SEGMENT_STATUS[segment.status].color} size="md">
                          {SEGMENT_STATUS[segment.status].label}
                        </Badge>
                        {segment.error && (
                          <p className="text-error-base text-paragraph-xs mt-1 max-w-[280px]">{segment.error}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-text-sub font-code text-code-xs whitespace-nowrap">
                        {formatDateTime(segment.createdAt)}
                      </TableCell>
                      <TableCell className="w-1">
                        <CrmRowMenu
                          items={[
                            ...(segment.frozen && segment.status === 'failed'
                              ? [
                                  {
                                    label: t('segments.action.retry'),
                                    icon: RiRefreshLine,
                                    disabled: retry.isPending,
                                    onSelect: () => retryFreeze(segment),
                                  },
                                ]
                              : []),
                            {
                              label: t('common.delete'),
                              icon: RiDeleteBin2Line,
                              destructive: true,
                              onSelect: () => setToDelete(segment),
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>

        <ConfirmationModal
          open={!!toDelete}
          onOpenChange={(open) => !open && setToDelete(undefined)}
          onConfirm={confirmDelete}
          title={t('segments.delete.title')}
          description={t('segments.delete.text', { name: toDelete?.name ?? '' })}
          confirmButtonText={t('common.delete')}
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
