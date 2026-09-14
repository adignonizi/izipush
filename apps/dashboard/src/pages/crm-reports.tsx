import { useMemo, useState } from 'react';
import type { CrmReportRow } from '@/api/crm-reports';
import { CampaignRunsDialog } from '@/components/crm/campaign-runs-dialog';
import { SCHEDULE_MODE_LABELS } from '@/components/crm/crm-labels';
import { CHANNEL_LABELS, formatCount, rate, totalStats } from '@/components/crm/crm-stats';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/primitives/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useCrmReportOverview } from '@/hooks/use-crm-reports';

// izipush-crm — rapport client : ce que les campagnes ont envoyé et ce qu'elles ont produit, sur une période.

const PERIODS = [7, 30, 90];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-stroke-soft flex min-w-[150px] flex-1 flex-col gap-1 rounded-lg border p-3">
      <span className="text-foreground-500 text-xs">{label}</span>
      <span className="text-foreground-950 text-xl font-medium">{value}</span>
      {hint && <span className="text-foreground-500 text-xs">{hint}</span>}
    </div>
  );
}

export function CrmReportsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useCrmReportOverview(days);
  const [opened, setOpened] = useState<CrmReportRow>();
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

  return (
    <>
      <PageMeta title="Rapports CRM" />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">Rapports</h1>}>
        <div className="flex flex-col gap-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-foreground-600 text-sm">
              Résultats des campagnes des {days} derniers jours : exécutions déclenchées sur la période et envois « sur
              événement ».
            </p>
            <div className="flex gap-1">
              {PERIODS.map((period) => (
                <Button
                  key={period}
                  size="xs"
                  variant={period === days ? 'primary' : 'secondary'}
                  mode={period === days ? 'filled' : 'outline'}
                  onClick={() => setDays(period)}
                >
                  {period} j
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Kpi label="Campagnes" value={formatCount(rows.length)} hint={`${formatCount(runs)} exécution(s)`} />
            <Kpi label="Clients visés" value={formatCount(audience)} hint="exécutions planifiées" />
            <Kpi
              label="Messages envoyés"
              value={formatCount(total.sent)}
              hint={`${formatCount(total.errors)} erreur(s)`}
            />
            <Kpi
              label="Taux d'ouverture"
              value={rate(total.opened, total.sent)}
              hint={`${formatCount(total.opened)} ouverts`}
            />
            <Kpi
              label="Taux de clic"
              value={rate(total.clicked, total.sent)}
              hint={`${formatCount(total.clicked)} clics`}
            />
          </div>

          {byChannel.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead>Envoyés</TableHead>
                  <TableHead>Erreurs</TableHead>
                  <TableHead>Écartés</TableHead>
                  <TableHead>Ouverture</TableHead>
                  <TableHead>Clic</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byChannel.map(([channel, stats]) => (
                  <TableRow key={channel}>
                    <TableCell className="font-medium">{CHANNEL_LABELS[channel] ?? channel}</TableCell>
                    <TableCell>{formatCount(stats.sent)}</TableCell>
                    <TableCell>
                      {formatCount(stats.errors)}{' '}
                      <span className="text-foreground-500 text-xs">
                        ({rate(stats.errors, stats.sent + stats.errors)})
                      </span>
                    </TableCell>
                    <TableCell>{formatCount(stats.skipped)}</TableCell>
                    <TableCell>{rate(stats.opened, stats.sent)}</TableCell>
                    <TableCell>{rate(stats.clicked, stats.sent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex flex-col gap-2">
            <h2 className="text-foreground-950 text-base font-medium">Par campagne</h2>
            <Table isLoading={isLoading} loadingRowsCount={4}>
              <TableHeader>
                <TableRow>
                  <TableHead>Campagne</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Exécutions</TableHead>
                  <TableHead>Visés</TableHead>
                  <TableHead>Envoyés</TableHead>
                  <TableHead>Erreurs</TableHead>
                  <TableHead>Ouverture</TableHead>
                  <TableHead>Clic</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const stats = totalStats(row.stats);

                  return (
                    <TableRow key={row.campaignId} className="cursor-pointer" onClick={() => setOpened(row)}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{SCHEDULE_MODE_LABELS[row.mode]}</TableCell>
                      <TableCell>{formatCount(row.runs)}</TableCell>
                      <TableCell>{formatCount(row.audience)}</TableCell>
                      <TableCell>{formatCount(stats.sent)}</TableCell>
                      <TableCell>{formatCount(stats.errors)}</TableCell>
                      <TableCell>{rate(stats.opened, stats.sent)}</TableCell>
                      <TableCell>{rate(stats.clicked, stats.sent)}</TableCell>
                    </TableRow>
                  );
                })}
                {!isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-foreground-500 text-center text-sm">
                      Aucune campagne n'a envoyé de message sur la période.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {data?.truncated && (
              <p className="text-foreground-500 text-xs">
                Plus de 1 000 exécutions : seules les plus récentes sont comptées.
              </p>
            )}
          </div>
        </div>

        <CampaignRunsDialog
          campaign={opened ? { _id: opened.campaignId, name: opened.name } : undefined}
          onClose={() => setOpened(undefined)}
        />
      </DashboardLayout>
    </>
  );
}
