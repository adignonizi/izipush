import { useEffect, useId, useState } from 'react';
import { CRM_UNKNOWN_PRODUCT_ID, type CrmProduct, type CrmProductBody } from '@/api/crm-products';
import { Button } from '@/components/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/primitives/dialog';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { Switch } from '@/components/primitives/switch';
import { Textarea } from '@/components/primitives/textarea';
import { t } from './crm-i18n';

// izipush-crm — création et modification d'un produit. L'identifiant n'est saisissable qu'à la création :
// c'est la clé de rapprochement des événements déjà reçus, la changer les détacherait du produit.

export function ProductFormDialog({
  product,
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: {
  /** Absent : création. Présent : modification, identifiant figé. */
  product?: CrmProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: CrmProductBody) => void;
  isLoading?: boolean;
}) {
  const fieldId = useId();
  const [productId, setProductId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;

    setProductId(product?.productId ?? '');
    setName(product?.name ?? '');
    setDescription(product?.description ?? '');
    setActive(product?.active ?? true);
  }, [open, product]);

  const isEdit = !!product;
  const isUnknown = product?.productId === CRM_UNKNOWN_PRODUCT_ID;
  const canSubmit = name.trim().length > 0 && (isEdit || productId.trim().length > 0);

  const submit = () =>
    onSubmit(
      isEdit
        ? { name: name.trim(), description: description.trim(), active }
        : { productId: productId.trim(), name: name.trim(), description: description.trim() }
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('productForm.editTitle') : t('productForm.newTitle')}</DialogTitle>
          {isUnknown && <DialogDescription>{t('products.unknown.hint')}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-id`}>{t('productForm.id')}</Label>
            <Input
              id={`${fieldId}-id`}
              value={productId}
              disabled={isEdit}
              placeholder={t('productForm.idPlaceholder')}
              onChange={(event) => setProductId(event.target.value)}
            />
            <p className="text-text-soft text-paragraph-xs">
              {isEdit ? t('productForm.idLocked') : t('productForm.idHint')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-name`}>{t('productForm.name')}</Label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              placeholder={t('productForm.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-description`}>{t('productForm.description')}</Label>
            <Textarea
              id={`${fieldId}-description`}
              value={description}
              rows={2}
              placeholder={t('productForm.descriptionPlaceholder')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {isEdit && (
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${fieldId}-active`}>{t('productForm.active')}</Label>
                <p className="text-text-soft text-paragraph-xs max-w-[38ch]">{t('productForm.activeHint')}</p>
              </div>
              <Switch id={`${fieldId}-active`} checked={active} onCheckedChange={setActive} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" mode="outline" size="xs" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="xs" disabled={!canSubmit} isLoading={isLoading} onClick={submit}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
