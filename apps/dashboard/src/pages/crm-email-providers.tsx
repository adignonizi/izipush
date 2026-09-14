import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { CrmEmailProvider, CrmEmailProviderSettings, CrmProviderUsage } from '@/api/crm-email-providers';
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
import { Switch } from '@/components/primitives/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useCrmEmailProviders, useCrmEmailUsage, useSaveCrmEmailProvider } from '@/hooks/use-crm-email-providers';

// izipush-crm — fournisseurs email des campagnes : répartition, limites d'envoi et suivi.

const USAGE_DAYS = 14;

const chartConfig = {
  sent: { label: 'Envoyés', color: '#22c55e' },
  failed: { label: 'Échecs', color: '#ef4444' },
  bounced: { label: 'Bounces', color: '#f59e0b' },
  complaints: { label: 'Plaintes', color: '#a855f7' },
} satisfies ChartConfig;

type Draft = Omit<CrmEmailProviderSettings, 'perMinute' | 'perHour' | 'perDay'> & {
  perMinute: string;
  perHour: string;
  perDay: string;
};

const toDraft = (provider: CrmEmailProvider): Draft => ({
  routingEnabled: provider.routingEnabled,
  order: provider.order,
  perMinute: provider.perMinute?.toString() ?? '',
  perHour: provider.perHour?.toString() ?? '',
  perDay: provider.perDay?.toString() ?? '',
});

const toLimit = (value: string) => (value.trim() === '' ? null : Number(value));

function usageLabel(value: number, limit: number | null) {
  return limit ? `${value} / ${limit}` : String(value);
}

function ProviderRow({ provider }: { provider: CrmEmailProvider }) {
  const save = useSaveCrmEmailProvider();
  const [draft, setDraft] = useState<Draft>(() => toDraft(provider));

  useEffect(() => setDraft(toDraft(provider)), [provider]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(provider));
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    try {
      await save.mutateAsync({
        integrationId: provider.integrationId,
        body: {
          routingEnabled: draft.routingEnabled,
          order: Number(draft.order) || 0,
          perMinute: toLimit(draft.perMinute),
          perHour: toLimit(draft.perHour),
          perDay: toLimit(draft.perDay),
        },
      });
      showSuccessToast('Réglages enregistrés (pris en compte sous 30 secondes)');
    } catch (error) {
      showErrorToast((error as Error).message, 'Réglages non enregistrés');
    }
  };

  const limitInput = (field: 'perMinute' | 'perHour' | 'perDay') => (
    <Input
      className="w-24"
      inputMode="numeric"
      placeholder="∞"
      value={draft[field]}
      onChange={(event) => set({ [field]: event.target.value.replace(/[^0-9]/g, '') })}
    />
  );

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{provider.name}</div>
        <div className="text-foreground-500 text-xs">
          {provider.providerId} · {provider.identifier}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant="lighter" color={provider.active ? 'green' : 'gray'} size="md">
            {provider.active ? 'Active' : 'Inactive'}
          </Badge>
          {provider.primary && (
            <Badge variant="lighter" color="blue" size="md">
              Principale
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Switch checked={draft.routingEnabled} onCheckedChange={(checked) => set({ routingEnabled: checked })} />
      </TableCell>
      <TableCell>
        <Input
          className="w-16"
          inputMode="numeric"
          value={String(draft.order)}
          onChange={(event) => set({ order: Number(event.target.value.replace(/[^0-9]/g, '')) || 0 })}
        />
      </TableCell>
      <TableCell>{limitInput('perMinute')}</TableCell>
      <TableCell>{limitInput('perHour')}</TableCell>
      <TableCell>{limitInput('perDay')}</TableCell>
      <TableCell className="text-foreground-600 whitespace-nowrap text-xs">
        {provider.current ? (
          <>
            <div>min : {usageLabel(provider.current.minute, provider.perMinute)}</div>
            <div>heure : {usageLabel(provider.current.hour, provider.perHour)}</div>
            <div>jour : {usageLabel(provider.current.day, provider.perDay)}</div>
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="primary" size="xs" disabled={!dirty} isLoading={save.isPending} onClick={submit}>
          Enregistrer
        </Button>
      </TableCell>
    </TableRow>
  );
}

function UsageChart({
  rows,
  from,
  providers,
}: {
  rows: CrmProviderUsage[];
  from?: string;
  providers: CrmEmailProvider[];
}) {
  const { data, totals } = useMemo(() => {
    const byDay = new Map<string, { day: string; sent: number; failed: number; bounced: number; complaints: number }>();
    const start = from ? new Date(`${from}T00:00:00Z`) : new Date();

    for (let offset = 0; offset < USAGE_DAYS; offset++) {
      const day = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
      byDay.set(day, { day, sent: 0, failed: 0, bounced: 0, complaints: 0 });
    }

    const perProvider = new Map<string, CrmProviderUsage>();

    for (const row of rows) {
      const point = byDay.get(row.day);
      if (point) {
        point.sent += row.sent;
        point.failed += row.failed;
        point.bounced += row.bounced;
        point.complaints += row.complaints;
      }

      const total = perProvider.get(row._integrationId) ?? {
        ...row,
        sent: 0,
        failed: 0,
        bounced: 0,
        complaints: 0,
        postponed: 0,
      };
      total.sent += row.sent;
      total.failed += row.failed;
      total.bounced += row.bounced;
      total.complaints += row.complaints;
      total.postponed += row.postponed;
      perProvider.set(row._integrationId, total);
    }

    return { data: [...byDay.values()], totals: [...perProvider.values()] };
  }, [rows, from]);

  const nameOf = (integrationId: string) =>
    integrationId === 'routing'
      ? 'Répartition (tous pleins)'
      : (providers.find((provider) => provider.integrationId === integrationId)?.name ?? integrationId);
  const rate = (part: number, total: number) => (total ? `${((part / total) * 100).toFixed(2)} %` : '—');

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(day: string) => day.slice(5)} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="sent" stackId="usage" fill="var(--color-sent)" />
          <Bar dataKey="failed" stackId="usage" fill="var(--color-failed)" />
          <Bar dataKey="bounced" stackId="usage" fill="var(--color-bounced)" />
          <Bar dataKey="complaints" stackId="usage" fill="var(--color-complaints)" />
        </BarChart>
      </ChartContainer>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fournisseur ({USAGE_DAYS} jours)</TableHead>
            <TableHead>Envoyés</TableHead>
            <TableHead>Échecs</TableHead>
            <TableHead>Bounces</TableHead>
            <TableHead>Plaintes</TableHead>
            <TableHead>Repoussés</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map((total) => (
            <TableRow key={total._integrationId}>
              <TableCell className="font-medium">{nameOf(total._integrationId)}</TableCell>
              <TableCell>{total.sent}</TableCell>
              <TableCell>
                {total.failed}{' '}
                <span className="text-foreground-500 text-xs">({rate(total.failed, total.sent + total.failed)})</span>
              </TableCell>
              <TableCell>
                {total.bounced} <span className="text-foreground-500 text-xs">({rate(total.bounced, total.sent)})</span>
              </TableCell>
              <TableCell>
                {total.complaints}{' '}
                <span className="text-foreground-500 text-xs">({rate(total.complaints, total.sent)})</span>
              </TableCell>
              <TableCell>{total.postponed}</TableCell>
            </TableRow>
          ))}
          {totals.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-foreground-500 text-center text-sm">
                Aucun envoi sur la période.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function CrmEmailProvidersPage() {
  const { data: providers = [], isLoading } = useCrmEmailProviders();
  const { data: usage } = useCrmEmailUsage(USAGE_DAYS);

  return (
    <>
      <PageMeta title="Fournisseurs email" />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">Fournisseurs email</h1>}>
        <div className="flex flex-col gap-6 p-4">
          <p className="text-foreground-600 text-sm">
            Les emails de campagne sont répartis entre les fournisseurs cochés, dans l'ordre croissant : quand l'un
            atteint sa limite (minute, heure ou jour), le suivant prend le relais. Si tous sont pleins, l'envoi attend
            la fin de la fenêtre. Limite vide = pas de limite. Aucun fournisseur coché = fournisseur principal de Novu.
            Les emails hors campagne (OTP, reçus) ne sont pas concernés.
          </p>

          <Table isLoading={isLoading} loadingRowsCount={3}>
            <TableHeader>
              <TableRow>
                <TableHead>Intégration</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Répartition</TableHead>
                <TableHead>Ordre</TableHead>
                <TableHead>/ minute</TableHead>
                <TableHead>/ heure</TableHead>
                <TableHead>/ jour</TableHead>
                <TableHead>En cours</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((provider) => (
                <ProviderRow key={provider.integrationId} provider={provider} />
              ))}
              {!isLoading && providers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-foreground-500 text-center text-sm">
                    Aucune intégration email dans cet environnement. Ajoute-en depuis « Integrations ».
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex flex-col gap-2">
            <h2 className="text-foreground-950 text-base font-medium">Suivi des envois</h2>
            <UsageChart rows={usage?.rows ?? []} from={usage?.from} providers={providers} />
          </div>
        </div>
      </DashboardLayout>
    </>
  );
}
