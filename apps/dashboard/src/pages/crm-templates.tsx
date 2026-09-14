import { useState } from 'react';
import { RiAddLine, RiDeleteBin2Line, RiEditLine } from 'react-icons/ri';
import { useNavigate } from 'react-router-dom';
import type { CrmTemplateSummary } from '@/api/crm-templates';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { formatDate } from '@/components/crm/crm-labels';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/primitives/button';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmTemplates, useDeleteCrmTemplate } from '@/hooks/use-crm-templates';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — liste des templates email.

export function CrmTemplatesPage() {
  const { currentEnvironment } = useEnvironment();
  const navigate = useNavigate();
  const { data: templates = [], isLoading } = useCrmTemplates();
  const remove = useDeleteCrmTemplate();
  const [toDelete, setToDelete] = useState<CrmTemplateSummary>();

  const open = (templateId: string) =>
    navigate(buildRoute(ROUTES.CRM_TEMPLATE_EDIT, { environmentSlug: currentEnvironment?.slug ?? '', templateId }));

  const confirmDelete = async () => {
    if (!toDelete) return;

    try {
      await remove.mutateAsync(toDelete._id);
      showSuccessToast('Template supprimé');
    } catch (error) {
      showErrorToast((error as Error).message, 'Template non supprimé');
    } finally {
      setToDelete(undefined);
    }
  };

  return (
    <>
      <PageMeta title="Templates email" />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">Templates email</h1>}>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <p className="text-foreground-600 text-sm">
              Des emails réutilisables. Choisis-en un dans une étape email : chaque modification du template y est
              recopiée. Crée-les dans l'environnement où tu édites tes workflows.
            </p>
            <Button variant="primary" size="sm" onClick={() => open('new')}>
              <RiAddLine className="size-4" /> Nouveau template
            </Button>
          </div>

          <Table isLoading={isLoading} loadingRowsCount={4}>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Modifié le</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template._id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>{template.subject ?? '—'}</TableCell>
                  <TableCell>v{template.version}</TableCell>
                  <TableCell>{formatDate(template.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" mode="ghost" size="xs" onClick={() => open(template._id)}>
                        <RiEditLine className="size-4" />
                      </Button>
                      <Button variant="secondary" mode="ghost" size="xs" onClick={() => setToDelete(template)}>
                        <RiDeleteBin2Line className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-foreground-500 text-center text-sm">
                    Aucun template pour l'instant.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <ConfirmationModal
          open={!!toDelete}
          onOpenChange={(isOpen) => !isOpen && setToDelete(undefined)}
          onConfirm={confirmDelete}
          title="Supprimer le template ?"
          description={`« ${toDelete?.name ?? ''} » sera supprimé. Un template utilisé par une étape email ne peut pas l'être.`}
          confirmButtonText="Supprimer"
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
