import { useState } from 'react';
import type { CrmConditionGroup, CrmFields } from '@/api/crm';
import { Button } from '@/components/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/primitives/dialog';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Switch } from '@/components/primitives/switch';
import { Textarea } from '@/components/primitives/textarea';
import { useCreateCrmSegment, usePreviewCrmSegment } from '@/hooks/use-crm';
import { ConditionBuilder } from './condition-builder';

// izipush-crm — création d'un segment : conditions, aperçu du nombre de clients, liste figée ou non.

const EMPTY_AUDIENCE: CrmConditionGroup = { type: 'group', combinator: 'and', conditions: [] };

export function CreateSegmentDialog({
  open,
  onOpenChange,
  fields,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: CrmFields;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [audience, setAudience] = useState<CrmConditionGroup>(EMPTY_AUDIENCE);
  const preview = usePreviewCrmSegment();
  const create = useCreateCrmSegment();

  const reset = () => {
    setName('');
    setDescription('');
    setFrozen(false);
    setAudience(EMPTY_AUDIENCE);
    preview.reset();
  };

  const changeAudience = (next: CrmConditionGroup) => {
    setAudience(next);
    preview.reset();
  };

  const count = async () => {
    try {
      await preview.mutateAsync(audience);
    } catch (error) {
      showErrorToast((error as Error).message, 'Conditions invalides');
    }
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ name, description: description || undefined, audience, frozen });
      showSuccessToast(frozen ? 'Segment créé : la liste est en cours de figeage' : 'Segment créé');
      reset();
      onOpenChange(false);
    } catch (error) {
      showErrorToast((error as Error).message, 'Segment non créé');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-h-[90vh] max-w-[860px] overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>Nouveau segment</DialogTitle>
            <DialogDescription>Un segment regroupe les clients qui remplissent des conditions.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1">
              <Label>Nom</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Actifs crypto UEMOA" />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Description</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Switch checked={frozen} onCheckedChange={setFrozen} />
              <div className="flex flex-col">
                <span className="text-sm font-medium">Figer la liste à la création</span>
                <span className="text-foreground-500 text-xs">
                  {frozen
                    ? 'La liste est photographiée maintenant et ne changera plus.'
                    : 'La liste est recalculée à chaque exécution de campagne.'}
                </span>
              </div>
            </div>

            <ConditionBuilder fields={fields} value={audience} onChange={changeAudience} />

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                mode="outline"
                size="xs"
                onClick={count}
                disabled={preview.isPending}
              >
                Compter les clients
              </Button>
              {preview.data && (
                <span className="text-sm">
                  <strong>{preview.data.count.toLocaleString('fr-FR')}</strong> client(s) correspondent aujourd'hui
                </span>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" mode="outline" size="sm" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={!name.trim() || create.isPending}
            >
              Créer le segment
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
