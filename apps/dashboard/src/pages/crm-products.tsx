import { useState } from 'react';
import {
  RiAddLine,
  RiArchiveLine,
  RiDeleteBin2Line,
  RiEditLine,
  RiInboxUnarchiveLine,
  RiPriceTag3Line,
} from 'react-icons/ri';
import { CRM_UNKNOWN_PRODUCT_ID, type CrmProductBody, type CrmProductRow } from '@/api/crm-products';
import { ConfirmationModal } from '@/components/confirmation-modal';
import { formatNumber, t } from '@/components/crm/crm-i18n';
import { CrmBlankState, CrmLinkedCell, CrmListIntro, CrmRowMenu, CrmRowTitle } from '@/components/crm/crm-page';
import { ProductFormDialog } from '@/components/crm/product-form-dialog';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useEnvironment } from '@/context/environment/hooks';
import {
  useCreateCrmProduct,
  useCrmProducts,
  useDeleteCrmProduct,
  useUpdateCrmProduct,
} from '@/hooks/use-crm-products';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — catalogue des produits Izichange.

/** Un produit encore sans nom se signale : tant qu'il en porte un provisoire, les segments sont illisibles. */
function ProductBadges({ product }: { product: CrmProductRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {product.unnamed && (
        <Badge color="orange" size="sm">
          {t('products.status.unnamed')}
        </Badge>
      )}
      {!product.active && (
        <Badge color="gray" size="sm">
          {t('products.status.archived')}
        </Badge>
      )}
    </span>
  );
}

export function CrmProductsPage() {
  const { currentEnvironment } = useEnvironment();
  const { data: products = [], isLoading } = useCrmProducts();
  const create = useCreateCrmProduct();
  const update = useUpdateCrmProduct();
  const remove = useDeleteCrmProduct();

  const [editing, setEditing] = useState<CrmProductRow>();
  const [isFormOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CrmProductRow>();

  const detailHref = (productId: string) =>
    buildRoute(ROUTES.CRM_PRODUCT_DETAIL, { environmentSlug: currentEnvironment?.slug ?? '', productId });

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (product: CrmProductRow) => {
    setEditing(product);
    setFormOpen(true);
  };

  const submit = async (body: CrmProductBody) => {
    try {
      if (editing) {
        await update.mutateAsync({ productId: editing._id, body });
        showSuccessToast(t('products.toast.updated'));
      } else {
        await create.mutateAsync(body);
        showSuccessToast(t('products.toast.created'));
      }
      setFormOpen(false);
    } catch (error) {
      showErrorToast(
        (error as Error).message,
        editing ? t('products.toast.updateFailed') : t('products.toast.createFailed')
      );
    }
  };

  const toggleArchive = async (product: CrmProductRow) => {
    try {
      await update.mutateAsync({ productId: product._id, body: { active: !product.active } });
      showSuccessToast(t('products.toast.updated'));
    } catch (error) {
      showErrorToast((error as Error).message, t('products.toast.updateFailed'));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;

    try {
      await remove.mutateAsync(toDelete._id);
      showSuccessToast(t('products.toast.deleted'));
    } catch (error) {
      showErrorToast((error as Error).message, t('products.toast.deleteFailed'));
    } finally {
      setToDelete(undefined);
    }
  };

  const newButton = (
    <Button variant="primary" size="xs" leadingIcon={RiAddLine} onClick={openNew}>
      {t('products.new')}
    </Button>
  );

  return (
    <>
      <PageMeta title={t('nav.products')} />
      <DashboardLayout headerStartItems={<h1 className="text-foreground-950">{t('nav.products')}</h1>}>
        <div className="flex flex-col px-2.5 pb-6 md:px-4">
          {!isLoading && products.length === 0 ? (
            <CrmBlankState
              icon={RiPriceTag3Line}
              title={t('products.blank.title')}
              description={t('products.blank.text')}
              action={newButton}
            />
          ) : (
            <>
              <CrmListIntro description={t('products.description')} action={newButton} />
              <Table isLoading={isLoading} loadingRowsCount={4}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('products.col.name')}</TableHead>
                    <TableHead>{t('products.col.id')}</TableHead>
                    <TableHead>{t('products.col.subscribers')}</TableHead>
                    <TableHead>{t('products.col.tx')}</TableHead>
                    <TableHead>{t('products.col.volume')}</TableHead>
                    <TableHead>{t('products.col.status')}</TableHead>
                    <TableHead className="w-1">
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => {
                    const href = detailHref(product._id);
                    const isUnknown = product.productId === CRM_UNKNOWN_PRODUCT_ID;

                    return (
                      <TableRow key={product._id} className="group relative isolate cursor-pointer">
                        <CrmLinkedCell to={href}>
                          <CrmRowTitle to={href} title={product.name} subtitle={product.description} />
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs max-w-[240px] truncate">
                          {product.productId}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs tabular-nums">
                          {formatNumber(product.subscribers)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs tabular-nums">
                          {formatNumber(product.tx)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="font-code text-code-xs tabular-nums">
                          {formatNumber(product.volUsd)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href}>
                          <ProductBadges product={product} />
                        </CrmLinkedCell>
                        <TableCell className="group-hover:bg-neutral-alpha-50 w-1">
                          <CrmRowMenu
                            items={[
                              { label: t('common.edit'), icon: RiEditLine, onSelect: () => openEdit(product) },
                              {
                                label: product.active ? t('products.archive') : t('products.unarchive'),
                                icon: product.active ? RiArchiveLine : RiInboxUnarchiveLine,
                                onSelect: () => toggleArchive(product),
                              },
                              ...(isUnknown
                                ? []
                                : [
                                    {
                                      label: t('common.delete'),
                                      icon: RiDeleteBin2Line,
                                      destructive: true,
                                      separatorBefore: true,
                                      onSelect: () => setToDelete(product),
                                    },
                                  ]),
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

        <ProductFormDialog
          product={editing}
          open={isFormOpen}
          onOpenChange={setFormOpen}
          onSubmit={submit}
          isLoading={create.isPending || update.isPending}
        />

        <ConfirmationModal
          open={!!toDelete}
          onOpenChange={(isOpen) => !isOpen && setToDelete(undefined)}
          onConfirm={confirmDelete}
          title={t('products.delete.title')}
          description={t('products.delete.text', { name: toDelete?.name ?? '' })}
          confirmButtonText={t('common.delete')}
          confirmButtonVariant="error"
          isLoading={remove.isPending}
        />
      </DashboardLayout>
    </>
  );
}
