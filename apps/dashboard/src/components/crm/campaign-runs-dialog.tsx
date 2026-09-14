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
import { useCrmCampaignRuns } from '@/hooks/use-crm';
import { formatDate, RUN_STATUS } from './crm-labels';

// izipush-crm — historique des exécutions d'une campagne.

export function CampaignRunsDialog({ campaign, onClose }: { campaign?: CrmCampaign; onClose: () => void }) {
  const { data: runs = [], isLoading } = useCrmCampaignRuns(campaign?._id);

  return (
    <Dialog open={!!campaign} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-h-[90vh] max-w-[860px] overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>Exécutions — {campaign?.name}</DialogTitle>
            <DialogDescription>Les 50 dernières exécutions, de la plus récente à la plus ancienne.</DialogDescription>
          </DialogHeader>

          <Table isLoading={isLoading} loadingRowsCount={3}>
            <TableHeader>
              <TableRow>
                <TableHead>Échéance</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Clients visés</TableHead>
                <TableHead>Exclus</TableHead>
                <TableHead>Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run._id}>
                  <TableCell>{formatDate(run.scheduledFor)}</TableCell>
                  <TableCell>
                    <Badge variant="lighter" color={RUN_STATUS[run.status].color} size="md">
                      {RUN_STATUS[run.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell>{run.audienceSize?.toLocaleString('fr-FR') ?? '—'}</TableCell>
                  <TableCell>{run.excludedCount?.toLocaleString('fr-FR') ?? '—'}</TableCell>
                  <TableCell className="text-foreground-600 max-w-[280px] text-xs">{run.error ?? ''}</TableCell>
                </TableRow>
              ))}
              {!isLoading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-foreground-500 text-center text-sm">
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
