import { useState } from 'react';
import type { CrmFields, CrmSchedule, CrmScheduleMode, CrmSegment } from '@/api/crm';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/select';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Textarea } from '@/components/primitives/textarea';
import { useCreateCrmCampaign } from '@/hooks/use-crm';
import { SCHEDULE_MODE_LABELS } from './crm-labels';

// izipush-crm — création d'une campagne : qui (segment), quoi (workflow), quand (planification).

export function CreateCampaignDialog({
  open,
  onOpenChange,
  fields,
  segments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: CrmFields;
  segments: CrmSegment[];
}) {
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState<string>();
  const [workflowKey, setWorkflowKey] = useState('');
  const [mode, setMode] = useState<CrmScheduleMode>('immediate');
  const [at, setAt] = useState('');
  const [cron, setCron] = useState('0 9 * * 1');
  const [timezone, setTimezone] = useState('Africa/Abidjan');
  const [eventName, setEventName] = useState<string>();
  const [payload, setPayload] = useState('');
  const create = useCreateCrmCampaign();

  const usableSegments = segments.filter((segment) => segment.status === 'ready' || segment.status === 'freezing');

  const schedule = (): CrmSchedule => {
    switch (mode) {
      case 'scheduled':
        return { mode, at: at ? new Date(at).toISOString() : undefined };
      case 'recurring':
        return { mode, cron, timezone };
      case 'on_event':
        return { mode, eventName };
      default:
        return { mode };
    }
  };

  const submit = async () => {
    let parsedPayload: Record<string, unknown> | undefined;
    if (payload.trim()) {
      try {
        parsedPayload = JSON.parse(payload);
      } catch {
        showErrorToast('Les données transmises au workflow doivent être un objet JSON', 'Campagne non créée');

        return;
      }
    }

    try {
      await create.mutateAsync({
        name,
        segmentId: segmentId ?? '',
        workflowKey: workflowKey.trim(),
        schedule: schedule(),
        payload: parsedPayload,
      });
      showSuccessToast('Campagne créée en brouillon : activez-la pour la lancer');
      onOpenChange(false);
    } catch (error) {
      showErrorToast((error as Error).message, 'Campagne non créée');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-h-[90vh] max-w-[640px] overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>Nouvelle campagne</DialogTitle>
            <DialogDescription>
              Une campagne envoie un workflow Novu aux clients d'un segment. Le contenu se règle dans le workflow.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1">
              <Label>Nom</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Relance inactifs 30 j"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label>Segment</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un segment" />
                </SelectTrigger>
                <SelectContent>
                  {usableSegments.map((segment) => (
                    <SelectItem key={segment._id} value={segment._id}>
                      {segment.name} {segment.frozen ? '(figé)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>Workflow (identifiant de déclenchement)</Label>
              <Input
                value={workflowKey}
                onChange={(event) => setWorkflowKey(event.target.value)}
                placeholder="relance-inactifs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label>Quand</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as CrmScheduleMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCHEDULE_MODE_LABELS) as CrmScheduleMode[]).map((option) => (
                    <SelectItem key={option} value={option}>
                      {SCHEDULE_MODE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {mode === 'scheduled' && (
              <div className="flex flex-col gap-1">
                <Label>Date et heure de lancement</Label>
                <Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
              </div>
            )}

            {mode === 'recurring' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label>Expression cron</Label>
                  <Input value={cron} onChange={(event) => setCron(event.target.value)} />
                  <span className="text-foreground-500 text-xs">« 0 9 * * 1 » : chaque lundi à 9 h</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Fuseau horaire</Label>
                  <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
                </div>
              </div>
            )}

            {mode === 'on_event' && (
              <div className="flex flex-col gap-1">
                <Label>Événement déclencheur</Label>
                <Select value={eventName} onValueChange={setEventName}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un événement" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.events.map((event) => (
                      <SelectItem key={event} value={event}>
                        {event}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-foreground-500 text-xs">
                  Envoyé au seul client concerné, s'il fait partie du segment.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <Label>Données transmises au workflow (JSON, facultatif)</Label>
              <Textarea
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                rows={3}
                placeholder='{ "offre": "bonus-crypto" }'
              />
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
              disabled={!name.trim() || !segmentId || !workflowKey.trim() || create.isPending}
            >
              Créer la campagne
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
