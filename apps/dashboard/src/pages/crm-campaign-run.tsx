import { useEffect, useState } from 'react';
import { RiDownload2Line, RiMegaphoneLine } from 'react-icons/ri';
import { useParams } from 'react-router-dom';
import { type CrmRecipient, type CrmRecipientFilter, getCrmRunRecipients } from '@/api/crm-reports';
import { CrmChartCard, CrmFunnel } from '@/components/crm/crm-campaign-charts';
import { type CrmMessageKey, formatDateTime, formatNumber, t } from '@/components/crm/crm-i18n';
import { RUN_STATUS } from '@/components/crm/crm-labels';
import { CrmBreadcrumbHeader, CrmSection, CrmTitleBar } from '@/components/crm/crm-page';
import { channelLabel, totalStats } from '@/components/crm/crm-stats';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { InlineToast } from '@/components/primitives/inline-toast';
import { Input } from '@/components/primitives/input';
import {
  SegmentedControl,
  SegmentedControlList,
  SegmentedControlTrigger,
} from '@/components/primitives/segmented-control';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { TablePaginationFooter } from '@/components/primitives/table-pagination-footer';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmCampaign } from '@/hooks/use-crm';
import { useCrmRunRecipients } from '@/hooks/use-crm-reports';
import { buildRoute, ROUTES } from '@/utils/routes';
import { cn } from '@/utils/ui';

// izipush-crm — une exécution de campagne : son parcours, puis chaque message envoyé, client par client.
// `runId` vaut « events » pour les envois d'une campagne « sur événement » (30 derniers jours).

const FILTERS: CrmRecipientFilter[] = ['all', 'sent', 'unopened', 'opened', 'clicked', 'error', 'skipped'];
const FILTER_LABEL: Record<CrmRecipientFilter, CrmMessageKey> = {
  all: 'runPage.filter.all',
  sent: 'runPage.filter.sent',
  unopened: 'runPage.filter.unopened',
  opened: 'runPage.filter.opened',
  clicked: 'runPage.filter.clicked',
  error: 'runPage.filter.error',
  skipped: 'runPage.filter.skipped',
};
const PAGE_SIZES = [20, 50, 100];
const EXPORT_BATCH = 1000;
const EXPORT_MAX = 50_000;

const STATUS_STYLE: Record<CrmRecipient['status'], { dot: string; label: () => string }> = {
  sent: { dot: 'bg-success-base', label: () => t('runPage.status.sent') },
  error: { dot: 'bg-error-base', label: () => t('runPage.status.error') },
  warning: { dot: 'bg-text-soft', label: () => t('runPage.status.skipped') },
};

function clientName(row: CrmRecipient): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ');
}

function openedLabel(row: CrmRecipient): string {
  if (row.openedAt) return formatDateTime(row.openedAt);
  if (row.read) return t('runPage.read');
  if (row.seen) return t('runPage.seen');

  return '—';
}

/** Point-virgule et BOM : s'ouvre tel quel dans Excel en français. Les formules sont neutralisées. */
function toCsv(rows: CrmRecipient[]): string {
  const columns: [string, (row: CrmRecipient) => string | undefined][] = [
    ['subscriber_id', (row) => row.subscriberId],
    ['first_name', (row) => row.firstName],
    ['last_name', (row) => row.lastName],
    ['email', (row) => row.email],
    ['channel', (row) => row.channel],
    ['status', (row) => row.status],
    ['error', (row) => row.errorText],
    ['sent_at', (row) => row.createdAt],
    ['delivered_at', (row) => row.deliveredAt],
    ['opened_at', (row) => row.openedAt],
    ['clicked_at', (row) => row.clickedAt],
  ];
  const cell = (value?: string) => {
    const text = (value ?? '').replace(/^([=+\-@])/, "'$1");

    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return `﻿${[
    columns.map(([name]) => name).join(';'),
    ...rows.map((row) => columns.map(([, value]) => cell(value(row))).join(';')),
  ].join('\r\n')}`;
}

function downloadFile(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function CrmCampaignRunPage() {
  const { campaignId = '', runId = '' } = useParams<{ campaignId: string; runId: string }>();
  const { currentEnvironment } = useEnvironment();
  const environmentSlug = currentEnvironment?.slug ?? '';
  const campaignHref = buildRoute(ROUTES.CRM_CAMPAIGN_DETAIL, { environmentSlug, campaignId });
  const { data: campaign, isLoading: isLoadingCampaign } = useCrmCampaign(campaignId);
  const isEvents = runId === 'events';

  const [filter, setFilter] = useState<CrmRecipientFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [exported, setExported] = useState<number | null>(null);
  const cursor = cursors[cursors.length - 1];

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tout changement de critère repart de la première page
  useEffect(() => setCursors([undefined]), [filter, search, pageSize]);

  const { data, isLoading, isFetching, isError } = useCrmRunRecipients({
    campaignId,
    runId,
    filter,
    search,
    cursor,
    limit: pageSize,
  });

  const run = data?.run ?? null;
  const stats = run?.stats ?? data?.onEvent?.stats ?? [];
  const totals = totalStats(stats);
  const counts: Record<CrmRecipientFilter, number> = {
    all: totals.sent + totals.errors + totals.skipped,
    sent: totals.sent,
    unopened: Math.max(0, totals.sent - totals.opened),
    opened: totals.opened,
    clicked: totals.clicked,
    error: totals.errors,
    skipped: totals.skipped,
  };
  const rows = data?.rows ?? [];
  const title = isEvents
    ? t('runPage.eventsTitle')
    : run
      ? t('runPage.title', { date: formatDateTime(run.scheduledFor) })
      : undefined;

  const exportCsv = async () => {
    if (!currentEnvironment) return;

    setExported(0);
    try {
      const collected: CrmRecipient[] = [];
      let next: string | undefined;
      do {
        const page = await getCrmRunRecipients({
          environment: currentEnvironment,
          campaignId,
          runId,
          filter,
          search,
          cursor: next,
          limit: EXPORT_BATCH,
        });
        collected.push(...page.rows);
        next = page.nextCursor ?? undefined;
        setExported(collected.length);
      } while (next && collected.length < EXPORT_MAX);

      const day = new Date(run?.scheduledFor ?? Date.now()).toISOString().slice(0, 10);
      downloadFile(`${slug(campaign?.name ?? 'campagne')}-${isEvents ? 'evenements' : day}-${filter}.csv`, toCsv(collected));
      showSuccessToast(
        next
          ? t('runPage.exportCapped', { count: formatNumber(collected.length) })
          : t('runPage.exportDone', { count: formatNumber(collected.length) })
      );
    } catch (error) {
      showErrorToast((error as Error).message, t('runPage.exportFailed'));
    } finally {
      setExported(null);
    }
  };

  return (
    <>
      <PageMeta title={title ?? t('nav.campaigns')} />
      <DashboardLayout
        headerStartItems={
          <CrmBreadcrumbHeader
            parentLabel={campaign?.name ?? t('nav.campaigns')}
            parentTo={campaignHref}
            current={title}
            icon={RiMegaphoneLine}
            isLoading={isLoadingCampaign || (isLoading && !isEvents)}
          />
        }
      >
        <div className="flex h-full flex-col">
          <CrmTitleBar
            isLoading={isLoading && !data}
            title={title}
            badge={
              run && (
                <Badge variant="lighter" color={RUN_STATUS[run.status].color} size="md">
                  {RUN_STATUS[run.status].label}
                </Badge>
              )
            }
            description={
              isEvents
                ? t('runPage.eventsDescription', { days: String(data?.onEvent?.days ?? 30) })
                : campaign?.name
            }
            actions={
              <Button
                variant="secondary"
                mode="outline"
                size="xs"
                leadingIcon={RiDownload2Line}
                isLoading={exported !== null}
                disabled={!rows.length}
                onClick={exportCsv}
              >
                {exported !== null ? t('runPage.exporting', { count: formatNumber(exported) }) : t('runPage.export')}
              </Button>
            }
          />

          <div className="flex-1 overflow-auto">
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 pb-8 pt-4 md:px-6">
              {isError && <InlineToast variant="error" description={t('runPage.loadFailed')} />}
              {run && run.status !== 'triggered' && (
                <InlineToast
                  variant={run.status === 'failed' ? 'error' : 'tip'}
                  description={run.error ?? t('runPage.notTriggered')}
                />
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <CrmChartCard title={t('funnel.title')} aside={t('funnel.caption')}>
                  <CrmFunnel
                    isLoading={isLoading && !data}
                    values={{
                      audience: run?.audienceSize ?? counts.all,
                      sent: totals.sent,
                      opened: totals.opened,
                      clicked: totals.clicked,
                      excluded: run?.excludedCount,
                      errors: totals.errors,
                      skipped: totals.skipped,
                    }}
                  />
                </CrmChartCard>
                <CrmChartCard title={t('runPage.channels')}>
                  <ul className="flex flex-col gap-3">
                    {stats.length === 0 && <li className="text-text-soft text-paragraph-sm">—</li>}
                    {stats.map((row) => (
                      <li key={row.channel} className="flex items-baseline justify-between gap-3">
                        <span className="text-text-sub text-label-sm">{channelLabel(row.channel)}</span>
                        <span className="text-text-strong text-label-md font-medium tabular-nums">
                          {formatNumber(row.sent)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CrmChartCard>
              </div>

              <CrmSection title={t('runPage.recipients')} description={t('runPage.recipientsHint')}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SegmentedControl value={filter} onValueChange={(value) => setFilter(value as CrmRecipientFilter)}>
                    <div className="max-w-full overflow-x-auto">
                      <SegmentedControlList className="w-auto">
                        {FILTERS.map((key) => (
                          <SegmentedControlTrigger key={key} value={key} className="px-2.5">
                            {t(FILTER_LABEL[key])}
                            <span className="text-text-soft text-paragraph-xs tabular-nums">
                              {formatNumber(counts[key])}
                            </span>
                          </SegmentedControlTrigger>
                        ))}
                      </SegmentedControlList>
                    </div>
                  </SegmentedControl>
                  <div className="w-full sm:w-[260px]">
                    <Input
                      size="xs"
                      type="search"
                      value={searchInput}
                      placeholder={t('runPage.search')}
                      aria-label={t('runPage.search')}
                      onChange={(event) => setSearchInput(event.target.value)}
                    />
                  </div>
                </div>

                <div className={cn('transition-opacity', isFetching && !isLoading && 'opacity-60')}>
                  <Table isLoading={isLoading && !data} loadingRowsCount={6}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('runPage.col.client')}</TableHead>
                        <TableHead>{t('runPage.col.channel')}</TableHead>
                        <TableHead>{t('runPage.col.status')}</TableHead>
                        <TableHead>{t('runPage.col.sentAt')}</TableHead>
                        <TableHead>{t('runPage.col.openedAt')}</TableHead>
                        <TableHead>{t('runPage.col.clickedAt')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => {
                        const name = clientName(row);
                        const status = STATUS_STYLE[row.status] ?? STATUS_STYLE.warning;

                        return (
                          <TableRow key={row.messageId}>
                            <TableCell className="max-w-[280px]">
                              <div className="flex min-w-0 flex-col">
                                <span className="text-text-strong truncate font-medium">
                                  {name || row.subscriberId || t('runPage.deletedClient')}
                                </span>
                                <span className="text-text-soft text-paragraph-xs truncate">
                                  {[name ? row.subscriberId : undefined, row.email].filter(Boolean).join(' · ') || '—'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-text-sub">{channelLabel(row.channel)}</TableCell>
                            <TableCell className="max-w-[280px]">
                              <span className="text-text-sub inline-flex items-center gap-1.5">
                                <span className={cn('size-1.5 shrink-0 rounded-full', status.dot)} aria-hidden />
                                {status.label()}
                              </span>
                              {row.errorText && (
                                <p className="text-error-base text-paragraph-xs mt-0.5 line-clamp-2">{row.errorText}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-text-sub font-code text-code-xs whitespace-nowrap">
                              {formatDateTime(row.createdAt)}
                            </TableCell>
                            <TableCell className="text-text-sub font-code text-code-xs whitespace-nowrap">
                              {openedLabel(row)}
                            </TableCell>
                            <TableCell className="text-text-sub font-code text-code-xs whitespace-nowrap">
                              {formatDateTime(row.clickedAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!isLoading && rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-text-soft text-paragraph-sm py-10 text-center">
                            {search ? t('runPage.emptySearch') : t('runPage.empty')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {(cursors.length > 1 || data?.nextCursor) && (
                    <TablePaginationFooter
                      pageSize={pageSize}
                      pageSizeOptions={PAGE_SIZES}
                      currentPageItemsCount={rows.length}
                      hasPreviousPage={cursors.length > 1}
                      hasNextPage={!!data?.nextCursor}
                      onPreviousPage={() => setCursors((stack) => stack.slice(0, -1))}
                      onNextPage={() => data?.nextCursor && setCursors((stack) => [...stack, data.nextCursor ?? undefined])}
                      onPageSizeChange={setPageSize}
                      totalCount={search ? undefined : counts[filter]}
                    />
                  )}
                </div>
              </CrmSection>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </>
  );
}
