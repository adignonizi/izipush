import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { CrmIngestDaily, CrmQueueCounts, CrmServiceStatus } from '@/api/crm-monitoring';
import { formatDate } from '@/components/crm/crm-labels';
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
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useCrmIngestion, useReplayCrmDeadLetters } from '@/hooks/use-crm-monitoring';

// izipush-crm — suivi de l'ingestion des événements Izichange : état de crm-ingest, volumes, file d'erreurs.

const DAYS = 14;

const chartConfig = {
  accepted: { label: 'Acceptés', color: '#22c55e' },
  duplicate: { label: 'Doublons', color: '#94a3b8' },
  invalid: { label: 'Rejetés', color: '#ef4444' },
  ignored: { label: 'Ignorés', color: '#f59e0b' },
} satisfies ChartConfig;

type Outcome = keyof typeof chartConfig;
const OUTCOMES = Object.keys(chartConfig) as Outcome[];

const COMMAND_STATUS = {
  pending: { label: 'En attente', color: 'orange' },
  running: { label: 'En cours', color: 'blue' },
  done: { label: 'Terminé', color: 'green' },
  failed: { label: 'Échec', color: 'red' },
} as const;

const number = (value?: number) => (value ?? 0).toLocaleString('fr-FR');

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="border-stroke-soft flex min-w-[140px] flex-1 flex-col gap-1 rounded-lg border p-3">
      <span className="text-foreground-500 text-xs">{label}</span>
      <span className="text-foreground-950 text-lg font-medium">{value}</span>
      {hint && <span className="text-foreground-500 text-xs">{hint}</span>}
    </div>
  );
}

function queueLabel(counts?: CrmQueueCounts) {
  if (!counts) return '—';

  return `${number(counts.waiting)} en attente · ${number(counts.active)} en cours · ${number(counts.failed)} en échec`;
}

function ServiceStatus({ status }: { status: CrmServiceStatus | null }) {
  if (!status) {
    return (
      <p className="text-foreground-600 text-sm">
        crm-ingest n'a encore jamais signalé son état. Vérifie qu'il tourne et qu'il est à jour.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="lighter" color={status.stale ? 'red' : 'green'} size="md">
          {status.stale ? 'Sans nouvelles' : 'En ligne'}
        </Badge>
        <Badge variant="lighter" color={status.rabbit.connected ? 'green' : 'red'} size="md">
          RabbitMQ {status.rabbit.connected ? 'connecté' : 'déconnecté'}
        </Badge>
        <span className="text-foreground-500 text-xs">
          Dernier signal {formatDate(status.updatedAt)} · démarré {formatDate(status.startedAt)} · v
          {status.version ?? '?'} · {status.hostname ?? ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        <Stat label="Messages en attente" value={number(status.rabbit.messages)} hint={status.rabbit.queue} />
        <Stat label="File d'erreurs" value={number(status.rabbit.deadLetters)} hint="messages à examiner" />
        <Stat label="Dernier événement reçu" value={status.lastMessageAt ? formatDate(status.lastMessageAt) : '—'} />
        <Stat label="Recalcul des profils" value={queueLabel(status.queues.derive)} />
        <Stat label="Campagnes" value={queueLabel(status.queues.campaigns)} />
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

    return {
      data: [...days.values()],
      byEvent: [...events.entries()].sort((a, b) => b[1].accepted - a[1].accepted),
    };
  }, [daily, from]);

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
            <TableHead>Événement ({DAYS} jours)</TableHead>
            {OUTCOMES.map((outcome) => (
              <TableHead key={outcome}>{chartConfig[outcome].label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {byEvent.map(([eventName, total]) => (
            <TableRow key={eventName}>
              <TableCell className="font-medium">{eventName}</TableCell>
              {OUTCOMES.map((outcome) => (
                <TableCell key={outcome}>{number(total[outcome])}</TableCell>
              ))}
            </TableRow>
          ))}
          {byEvent.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-foreground-500 text-center text-sm">
                Aucun événement reçu sur la période.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function CrmMonitoringPage() {
  const { data, isLoading } = useCrmIngestion(DAYS);
  const replay = useReplayCrmDeadLetters();
  const [limit, setLimit] = useState('100');

  const requestReplay = async () => {
    try {
      await replay.mutateAsync(Number(limit) || 100);
      showSuccessToast('Relecture demandée : crm-ingest la traite dans les 30 secondes');
    } catch (error) {
      showErrorToast((error as Error).message, 'Relecture non demandée');
    }
  };

  return (
    <>
      <PageMeta title="Suivi CRM" />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">Suivi CRM</h1>}>
        <div className="flex flex-col gap-8 p-4">
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground-950 text-base font-medium">Service d'ingestion (crm-ingest)</h2>
            {isLoading ? (
              <p className="text-foreground-500 text-sm">Chargement…</p>
            ) : (
              <ServiceStatus status={data?.status ?? null} />
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-foreground-950 text-base font-medium">Événements reçus d'Izichange</h2>
            <IngestionChart daily={data?.daily ?? []} from={data?.from ?? new Date().toISOString().slice(0, 10)} />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-foreground-950 text-base font-medium">File d'erreurs</h2>
                <p className="text-foreground-600 text-sm">
                  Messages rejetés (format ou données invalides), gardés 30 jours. Une fois la cause corrigée chez
                  Izichange ou dans crm-ingest, rejoue-les.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="w-24"
                  inputMode="numeric"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value.replace(/[^0-9]/g, ''))}
                />
                <Button variant="primary" size="sm" isLoading={replay.isPending} onClick={requestReplay}>
                  Rejouer
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reçu le</TableHead>
                  <TableHead>Événement</TableHead>
                  <TableHead>Motif</TableHead>
                  <TableHead>Contenu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.deadLetters ?? []).map((deadLetter) => (
                  <TableRow key={deadLetter._id}>
                    <TableCell className="whitespace-nowrap">{formatDate(deadLetter.at)}</TableCell>
                    <TableCell>
                      <div>{deadLetter.eventType ?? deadLetter.routingKey ?? '—'}</div>
                      <div className="text-foreground-500 text-xs">{deadLetter.eventId ?? ''}</div>
                    </TableCell>
                    <TableCell className="max-w-[260px] text-sm">{deadLetter.reason}</TableCell>
                    <TableCell>
                      <code className="text-foreground-600 block max-h-20 max-w-[420px] overflow-auto whitespace-pre-wrap break-all text-xs">
                        {deadLetter.preview}
                      </code>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && (data?.deadLetters ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-foreground-500 text-center text-sm">
                      Aucun message rejeté ces 30 derniers jours.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {(data?.commands ?? []).length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-foreground-700 text-sm font-medium">Dernières relectures</h3>
                {data?.commands.map((command) => (
                  <div key={command._id} className="text-foreground-600 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="lighter" color={COMMAND_STATUS[command.status].color} size="sm">
                      {COMMAND_STATUS[command.status].label}
                    </Badge>
                    <span>
                      {formatDate(command.requestedAt)} — jusqu'à {command.limit} message(s)
                      {command.result ? ` : ${command.result}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </DashboardLayout>
    </>
  );
}
