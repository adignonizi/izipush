import { useState } from 'react';
import { RiAddLine, RiDeleteBin2Line, RiRefreshLine } from 'react-icons/ri';
import type { CrmSegment } from '@/api/crm';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { CreateSegmentDialog } from '@/components/crm/create-segment-dialog';
import { formatDate, SEGMENT_STATUS } from '@/components/crm/crm-labels';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useCrmFields, useCrmSegments, useDeleteCrmSegment, useRetryCrmSegmentFreeze } from '@/hooks/use-crm';

// izipush-crm — liste et création des segments.

export function CrmSegmentsPage() {
  const { data: segments = [], isLoading } = useCrmSegments();
  const { data: fields } = useCrmFields();
  const remove = useDeleteCrmSegment();
  const retry = useRetryCrmSegmentFreeze();

  const retryFreeze = async (segment: CrmSegment) => {
    try {
      await retry.mutateAsync(segment._id);
      showSuccessToast('Figeage relancé');
    } catch (error) {
      showErrorToast((error as Error).message, 'Figeage non relancé');
    }
  };
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<CrmSegment>();

  const confirmDelete = async () => {
    if (!toDelete) return;

    try {
      await remove.mutateAsync(toDelete._id);
      showSuccessToast('Segment supprimé');
    } catch (error) {
      showErrorToast((error as Error).message, 'Segment non supprimé');
    } finally {
      setToDelete(undefined);
    }
  };

  return (
    <>
      <PageMeta title="Segments" />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">Segments</h1>}>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p className="text-foreground-600 text-sm">
              Les clients regroupés par profil et par activité. Un segment figé garde la liste de sa création.
            </p>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!fields}>
              <RiAddLine className="size-4" /> Nouveau segment
            </Button>
          </div>

          <Table isLoading={isLoading} loadingRowsCount={4}>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Clients</TableHead>
                <TableHead>Créé le</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {segments.map((segment) => (
                <TableRow key={segment._id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{segment.name}</span>
                      {segment.description && (
                        <span className="text-foreground-500 text-xs">{segment.description}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{segment.frozen ? `Figé le ${formatDate(segment.frozenAt)}` : 'Dynamique'}</TableCell>
                  <TableCell>
                    <Badge variant="lighter" color={SEGMENT_STATUS[segment.status].color} size="md">
                      {SEGMENT_STATUS[segment.status].label}
                    </Badge>
                    {segment.error && <div className="text-foreground-500 mt-1 text-xs">{segment.error}</div>}
                  </TableCell>
                  <TableCell>
                    {segment.frozen ? (segment.memberCount?.toLocaleString('fr-FR') ?? '—') : 'Calculé à chaque envoi'}
                  </TableCell>
                  <TableCell>{formatDate(segment.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {segment.frozen && segment.status === 'failed' && (
                      <Button
                        variant="secondary"
                        mode="ghost"
                        size="xs"
                        title="Relancer le figeage"
                        disabled={retry.isPending}
                        onClick={() => retryFreeze(segment)}
                      >
                        <RiRefreshLine className="size-4" />
                      </Button>
                    )}
                    <Button variant="secondary" mode="ghost" size="xs" onClick={() => setToDelete(segment)}>
                      <RiDeleteBin2Line className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && segments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-foreground-500 text-center text-sm">
                    Aucun segment pour l'instant.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {fields && <CreateSegmentDialog open={creating} onOpenChange={setCreating} fields={fields} />}
        <ConfirmationModal
          open={!!toDelete}
          onOpenChange={(open) => !open && setToDelete(undefined)}
          onConfirm={confirmDelete}
          title="Supprimer le segment ?"
          description={`« ${toDelete?.name ?? ''} » sera supprimé. Un segment utilisé par une campagne ne peut pas l'être.`}
          confirmButtonText="Supprimer"
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
