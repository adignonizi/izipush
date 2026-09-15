import type { IEnvironment } from '@novu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RiSendPlaneLine } from 'react-icons/ri';
import { type CrmEmailProviderSettings, getCrmEmailProviders, saveCrmEmailProvider } from '@/api/crm-email-providers';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/primitives/accordion';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Switch } from '@/components/primitives/switch';
import { QueryKeys } from '@/utils/query-keys';
import { formatNumber, t } from './crm-i18n';

// izipush-crm — réglages d'envoi des campagnes d'une intégration email, dans sa fiche Novu (création et modification) :
// l'intégration participe-t-elle à la répartition, dans quel ordre, avec quelles limites.

export type CampaignSendingDraft = {
  routingEnabled: boolean;
  order: string;
  perMinute: string;
  perHour: string;
  perDay: string;
};

export const EMPTY_SENDING_DRAFT: CampaignSendingDraft = {
  routingEnabled: false,
  order: '1',
  perMinute: '',
  perHour: '',
  perDay: '',
};

const toLimit = (value: string) => (value.trim() === '' ? null : Number(value));

export function toSendingSettings(draft: CampaignSendingDraft): CrmEmailProviderSettings {
  return {
    routingEnabled: draft.routingEnabled,
    order: Number(draft.order) || 0,
    perMinute: toLimit(draft.perMinute),
    perHour: toLimit(draft.perHour),
    perDay: toLimit(draft.perDay),
  };
}

/** Rien à enregistrer tant que l'intégration ne participe pas et n'a aucune limite. */
export function isSendingConfigured(draft: CampaignSendingDraft): boolean {
  return draft.routingEnabled || !!draft.perMinute || !!draft.perHour || !!draft.perDay;
}

const digits = (value: string) => value.replace(/[^0-9]/g, '');

export function CampaignSendingFields({
  value,
  onChange,
  disabled,
  footer,
}: {
  value: CampaignSendingDraft;
  onChange: (value: CampaignSendingDraft) => void;
  disabled?: boolean;
  footer?: React.ReactNode;
}) {
  const set = (patch: Partial<CampaignSendingDraft>) => onChange({ ...value, ...patch });

  return (
    <Accordion type="single" collapsible defaultValue="crm-sending" className="p-3">
      <AccordionItem value="crm-sending">
        <AccordionTrigger>
          <div className="flex items-center gap-1 text-xs">
            <RiSendPlaneLine className="text-feature size-5" aria-hidden />
            {t('sending.title')}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="border-neutral-alpha-200 bg-background flex flex-col gap-4 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="crm-sending-enabled" className="text-xs">
                  {t('sending.enabled')}
                </Label>
                <p className="text-text-soft text-paragraph-xs">{t('sending.enabled.hint')}</p>
              </div>
              <Switch
                id="crm-sending-enabled"
                checked={value.routingEnabled}
                disabled={disabled}
                onCheckedChange={(routingEnabled) => set({ routingEnabled })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crm-sending-order" className="text-xs">
                {t('sending.order')}
              </Label>
              <Input
                id="crm-sending-order"
                inputMode="numeric"
                size="xs"
                className="max-w-[88px]"
                value={value.order}
                disabled={disabled}
                onChange={(event) => set({ order: digits(event.target.value) })}
              />
              <p className="text-text-soft text-paragraph-xs">{t('sending.order.hint')}</p>
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-text-strong mb-1.5 text-xs font-medium">{t('sending.limits')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {(['perMinute', 'perHour', 'perDay'] as const).map((field) => (
                  <div key={field} className="flex flex-col gap-1">
                    <Label htmlFor={`crm-sending-${field}`} className="text-text-soft text-[11px]">
                      {t(`sending.${field}`)}
                    </Label>
                    <Input
                      id={`crm-sending-${field}`}
                      inputMode="numeric"
                      size="xs"
                      placeholder={t('sending.noLimit')}
                      value={value[field]}
                      disabled={disabled}
                      onChange={(event) => set({ [field]: digits(event.target.value) })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-text-soft text-paragraph-xs">{t('sending.limits.hint')}</p>
            </fieldset>

            {footer}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** Fiche d'une intégration existante : lit et enregistre ses réglages d'envoi, dans son propre environnement. */
export function CampaignSendingSection({
  integrationId,
  environment,
  disabled,
}: {
  integrationId: string;
  environment?: IEnvironment;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: providers } = useQuery({
    queryKey: [QueryKeys.fetchCrmEmailProviders, environment?._id],
    queryFn: ({ signal }) => getCrmEmailProviders({ environment: environment!, signal }),
    enabled: !!environment?._id,
  });
  const current = providers?.find((provider) => provider.integrationId === integrationId);
  const [draft, setDraft] = useState<CampaignSendingDraft>(EMPTY_SENDING_DRAFT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!current) return;
    setDraft({
      routingEnabled: current.routingEnabled,
      order: String(current.order || 1),
      perMinute: current.perMinute?.toString() ?? '',
      perHour: current.perHour?.toString() ?? '',
      perDay: current.perDay?.toString() ?? '',
    });
  }, [current]);

  const save = async () => {
    if (!environment) return;
    setSaving(true);

    try {
      await saveCrmEmailProvider({ environment, integrationId, body: toSendingSettings(draft) });
      await queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmEmailProviders, environment._id] });
      showSuccessToast(t('sending.toast.saved'));
    } catch (error) {
      showErrorToast((error as Error).message, t('sending.toast.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CampaignSendingFields
      value={draft}
      onChange={setDraft}
      disabled={disabled || !current}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {current?.current ? (
            <p className="text-text-soft text-paragraph-xs tabular-nums">
              {t('sending.current', {
                minute: formatNumber(current.current.minute),
                hour: formatNumber(current.current.hour),
                day: formatNumber(current.current.day),
              })}
            </p>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="secondary"
            mode="outline"
            size="xs"
            isLoading={saving}
            disabled={disabled || !current}
            onClick={save}
          >
            {t('sending.save')}
          </Button>
        </div>
      }
    />
  );
}
