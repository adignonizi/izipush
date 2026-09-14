import { useState } from 'react';
import { RiAddLine, RiDeleteBin2Line, RiHistoryLine, RiPauseLine, RiPlayLine } from 'react-icons/ri';
import type { CrmCampaign } from '@/api/crm';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { CampaignRunsDialog } from '@/components/crm/campaign-runs-dialog';
import { CreateCampaignDialog } from '@/components/crm/create-campaign-dialog';
import { CAMPAIGN_STATUS, describeSchedule, formatDate } from '@/components/crm/crm-labels';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import {
  useCrmCampaigns,
  useCrmFields,
  useCrmSegments,
  useDeleteCrmCampaign,
  useSetCrmCampaignState,
} from '@/hooks/use-crm';

// izipush-crm — liste, lancement et historique des campagnes.

export function CrmCampaignsPage() {
  const { data: campaigns = [], isLoading } = useCrmCampaigns();
  const { data: segments = [] } = useCrmSegments();
  const { data: fields } = useCrmFields();
  const setState = useSetCrmCampaignState();
  const remove = useDeleteCrmCampaign();
  const [creating, setCreating] = useState(false);
  const [runsOf, setRunsOf] = useState<CrmCampaign>();
  const [toDelete, setToDelete] = useState<CrmCampaign>();

  const segmentName = (segmentId: string) => segments.find((segment) => segment._id === segmentId)?.name ?? '—';

  const toggle = async (campaign: CrmCampaign) => {
    const action = campaign.status === 'active' ? 'pause' : 'activate';

    try {
      await setState.mutateAsync({ campaignId: campaign._id, action });
      showSuccessToast(action === 'activate' ? 'Campagne activée' : 'Campagne mise en pause');
    } catch (error) {
      showErrorToast((error as Error).message, action === 'activate' ? 'Campagne non activée' : 'Pause impossible');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;

    try {
      await remove.mutateAsync(toDelete._id);
      showSuccessToast('Campagne supprimée');
    } catch (error) {
      showErrorToast((error as Error).message, 'Campagne non supprimée');
    } finally {
      setToDelete(undefined);
    }
  };

  return (
    <>
      <PageMeta title="Campagnes" />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">Campagnes</h1>}>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p className="text-foreground-600 text-sm">
              Un segment, un workflow, un moment. Une campagne créée reste en brouillon jusqu'à son activation.
            </p>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!fields}>
              <RiAddLine className="size-4" /> Nouvelle campagne
            </Button>
          </div>

          <Table isLoading={isLoading} loadingRowsCount={4}>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Quand</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Prochaine</TableHead>
                <TableHead>Dernière</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign._id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{campaign.name}</span>
                      {campaign.error && <span className="text-xs text-red-600">{campaign.error}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{segmentName(campaign.segmentId)}</TableCell>
                  <TableCell className="font-mono text-xs">{campaign.workflowKey}</TableCell>
                  <TableCell className="text-xs">{describeSchedule(campaign.schedule)}</TableCell>
                  <TableCell>
                    <Badge variant="lighter" color={CAMPAIGN_STATUS[campaign.status].color} size="md">
                      {CAMPAIGN_STATUS[campaign.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(campaign.nextRunAt)}</TableCell>
                  <TableCell className="text-xs">{formatDate(campaign.lastRunAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="secondary"
                        mode="ghost"
                        size="xs"
                        onClick={() => toggle(campaign)}
                        disabled={setState.isPending}
                        title={campaign.status === 'active' ? 'Mettre en pause' : 'Activer'}
                      >
                        {campaign.status === 'active' ? (
                          <RiPauseLine className="size-4" />
                        ) : (
                          <RiPlayLine className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        mode="ghost"
                        size="xs"
                        onClick={() => setRunsOf(campaign)}
                        title="Exécutions"
                      >
                        <RiHistoryLine className="size-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        mode="ghost"
                        size="xs"
                        onClick={() => setToDelete(campaign)}
                        disabled={campaign.status === 'active'}
                        title="Supprimer"
                      >
                        <RiDeleteBin2Line className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-foreground-500 text-center text-sm">
                    Aucune campagne pour l'instant.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {fields && (
          <CreateCampaignDialog open={creating} onOpenChange={setCreating} fields={fields} segments={segments} />
        )}
        <CampaignRunsDialog campaign={runsOf} onClose={() => setRunsOf(undefined)} />
        <ConfirmationModal
          open={!!toDelete}
          onOpenChange={(open) => !open && setToDelete(undefined)}
          onConfirm={confirmDelete}
          title="Supprimer la campagne ?"
          description={`« ${toDelete?.name ?? ''} » et son historique d'exécutions ne seront plus visibles.`}
          confirmButtonText="Supprimer"
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
