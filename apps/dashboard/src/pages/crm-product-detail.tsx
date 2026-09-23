import { useState } from 'react';
import { RiEditLine, RiPriceTag3Line } from 'react-icons/ri';
import { useParams } from 'react-router-dom';
import { CRM_UNKNOWN_PRODUCT_ID, type CrmProductBody } from '@/api/crm-products';
import { formatNumber, t } from '@/components/crm/crm-i18n';
import { SCHEDULE_MODE_LABELS } from '@/components/crm/crm-labels';
import { CrmBreadcrumbHeader, CrmLinkedCell, CrmRowTitle, CrmSection, CrmStat } from '@/components/crm/crm-page';
import { rate, totalStats } from '@/components/crm/crm-stats';
import { ProductFormDialog } from '@/components/crm/product-form-dialog';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import {
  SegmentedControl,
  SegmentedControlList,
  SegmentedControlTrigger,
} from '@/components/primitives/segmented-control';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/primitives/table';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmProduct, useUpdateCrmProduct } from '@/hooks/use-crm-products';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — fiche d'un produit : ce qu'il pèse, et les campagnes qui en font la promotion.

const PERIODS = ['7', '30', '90'];

export function CrmProductDetailPage() {
  const { currentEnvironment } = useEnvironment();
  const { productId = '' } = useParams<{ productId: string }>();
  const [days, setDays] = useState('30');
  const { data, isLoading } = useCrmProduct(productId, Number(days));
  const update = useUpdateCrmProduct();
  const [isFormOpen, setFormOpen] = useState(false);

  const product = data?.product;
  const rows = data?.report.rows ?? [];
  const isUnknown = product?.productId === CRM_UNKNOWN_PRODUCT_ID;

  const campaignHref = (campaignId: string) =>
    buildRoute(ROUTES.CRM_CAMPAIGN_DETAIL, { environmentSlug: currentEnvironment?.slug ?? '', campaignId });

  const submit = async (body: CrmProductBody) => {
    try {
      await update.mutateAsync({ productId, body });
      showSuccessToast(t('products.toast.updated'));
      setFormOpen(false);
    } catch (error) {
      showErrorToast((error as Error).message, t('products.toast.updateFailed'));
    }
  };

  return (
    <>
      <PageMeta title={product?.name ?? t('nav.products')} />
      <DashboardLayout
        headerStartItems={
          <CrmBreadcrumbHeader
            parentLabel={t('nav.products')}
            parentTo={buildRoute(ROUTES.CRM_PRODUCTS, { environmentSlug: currentEnvironment?.slug ?? '' })}
            current={product?.name}
            icon={RiPriceTag3Line}
            isLoading={isLoading}
          />
        }
      >
        <div className="flex flex-col gap-8 px-2.5 py-4 pb-10 md:px-6">
          <CrmSection
            title={product?.name ?? ''}
            description={isUnknown ? t('products.unknown.hint') : (product?.description ?? t('products.description'))}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="gray" size="sm" className="font-code">
                {product?.productId ?? '—'}
              </Badge>
              {product?.unnamed && (
                <Badge color="orange" size="sm">
                  {t('products.status.unnamed')}
                </Badge>
              )}
              {product && !product.active && (
                <Badge color="gray" size="sm">
                  {t('products.status.archived')}
                </Badge>
              )}
              <Button
                variant="secondary"
                mode="outline"
                size="xs"
                leadingIcon={RiEditLine}
                className="ml-auto"
                onClick={() => setFormOpen(true)}
              >
                {t('common.edit')}
              </Button>
            </div>

            <div className="flex flex-wrap gap-6">
              <CrmStat
                label={t('product.stat.subscribers')}
                value={formatNumber(product?.subscribers)}
                isLoading={isLoading}
              />
              <CrmStat label={t('product.stat.tx')} value={formatNumber(product?.tx)} isLoading={isLoading} />
              <CrmStat
                label={t('product.stat.txFailed')}
                value={formatNumber(product?.txFailed)}
                isLoading={isLoading}
              />
              <CrmStat label={t('product.stat.volume')} value={formatNumber(product?.volUsd)} isLoading={isLoading} />
            </div>
          </CrmSection>

          <CrmSection title={t('product.campaigns.title')} description={t('product.campaigns.text')}>
            <SegmentedControl value={days} onValueChange={setDays}>
              <SegmentedControlList>
                {PERIODS.map((period) => (
                  <SegmentedControlTrigger key={period} value={period} className="text-label-xs px-3">
                    {t('reports.period', { days: period })}
                  </SegmentedControlTrigger>
                ))}
              </SegmentedControlList>
            </SegmentedControl>

            {!isLoading && rows.length === 0 ? (
              <p className="text-text-soft text-paragraph-sm py-4">{t('product.campaigns.empty')}</p>
            ) : (
              <Table isLoading={isLoading} loadingRowsCount={3}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaigns.col.name')}</TableHead>
                    <TableHead>{t('reports.col.type')}</TableHead>
                    <TableHead className="text-right">{t('reports.col.runs')}</TableHead>
                    <TableHead className="text-right">{t('stat.audience')}</TableHead>
                    <TableHead className="text-right">{t('stat.sent')}</TableHead>
                    <TableHead className="text-right">{t('stat.openRate')}</TableHead>
                    <TableHead className="text-right">{t('stat.clickRate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const stats = totalStats(row.stats);
                    const href = campaignHref(row.campaignId);

                    return (
                      <TableRow key={row.campaignId} className="group relative isolate cursor-pointer">
                        <CrmLinkedCell to={href}>
                          <CrmRowTitle to={href} title={row.name} />
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="text-paragraph-sm">
                          {SCHEDULE_MODE_LABELS[row.mode]}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="text-right tabular-nums">
                          {formatNumber(row.runs)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="text-right tabular-nums">
                          {formatNumber(row.audience)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="text-right tabular-nums">
                          {formatNumber(stats.sent)}
                        </CrmLinkedCell>
                        <CrmLinkedCell to={href} className="text-right tabular-nums">
                          {rate(stats.opened, stats.sent)}
                        </CrmLinkedCell>
                        <TableCell className="group-hover:bg-neutral-alpha-50 text-right tabular-nums">
                          {rate(stats.clicked, stats.sent)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CrmSection>
        </div>

        <ProductFormDialog
          product={product}
          open={isFormOpen}
          onOpenChange={setFormOpen}
          onSubmit={submit}
          isLoading={update.isPending}
        />
      </DashboardLayout>
    </>
  );
}
