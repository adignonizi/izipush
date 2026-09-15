import { useMemo, useState } from 'react';
import { RiBarChartBoxLine } from 'react-icons/ri';
import { formatNumber, t, tp } from '@/components/crm/crm-i18n';
import { SCHEDULE_MODE_LABELS } from '@/components/crm/crm-labels';
import { CrmBlankState, CrmLinkedCell, CrmRowTitle, CrmSection, CrmStat } from '@/components/crm/crm-page';
import { channelLabel, rate, totalStats } from '@/components/crm/crm-stats';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import {
  SegmentedControl,
  SegmentedControlList,
  SegmentedControlTrigger,
} from '@/components/primitives/segmented-control';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmReportOverview } from '@/hooks/use-crm-reports';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — rapport client : ce que les campagnes ont envoyé et ce qu'elles ont produit, sur une période.

const PERIODS = ['7', '30', '90'];

export function CrmReportsPage() {
  const { currentEnvironment } = useEnvironment();
  const [days, setDays] = useState('30');
  const { data, isLoading } = useCrmReportOverview(Number(days));
  const rows = data?.rows ?? [];

  const { total, byChannel, runs, audience } = useMemo(() => {
    const all = rows.flatMap((row) => row.stats);
    const channels = new Map<string, ReturnType<typeof totalStats>>();
    for (const stats of all) {
      const current = channels.get(stats.channel) ?? totalStats([]);
      channels.set(stats.channel, totalStats([{ ...current, channel: stats.channel }, stats]));
    }

    return {
      total: totalStats(all),
      byChannel: [...channels.entries()],
      runs: rows.reduce((sum, row) => sum + row.runs, 0),
      audience: rows.reduce((sum, row) => sum + row.audience, 0),
    };
  }, [rows]);

  const detailHref = (campaignId: string) =>
    buildRoute(ROUTES.CRM_CAMPAIGN_DETAIL, { environmentSlug: currentEnvironment?.slug ?? '', campaignId });

  return (
    <>
      <PageMeta title={t('nav.reports')} />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">{t('nav.reports')}</h1>}>
        <div className="flex flex-col gap-8 px-4 pb-8 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <p className="text-text-soft text-paragraph-sm max-w-[75ch]">{t('reports.description')}</p>
            <SegmentedControl value={days} onValueChange={setDays}>
              <SegmentedControlList
                className="bg-bg-muted rounded-[5px] p-1"
                floatingBgClassName="rounded-[1px]"
                aria-label={t('reports.period.label')}
              >
                {PERIODS.map((period) => (
                  <SegmentedControlTrigger key={period} value={period} className="text-label-xs px-3">
                    {t('reports.period', { days: period })}
                  </SegmentedControlTrigger>
                ))}
              </SegmentedControlList>
            </SegmentedControl>
          </div>

          {!isLoading && rows.length === 0 ? (
            <CrmBlankState
              icon={RiBarChartBoxLine}
              title={t('reports.blank.title')}
              description={t('reports.blank.text')}
            />
          ) : (
            <>
              <div className="border-stroke-soft flex flex-wrap gap-6 rounded-lg border p-4">
                <CrmStat
                  label={t('reports.kpi.campaigns')}
                  value={formatNumber(rows.length)}
                  hint={tp('runs', runs)}
                  isLoading={isLoading}
                />
                <CrmStat
                  label={t('reports.kpi.audience')}
                  value={formatNumber(audience)}
                  hint={t('reports.kpi.audienceHint')}
                  isLoading={isLoading}
                />
                <CrmStat
                  label={t('reports.kpi.sent')}
                  value={formatNumber(total.sent)}
                  hint={tp('errors', total.errors)}
                  isLoading={isLoading}
                />
                <CrmStat
                  label={t('stat.openRate')}
                  value={rate(total.opened, total.sent)}
                  hint={formatNumber(total.opened)}
                  help={t('stat.openHint')}
                  isLoading={isLoading}
                />
                <CrmStat
                  label={t('stat.clickRate')}
                  value={rate(total.clicked, total.sent)}
                  hint={formatNumber(total.clicked)}
                  isLoading={isLoading}
                />
              </div>

              {byChannel.length > 0 && (
                <CrmSection title={t('reports.byChannel')}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('reports.col.channel')}</TableHead>
                        <TableHead className="text-right">{t('stat.sent')}</TableHead>
                        <TableHead className="text-right">{t('stat.errors')}</TableHead>
                        <TableHead className="text-right">{t('stat.skipped')}</TableHead>
                        <TableHead className="text-right">{t('stat.openRate')}</TableHead>
                        <TableHead className="text-right">{t('stat.clickRate')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byChannel.map(([channel, stats]) => (
                        <TableRow key={channel}>
                          <TableCell className="text-text-strong font-medium">{channelLabel(channel)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(stats.sent)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(stats.errors)}{' '}
                            <span className="text-text-soft text-paragraph-xs">
                              {rate(stats.errors, stats.sent + stats.errors)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(stats.skipped)}</TableCell>
                          <TableCell className="text-right tabular-nums">{rate(stats.opened, stats.sent)}</TableCell>
                          <TableCell className="text-right tabular-nums">{rate(stats.clicked, stats.sent)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CrmSection>
              )}

              <CrmSection title={t('reports.byCampaign')}>
                <Table isLoading={isLoading} loadingRowsCount={4}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('campaigns.col.name')}</TableHead>
                      <TableHead>{t('reports.col.type')}</TableHead>
                      <TableHead className="text-right">{t('reports.col.runs')}</TableHead>
                      <TableHead className="text-right">{t('stat.audience')}</TableHead>
                      <TableHead className="text-right">{t('stat.sent')}</TableHead>
                      <TableHead className="text-right">{t('stat.errors')}</TableHead>
                      <TableHead className="text-right">{t('stat.openRate')}</TableHead>
                      <TableHead className="text-right">{t('stat.clickRate')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const stats = totalStats(row.stats);
                      const href = detailHref(row.campaignId);

                      return (
                        <TableRow key={row.campaignId} className="group relative isolate cursor-pointer">
                          <CrmLinkedCell to={href}>
                            <CrmRowTitle to={href} title={row.name} />
                          </CrmLinkedCell>
                          <CrmLinkedCell to={href} className="text-paragraph-sm">
                            {SCHEDULE_MODE_LABELS[row.mode]}
                          </CrmLinkedCell>
                          <CrmLinkedCell to={href} className="text-right tabular-nums">
                            {formatNumber(row.runs)}
                          </CrmLinkedCell>
                          <CrmLinkedCell to={href} className="text-right tabular-nums">
                            {formatNumber(row.audience)}
                          </CrmLinkedCell>
                          <CrmLinkedCell to={href} className="text-right tabular-nums">
                            {formatNumber(stats.sent)}
                          </CrmLinkedCell>
                          <CrmLinkedCell to={href} className="text-right tabular-nums">
                            {formatNumber(stats.errors)}
                          </CrmLinkedCell>
                          <CrmLinkedCell to={href} className="text-right tabular-nums">
                            {rate(stats.opened, stats.sent)}
                          </CrmLinkedCell>
                          <CrmLinkedCell to={href} className="text-right tabular-nums">
                            {rate(stats.clicked, stats.sent)}
                          </CrmLinkedCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {data?.truncated && <p className="text-text-soft text-paragraph-xs">{t('reports.truncated')}</p>}
              </CrmSection>
            </>
          )}
        </div>
      </DashboardLayout>
    </>
  );
}
