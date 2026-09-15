import { useState } from 'react';
import { RiAddLine, RiDeleteBin2Line, RiEditLine, RiMailLine } from 'react-icons/ri';
import { useNavigate } from 'react-router-dom';
import type { CrmTemplateSummary } from '@/api/crm-templates';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { formatDateTime, t } from '@/components/crm/crm-i18n';
import { CrmBlankState, CrmLinkedCell, CrmListIntro, CrmRowMenu, CrmRowTitle } from '@/components/crm/crm-page';
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

  const editHref = (templateId: string) =>
    buildRoute(ROUTES.CRM_TEMPLATE_EDIT, { environmentSlug: currentEnvironment?.slug ?? '', templateId });

  const confirmDelete = async () => {
    if (!toDelete) return;

    try {
      await remove.mutateAsync(toDelete._id);
      showSuccessToast(t('templates.toast.deleted'));
    } catch (error) {
      showErrorToast((error as Error).message, t('templates.toast.deleteFailed'));
    } finally {
      setToDelete(undefined);
    }
  };

  const newButton = (
    <Button variant="primary" size="xs" leadingIcon={RiAddLine} onClick={() => navigate(editHref('new'))}>
      {t('templates.new')}
    </Button>
  );

  return (
    <>
      <PageMeta title={t('nav.templates')} />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">{t('nav.templates')}</h1>}>
        <div className="flex flex-col px-2.5 pb-6 md:px-4">
          {!isLoading && templates.length === 0 ? (
            <CrmBlankState
              icon={RiMailLine}
              title={t('templates.blank.title')}
              description={t('templates.blank.text')}
              action={newButton}
            />
          ) : (
            <>
              <CrmListIntro description={t('templates.description')} action={newButton} />
              <Table isLoading={isLoading} loadingRowsCount={4}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('templates.col.name')}</TableHead>
                    <TableHead>{t('templates.col.subject')}</TableHead>
                    <TableHead>{t('templates.col.version')}</TableHead>
                    <TableHead>{t('templates.col.updated')}</TableHead>
                    <TableHead className="w-1">
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => {
                    const href = editHref(template._id);

                    return (
                      <TableRow key={template._id} className="group relative isolate cursor-pointer">
                        <CrmLinkedCell to={href}>
                          <CrmRowTitle to={href} title={template.name} />
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="text-paragraph-sm max-w-[360px] truncate">
                          {template.subject ?? '—'}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs">
                          v{template.version}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs whitespace-nowrap">
                          {formatDateTime(template.updatedAt)}
                        </CrmLinkedCell>
                        <TableCell className="group-hover:bg-neutral-alpha-50 w-1">
                          <CrmRowMenu
                            items={[
                              { label: t('common.edit'), icon: RiEditLine, onSelect: () => navigate(href) },
                              {
                                label: t('common.delete'),
                                icon: RiDeleteBin2Line,
                                destructive: true,
                                separatorBefore: true,
                                onSelect: () => setToDelete(template),
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </div>

        <ConfirmationModal
          open={!!toDelete}
          onOpenChange={(isOpen) => !isOpen && setToDelete(undefined)}
          onConfirm={confirmDelete}
          title={t('templates.delete.title')}
          description={t('templates.delete.text', { name: toDelete?.name ?? '' })}
          confirmButtonText={t('common.delete')}
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
