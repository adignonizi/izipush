import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { CrmIngestDaily, CrmQueueCounts, CrmServiceStatus } from '@/api/crm-monitoring';
import { formatDateTime, formatNumber, t } from '@/components/crm/crm-i18n';
import { eventLabel } from '@/components/crm/crm-labels';
import { CrmSection, CrmStat } from '@/components/crm/crm-page';
import { EmailSendingPanel } from '@/components/crm/email-sending-panel';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/primitives/chart';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { Skeleton } from '@/components/primitives/skeleton';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/tabs';
import { useCrmIngestion, useReplayCrmDeadLetters } from '@/hooks/use-crm-monitoring';

// izipush-crm — Suivi : réception des événements d'Izichange, et envois email des campagnes.

const DAYS = 14;

const chartConfig = {
  accepted: { label: t('outcome.accepted'), color: '#1fc16b' },
  duplicate: { label: t('outcome.duplicate'), color: '#99a0ae' },
  invalid: { label: t('outcome.invalid'), color: '#fb3748' },
  ignored: { label: t('outcome.ignored'), color: '#f6b51e' },
} satisfies ChartConfig;

type Outcome = keyof typeof chartConfig;
const OUTCOMES = Object.keys(chartConfig) as Outcome[];

const COMMAND_STATUS = {
  pending: { label: t('command.status.pending'), color: 'orange' },
  running: { label: t('command.status.running'), color: 'blue' },
  done: { label: t('command.status.done'), color: 'green' },
  failed: { label: t('command.status.failed'), color: 'red' },
} as const;

function queueLabel(counts?: CrmQueueCounts) {
  if (!counts) return '—';

  return t('monitoring.queue', {
    waiting: formatNumber(counts.waiting),
    active: formatNumber(counts.active),
    failed: formatNumber(counts.failed),
  });
}

function ServiceStatus({ status, isLoading }: { status: CrmServiceStatus | null; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!status) return <p className="text-text-sub text-paragraph-sm">{t('monitoring.service.never')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="lighter" color={status.stale ? 'red' : 'green'} size="md">
          {status.stale ? t('monitoring.service.stale') : t('monitoring.service.online')}
        </Badge>
        <Badge variant="lighter" color={status.rabbit.connected ? 'green' : 'red'} size="md">
          {status.rabbit.connected ? t('monitoring.rabbit.connected') : t('monitoring.rabbit.disconnected')}
        </Badge>
        <span className="text-text-soft text-paragraph-xs">
          {t('monitoring.service.meta', {
            date: formatDateTime(status.updatedAt),
            started: formatDateTime(status.startedAt),
            version: status.version ?? '?',
          })}
        </span>
      </div>
      <div className="border-stroke-soft flex flex-wrap gap-6 rounded-lg border p-4">
        <CrmStat label={t('monitoring.stat.waiting')} value={formatNumber(status.rabbit.messages)} />
        <CrmStat
          label={t('monitoring.stat.rejected')}
          value={formatNumber(status.rabbit.deadLetters)}
          hint={t('monitoring.stat.rejectedHint')}
        />
        <CrmStat
          label={t('monitoring.stat.lastEvent')}
          value={<span className="text-label-md">{formatDateTime(status.lastMessageAt)}</span>}
        />
        <CrmStat
          label={t('monitoring.stat.profiles')}
          value={<span className="text-label-md">{queueLabel(status.queues.derive)}</span>}
        />
        <CrmStat
          label={t('monitoring.stat.campaigns')}
          value={<span className="text-label-md">{queueLabel(status.queues.campaigns)}</span>}
        />
      </div>
    </div>
  );
}

function IngestionChart({ daily, from }: { daily: CrmIngestDaily[]; from: string }) {
  const { data, byEvent } = useMemo(() => {
    const days = new Map<string, Record<Outcome, number> & { day: string }>();
    const start = new Date(`${from}T00:00:00Z`).getTime();
    for (let offset = 0; offset < DAYS; offset++) {
      const day = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      days.set(day, { day, accepted: 0, duplicate: 0, invalid: 0, ignored: 0 });
    }

    const events = new Map<string, Record<Outcome, number>>();
    for (const row of daily) {
      const point = days.get(row.day);
      const total = events.get(row.eventName) ?? { accepted: 0, duplicate: 0, invalid: 0, ignored: 0 };
      for (const outcome of OUTCOMES) {
        if (point) point[outcome] += row[outcome] ?? 0;
        total[outcome] += row[outcome] ?? 0;
      }
      events.set(row.eventName, total);
    }

    return { data: [...days.values()], byEvent: [...events.entries()].sort((a, b) => b[1].accepted - a[1].accepted) };
  }, [daily, from]);

  if (byEvent.length === 0)
    return <p className="text-text-soft text-paragraph-sm py-6">{t('monitoring.events.empty')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(day: string) => day.slice(5)} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {OUTCOMES.map((outcome) => (
            <Bar key={outcome} dataKey={outcome} stackId="events" fill={`var(--color-${outcome})`} />
          ))}
        </BarChart>
      </ChartContainer>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('monitoring.col.event')}</TableHead>
            {OUTCOMES.map((outcome) => (
              <TableHead key={outcome} className="text-right">
                {chartConfig[outcome].label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {byEvent.map(([eventName, total]) => (
            <TableRow key={eventName}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-text-strong font-medium">{eventLabel(eventName)}</span>
                  <span className="text-text-soft font-code text-code-xs">{eventName}</span>
                </div>
              </TableCell>
              {OUTCOMES.map((outcome) => (
                <TableCell key={outcome} className="text-right tabular-nums">
                  {formatNumber(total[outcome])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function IngestionTab() {
  const { data, isLoading } = useCrmIngestion(DAYS);
  const replay = useReplayCrmDeadLetters();
  const [limit, setLimit] = useState('100');
  const deadLetters = data?.deadLetters ?? [];

  const requestReplay = async () => {
    try {
      await replay.mutateAsync(Number(limit) || 100);
      showSuccessToast(t('monitoring.replay.toast'));
    } catch (error) {
      showErrorToast((error as Error).message, t('monitoring.replay.failed'));
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <CrmSection title={t('monitoring.service.title')}>
        <ServiceStatus status={data?.status ?? null} isLoading={isLoading} />
      </CrmSection>

      <CrmSection title={t('monitoring.events.title')}>
        <IngestionChart daily={data?.daily ?? []} from={data?.from ?? new Date().toISOString().slice(0, 10)} />
      </CrmSection>

      <CrmSection title={t('monitoring.rejected.title')} description={t('monitoring.rejected.text')}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="replay-count" className="text-label-xs text-text-sub">
              {t('monitoring.rejected.count')}
            </Label>
            <div className="w-24">
              <Input
                id="replay-count"
                size="xs"
                inputMode="numeric"
                value={limit}
                onChange={(event) => setLimit(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            mode="outline"
            size="xs"
            isLoading={replay.isPending}
            disabled={deadLetters.length === 0}
            onClick={requestReplay}
          >
            {t('monitoring.rejected.replay')}
          </Button>
        </div>

        <Table isLoading={isLoading} loadingRowsCount={3}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('monitoring.col.received')}</TableHead>
              <TableHead>{t('monitoring.col.event')}</TableHead>
              <TableHead>{t('monitoring.col.reason')}</TableHead>
              <TableHead>{t('monitoring.col.content')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deadLetters.map((deadLetter) => (
              <TableRow key={deadLetter._id}>
                <TableCell className="font-code text-code-xs text-text-sub whitespace-nowrap">
                  {formatDateTime(deadLetter.at)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-text-strong">
                      {eventLabel(deadLetter.eventType ?? deadLetter.routingKey)}
                    </span>
                    {deadLetter.eventId && (
                      <span className="text-text-soft font-code text-code-xs">{deadLetter.eventId}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-paragraph-sm max-w-[260px]">{deadLetter.reason}</TableCell>
                <TableCell>
                  <code className="text-text-sub font-code block max-h-20 max-w-[420px] overflow-auto whitespace-pre-wrap break-all text-xs">
                    {deadLetter.preview}
                  </code>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && deadLetters.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-text-soft text-paragraph-sm py-8 text-center">
                  {t('monitoring.rejected.empty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {(data?.commands ?? []).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-text-sub text-label-sm">{t('monitoring.commands.title')}</h3>
            {data?.commands.map((command) => (
              <div key={command._id} className="text-text-sub text-paragraph-xs flex flex-wrap items-center gap-2">
                <Badge variant="lighter" color={COMMAND_STATUS[command.status].color} size="sm">
                  {COMMAND_STATUS[command.status].label}
                </Badge>
                <span>
                  {t('monitoring.command.line', { date: formatDateTime(command.requestedAt), limit: command.limit })}
                  {command.result ? ` : ${command.result}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </CrmSection>
    </div>
  );
}

export function CrmMonitoringPage() {
  return (
    <>
      <PageMeta title={t('monitoring.title')} />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">{t('monitoring.title')}</h1>}>
        <Tabs defaultValue="ingestion" className="w-full">
          <TabsList align="start" variant="regular" className="border-t-transparent px-4 py-0! md:px-6">
            <TabsTrigger variant="regular" value="ingestion" size="xl">
              {t('monitoring.tab.ingestion')}
            </TabsTrigger>
            <TabsTrigger variant="regular" value="email" size="xl">
              {t('monitoring.tab.email')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="ingestion" className="px-4 pb-8 pt-6 outline-none md:px-6">
            <IngestionTab />
          </TabsContent>
          <TabsContent value="email" className="px-4 pb-8 pt-6 outline-none md:px-6">
            <EmailSendingPanel />
          </TabsContent>
        </Tabs>
      </DashboardLayout>
    </>
  );
}
