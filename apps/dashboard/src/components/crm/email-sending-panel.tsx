import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { CrmEmailProvider, CrmProviderUsage } from '@/api/crm-email-providers';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/primitives/chart';
import { HelpTooltipIndicator } from '@/components/primitives/help-tooltip-indicator';
import { InlineToast } from '@/components/primitives/inline-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useCrmEmailProviders, useCrmEmailUsage } from '@/hooks/use-crm-email-providers';
import { buildRoute, ROUTES } from '@/utils/routes';
import { formatNumber, t } from './crm-i18n';
import { CrmSection } from './crm-page';
import { rate } from './crm-stats';

// izipush-crm — onglet « Envois email » du Suivi : fournisseurs des campagnes, compteurs en cours, 14 derniers jours.

const USAGE_DAYS = 14;
const ROUTING_USAGE_ID = 'routing';

const chartConfig = {
  sent: { label: t('email.usage.sent'), color: '#1fc16b' },
  failed: { label: t('email.usage.failed'), color: '#fb3748' },
  bounced: { label: t('email.usage.bounced'), color: '#f6b51e' },
  complaints: { label: t('email.usage.complaints'), color: '#7d52f4' },
} satisfies ChartConfig;

type Counter = keyof typeof chartConfig;
const COUNTERS = Object.keys(chartConfig) as Counter[];

function usageLabel(value: number, limit: number | null) {
  return limit ? `${formatNumber(value)} / ${formatNumber(limit)}` : formatNumber(value);
}

function ProvidersTable({ providers, isLoading }: { providers: CrmEmailProvider[]; isLoading: boolean }) {
  const routed = providers.filter((provider) => provider.routingEnabled).sort((a, b) => a.order - b.order);

  if (!isLoading && routed.length === 0) return <InlineToast variant="tip" description={t('email.providers.empty')} />;

  return (
    <Table isLoading={isLoading} loadingRowsCount={2}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('email.col.priority')}</TableHead>
          <TableHead>{t('email.col.provider')}</TableHead>
          <TableHead className="text-right">{t('email.col.minute')}</TableHead>
          <TableHead className="text-right">{t('email.col.hour')}</TableHead>
          <TableHead className="text-right">{t('email.col.day')}</TableHead>
          <TableHead className="w-1">
            <span className="sr-only">{t('common.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routed.map((provider) => (
          <TableRow key={provider.integrationId}>
            <TableCell className="font-code text-code-xs text-text-sub">{provider.order}</TableCell>
            <TableCell>
              <div className="flex flex-col">
                <span className="text-text-strong font-medium">{provider.name}</span>
                <span className="text-text-soft font-code text-code-xs">{provider.providerId}</span>
              </div>
            </TableCell>
            {(['minute', 'hour', 'day'] as const).map((window) => {
              const limit =
                window === 'minute' ? provider.perMinute : window === 'hour' ? provider.perHour : provider.perDay;

              return (
                <TableCell key={window} className="text-text-sub text-right tabular-nums">
                  {provider.current ? usageLabel(provider.current[window], limit) : '—'}
                </TableCell>
              );
            })}
            <TableCell className="w-1 whitespace-nowrap">
              <Link
                to={buildRoute(ROUTES.INTEGRATIONS_UPDATE, { integrationId: provider.integrationId })}
                className="text-text-sub text-label-xs hover:text-text-strong underline-offset-2 hover:underline"
              >
                {t('email.providers.configure')}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function UsageOverview({
  rows,
  from,
  providers,
}: {
  rows: CrmProviderUsage[];
  from?: string;
  providers: CrmEmailProvider[];
}) {
  const { data, totals } = useMemo(() => {
    const byDay = new Map<string, Record<Counter, number> & { day: string }>();
    const start = from ? new Date(`${from}T00:00:00Z`).getTime() : Date.now();
    for (let offset = 0; offset < USAGE_DAYS; offset++) {
      const day = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      byDay.set(day, { day, sent: 0, failed: 0, bounced: 0, complaints: 0 });
    }

    const perProvider = new Map<string, Record<Counter | 'postponed', number>>();
    for (const row of rows) {
      const point = byDay.get(row.day);
      const total = perProvider.get(row._integrationId) ?? {
        sent: 0,
        failed: 0,
        bounced: 0,
        complaints: 0,
        postponed: 0,
      };
      for (const counter of COUNTERS) {
        if (point) point[counter] += row[counter];
        total[counter] += row[counter];
      }
      total.postponed += row.postponed;
      perProvider.set(row._integrationId, total);
    }

    return { data: [...byDay.values()], totals: [...perProvider.entries()] };
  }, [rows, from]);

  const nameOf = (integrationId: string) =>
    integrationId === ROUTING_USAGE_ID
      ? t('email.usage.routing')
      : (providers.find((provider) => provider.integrationId === integrationId)?.name ?? integrationId);

  if (totals.length === 0) {
    return <p className="text-text-soft text-paragraph-sm py-6">{t('email.usage.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(day: string) => day.slice(5)} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {COUNTERS.map((counter) => (
            <Bar key={counter} dataKey={counter} stackId="usage" fill={`var(--color-${counter})`} />
          ))}
        </BarChart>
      </ChartContainer>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('email.col.provider')}</TableHead>
            <TableHead className="text-right">{t('email.usage.sent')}</TableHead>
            <TableHead className="text-right">{t('email.usage.failed')}</TableHead>
            <TableHead className="text-right">{t('email.usage.bounced')}</TableHead>
            <TableHead className="text-right">{t('email.usage.complaints')}</TableHead>
            <TableHead className="text-right">
              <span className="inline-flex items-center gap-1">
                {t('email.usage.postponed')}
                <HelpTooltipIndicator text={t('email.usage.postponedHint')} size="3" />
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map(([integrationId, total]) => (
            <TableRow key={integrationId}>
              <TableCell className="text-text-strong font-medium">{nameOf(integrationId)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(total.sent)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(total.failed)}{' '}
                <span className="text-text-soft text-paragraph-xs">
                  {rate(total.failed, total.sent + total.failed)}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(total.bounced)}{' '}
                <span className="text-text-soft text-paragraph-xs">{rate(total.bounced, total.sent)}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(total.complaints)}{' '}
                <span className="text-text-soft text-paragraph-xs">{rate(total.complaints, total.sent)}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(total.postponed)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EmailSendingPanel() {
  const { data: providers = [], isLoading } = useCrmEmailProviders();
  const { data: usage } = useCrmEmailUsage(USAGE_DAYS);

  return (
    <div className="flex flex-col gap-10">
      <CrmSection title={t('email.providers.title')} description={t('email.providers.text')}>
        <ProvidersTable providers={providers} isLoading={isLoading} />
      </CrmSection>
      <CrmSection title={t('email.usage.title')}>
        <UsageOverview rows={usage?.rows ?? []} from={usage?.from} providers={providers} />
      </CrmSection>
    </div>
  );
}
