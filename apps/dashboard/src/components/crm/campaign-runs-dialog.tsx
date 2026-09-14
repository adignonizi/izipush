import type { CrmCampaign } from '@/api/crm';
import { Badge } from '@/components/primitives/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/primitives/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useCrmCampaignReport } from '@/hooks/use-crm-reports';
import { formatDate, RUN_STATUS } from './crm-labels';
import { describeChannels, formatCount, rate, totalStats } from './crm-stats';

// izipush-crm — exécutions d'une campagne et leurs résultats (envois, erreurs, ouvertures, clics).

export function CampaignRunsDialog({
  campaign,
  onClose,
}: {
  campaign?: Pick<CrmCampaign, '_id' | 'name'>;
  onClose: () => void;
}) {
  const { data: report, isLoading } = useCrmCampaignReport(campaign?._id);
  const runs = report?.runs ?? [];
  const onEvent = report?.onEvent ? totalStats(report.onEvent.stats) : null;

  return (
    <Dialog open={!!campaign} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-h-[90vh] max-w-[1100px] overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>Résultats — {campaign?.name}</DialogTitle>
            <DialogDescription>
              Les 50 dernières exécutions. Ouvertures : push ouverts depuis l'app, emails ouverts signalés par le
              fournisseur (si ses webhooks sont configurés).
            </DialogDescription>
          </DialogHeader>

          {report?.onEvent && onEvent && (
            <div className="border-stroke-soft mb-3 rounded-lg border p-3 text-sm">
              <div className="text-foreground-950 font-medium">
                Envois sur événement — {report.onEvent.days} derniers jours
              </div>
              <div className="text-foreground-600">
                {describeChannels(report.onEvent.stats)} · {formatCount(onEvent.errors)} erreur(s) · ouverture{' '}
                {rate(onEvent.opened, onEvent.sent)} · clic {rate(onEvent.clicked, onEvent.sent)}
              </div>
            </div>
          )}

          <Table isLoading={isLoading} loadingRowsCount={3}>
            <TableHeader>
              <TableRow>
                <TableHead>Échéance</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Visés</TableHead>
                <TableHead>Exclus</TableHead>
                <TableHead>Envoyés</TableHead>
                <TableHead>Erreurs</TableHead>
                <TableHead>Ouverts</TableHead>
                <TableHead>Cliqués</TableHead>
                <TableHead>Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const total = totalStats(run.stats);

                return (
                  <TableRow key={run._id}>
                    <TableCell className="whitespace-nowrap">{formatDate(run.scheduledFor)}</TableCell>
                    <TableCell>
                      <Badge variant="lighter" color={RUN_STATUS[run.status].color} size="md">
                        {RUN_STATUS[run.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell>{run.audienceSize?.toLocaleString('fr-FR') ?? '—'}</TableCell>
                    <TableCell>{run.excludedCount?.toLocaleString('fr-FR') ?? '—'}</TableCell>
                    <TableCell className="text-xs">{describeChannels(run.stats)}</TableCell>
                    <TableCell>{formatCount(total.errors)}</TableCell>
                    <TableCell>
                      {formatCount(total.opened)}{' '}
                      <span className="text-foreground-500 text-xs">({rate(total.opened, total.sent)})</span>
                    </TableCell>
                    <TableCell>
                      {formatCount(total.clicked)}{' '}
                      <span className="text-foreground-500 text-xs">({rate(total.clicked, total.sent)})</span>
                    </TableCell>
                    <TableCell className="text-foreground-600 max-w-[240px] text-xs">{run.error ?? ''}</TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-foreground-500 text-center text-sm">
                    Aucune exécution pour l'instant.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
