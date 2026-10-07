import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { CrmRunReport } from '@/api/crm-reports';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/primitives/chart';
import { Skeleton } from '@/components/primitives/skeleton';
import { crmLocale, formatDateTime, formatNumber, t } from './crm-i18n';
import { rate, totalStats } from './crm-stats';

// izipush-crm — graphiques des résultats d'une campagne : le parcours des messages (visés → cliqués)
// et l'évolution d'une exécution à l'autre. Une seule teinte, de la plus claire à la plus soutenue.

const STEP_COLORS = ['#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1'];
const SENT_COLOR = '#a5b4fc';
const RATE_COLOR = '#4f46e5';
const TREND_MAX_RUNS = 20;

export type CrmFunnelValues = {
  audience: number;
  sent: number;
  opened: number;
  clicked: number;
  excluded?: number;
  errors: number;
  skipped: number;
};

/** Cadre commun des graphiques : titre à gauche, précision à droite. */
export function CrmChartCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-stroke-soft flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-text-strong text-label-sm font-medium">{title}</h3>
        {aside && <span className="text-text-soft text-paragraph-xs">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function FunnelNote({ label, value, tone }: { label: string; value?: number; tone?: 'error' }) {
  if (!value) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={tone === 'error' ? 'bg-error-base size-1.5 rounded-full' : 'bg-text-soft size-1.5 rounded-full'}
        aria-hidden
      />
      {label} <span className="text-text-sub font-medium tabular-nums">{formatNumber(value)}</span>
    </span>
  );
}

/** Visés → envoyés → ouverts → cliqués ; chaque pourcentage se rapporte à l'étape précédente. */
export function CrmFunnel({ values, isLoading }: { values: CrmFunnelValues; isLoading?: boolean }) {
  const steps = [
    { key: 'targeted', label: t('funnel.targeted'), value: values.audience },
    { key: 'sent', label: t('funnel.sent'), value: values.sent },
    { key: 'opened', label: t('funnel.opened'), value: values.opened },
    { key: 'clicked', label: t('funnel.clicked'), value: values.clicked },
  ];
  const base = Math.max(values.audience, values.sent, 1);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => {
          const previous = index > 0 ? steps[index - 1] : undefined;
          const share = step.value > 0 ? Math.max(step.value / base, 0.012) : 0;

          return (
            <li key={step.key} className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3">
              <span className="text-text-sub text-label-xs font-medium">{step.label}</span>
              <div className="bg-bg-weak relative h-7 overflow-hidden rounded-md" aria-hidden>
                {isLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <div
                    className="absolute inset-y-0 left-0 w-full origin-left rounded-md transition-transform duration-500 ease-out motion-reduce:transition-none"
                    style={{ transform: `scaleX(${share})`, backgroundColor: STEP_COLORS[index] }}
                  />
                )}
              </div>
              <span className="flex min-w-[104px] items-baseline justify-end gap-2 tabular-nums">
                <span className="text-text-strong text-label-md font-medium">
                  {isLoading ? '…' : formatNumber(step.value)}
                </span>
                <span
                  className="text-text-soft text-paragraph-xs w-12 text-right"
                  title={previous ? t('funnel.ofPrevious', { step: previous.label.toLowerCase() }) : undefined}
                >
                  {previous && !isLoading ? rate(step.value, previous.value) : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {!isLoading && (values.excluded || values.errors || values.skipped) ? (
        <p className="text-text-soft text-paragraph-xs flex flex-wrap gap-x-5 gap-y-1">
          <FunnelNote label={t('funnel.excluded')} value={values.excluded} />
          <FunnelNote label={t('stat.errors')} value={values.errors} tone="error" />
          <FunnelNote label={t('funnel.skipped')} value={values.skipped} />
        </p>
      ) : null}
    </div>
  );
}

type TrendPoint = { label: string; date: string; sent: number; openRate: number };

const trendConfig = {
  sent: { label: t('stat.sent'), color: SENT_COLOR },
  openRate: { label: t('stat.openRate'), color: RATE_COLOR },
} satisfies ChartConfig;

function shortDate(value?: string | Date): string {
  if (!value) return '';

  return new Date(value).toLocaleDateString(crmLocale, { day: 'numeric', month: 'short' });
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: TrendPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  const rows = [
    { key: 'sent', label: t('stat.sent'), value: formatNumber(point.sent), color: SENT_COLOR },
    {
      key: 'rate',
      label: t('stat.openRate'),
      value: `${point.openRate.toLocaleString(crmLocale)} %`,
      color: RATE_COLOR,
    },
  ];

  return (
    <div className="border-border/40 bg-bg-white shadow-popover min-w-[180px] overflow-hidden rounded-xl border text-[12px]">
      <p className="bg-bg-weak text-text-soft truncate px-2.5 py-1.5 font-medium">{point.date}</p>
      <div className="border-border/30 flex flex-col gap-1 border-t px-2.5 py-1.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <span className="text-text-sub flex items-center gap-1.5 font-medium">
              <span className="h-2 w-1 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
              {row.label}
            </span>
            <span className="text-text-sub font-mono text-[11px] tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={line ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-[3px]'}
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

/** Envoyés (barres) et taux d'ouverture (courbe) des dernières exécutions, de la plus ancienne à la plus récente. */
export function CrmRunsTrend({ runs, isLoading }: { runs: CrmRunReport[]; isLoading?: boolean }) {
  const data = useMemo<TrendPoint[]>(
    () =>
      runs
        .filter((run) => run.status === 'triggered')
        .slice(0, TREND_MAX_RUNS)
        .reverse()
        .map((run) => {
          const total = totalStats(run.stats);

          return {
            label: shortDate(run.scheduledFor),
            date: formatDateTime(run.scheduledFor),
            sent: total.sent,
            openRate: total.sent ? Math.round((total.opened / total.sent) * 1000) / 10 : 0,
          };
        }),
    [runs]
  );

  if (isLoading) return <Skeleton className="h-[200px] w-full" />;

  if (data.length < 2) {
    return (
      <div className="bg-bg-weak text-text-soft text-paragraph-sm flex h-[200px] items-center justify-center rounded-md px-6 text-center">
        {t('trend.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-text-soft text-paragraph-xs flex gap-4">
        <LegendItem color={SENT_COLOR} label={t('stat.sent')} />
        <LegendItem color={RATE_COLOR} label={t('stat.openRate')} line />
      </p>
      {/* Les mêmes chiffres figurent dans le tableau des exécutions : le graphique n'est pas lu par les lecteurs d'écran. */}
      <div aria-hidden>
        <ChartContainer config={trendConfig} className="aspect-auto h-[200px] w-full">
          <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="count"
              axisLine={false}
              tickLine={false}
              width={40}
              tick={{ fontSize: 10 }}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="rate"
              orientation="right"
              axisLine={false}
              tickLine={false}
              width={40}
              tick={{ fontSize: 10 }}
              domain={[0, 100]}
              tickFormatter={(value: number) => `${value} %`}
            />
            <ChartTooltip cursor={{ fill: '#f9fafb' }} content={<TrendTooltip />} />
            <Bar yAxisId="count" dataKey="sent" fill={SENT_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="openRate"
              stroke={RATE_COLOR}
              strokeWidth={2}
              dot={{ r: 2.5, fill: RATE_COLOR }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
    </div>
  );
}
