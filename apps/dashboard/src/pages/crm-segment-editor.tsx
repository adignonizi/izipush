import { useEffect, useRef, useState } from 'react';
import { RiErrorWarningFill, RiFilter3Line } from 'react-icons/ri';
import { useBlocker, useNavigate } from 'react-router-dom';
import type { CrmConditionGroup } from '@/api/crm';
import { ConditionBuilder, isConditionComplete } from '@/components/crm/condition-builder';
import { t, tp } from '@/components/crm/crm-i18n';
import { CrmBreadcrumbHeader, CrmFormFooter, CrmSection } from '@/components/crm/crm-page';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { Skeleton } from '@/components/primitives/skeleton';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Textarea } from '@/components/primitives/textarea';
import { UnsavedChangesAlertDialog } from '@/components/unsaved-changes-alert-dialog';
import { useEnvironment } from '@/context/environment/hooks';
import { useBeforeUnload } from '@/hooks/use-before-unload';
import { useCreateCrmSegment, useCrmFields, usePreviewCrmSegment } from '@/hooks/use-crm';
import { buildRoute, ROUTES } from '@/utils/routes';
import { cn } from '@/utils/ui';

// izipush-crm — création d'un segment en pleine page : critères lisibles, nombre de clients mis à jour en direct,
// et choix expliqué entre liste recalculée et liste figée.

const EMPTY_AUDIENCE: CrmConditionGroup = { type: 'group', combinator: 'and', conditions: [] };
const PREVIEW_DELAY_MS = 600;

function ListChoice({
  selected,
  title,
  text,
  onSelect,
}: {
  selected: boolean;
  title: string;
  text: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'focus-visible:ring-stroke-strong flex flex-1 items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2',
        selected ? 'border-primary-base bg-bg-weak' : 'border-stroke-soft hover:bg-neutral-alpha-50'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary-base' : 'border-stroke-sub'
        )}
        aria-hidden
      >
        {selected && <span className="bg-primary-base size-2 rounded-full" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-label-sm text-text-strong">{title}</span>
        <span className="text-text-soft text-paragraph-xs">{text}</span>
      </span>
    </button>
  );
}

export function CrmSegmentEditorPage() {
  const navigate = useNavigate();
  const { currentEnvironment } = useEnvironment();
  const environmentSlug = currentEnvironment?.slug ?? '';
  const listHref = buildRoute(ROUTES.CRM_SEGMENTS, { environmentSlug });

  const { data: fields, isLoading: isLoadingFields } = useCrmFields();
  const preview = usePreviewCrmSegment();
  const create = useCreateCrmSegment();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [audience, setAudience] = useState<CrmConditionGroup>(EMPTY_AUDIENCE);
  const [attempted, setAttempted] = useState(false);
  const leaving = useRef(false);

  const isComplete = audience.conditions.every(isConditionComplete);
  const isDirty = !!name || !!description || frozen || audience.conditions.length > 0;
  const nameError = attempted && !name.trim() ? t('segEditor.validation.name') : undefined;

  useBeforeUnload(isDirty && !leaving.current);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname
  );

  const { mutate: runPreview } = preview;
  const audienceKey = JSON.stringify(audience);

  useEffect(() => {
    if (!isComplete) return undefined;
    const timer = setTimeout(() => runPreview(JSON.parse(audienceKey) as CrmConditionGroup), PREVIEW_DELAY_MS);

    return () => clearTimeout(timer);
  }, [audienceKey, isComplete, runPreview]);

  const submit = async () => {
    setAttempted(true);
    if (!name.trim()) return;

    try {
      await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined, audience, frozen });
      showSuccessToast(frozen ? t('segEditor.toast.createdFrozen') : t('segEditor.toast.created'));
      leaving.current = true;
      navigate(listHref);
    } catch (error) {
      showErrorToast((error as Error).message, t('segEditor.toast.failed'));
    }
  };

  return (
    <>
      <PageMeta title={t('segEditor.title')} />
      <DashboardLayout
        headerStartItems={
          <CrmBreadcrumbHeader
            parentLabel={t('nav.segments')}
            parentTo={listHref}
            current={name.trim() || t('segEditor.title')}
            icon={RiFilter3Line}
          />
        }
      >
        <div className="flex min-h-full flex-col">
          <div className="flex flex-1 flex-col gap-8 px-4 py-6 lg:flex-row lg:gap-10 md:px-6">
            <div className="flex w-full max-w-[760px] flex-col gap-10">
              <CrmSection title={t('segEditor.title')}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="segment-name" className="text-label-sm text-text-strong">
                    {t('segEditor.name.label')}
                  </Label>
                  <Input
                    id="segment-name"
                    value={name}
                    placeholder={t('segEditor.name.placeholder')}
                    aria-invalid={!!nameError}
                    onChange={(event) => setName(event.target.value)}
                  />
                  {nameError && (
                    <p className="text-error-base text-paragraph-xs flex items-center gap-1" role="alert">
                      <RiErrorWarningFill className="size-3.5" aria-hidden />
                      {nameError}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="segment-description" className="text-label-sm text-text-strong">
                    {t('segEditor.description.label')}{' '}
                    <span className="text-text-soft font-normal">({t('common.optional')})</span>
                  </Label>
                  <Textarea
                    id="segment-description"
                    rows={2}
                    value={description}
                    placeholder={t('segEditor.description.placeholder')}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
              </CrmSection>

              <CrmSection title={t('segEditor.criteria.title')}>
                {isLoadingFields || !fields ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <ConditionBuilder fields={fields} value={audience} onChange={setAudience} />
                )}
              </CrmSection>

              <CrmSection title={t('segEditor.list.title')}>
                <div
                  className="flex flex-col gap-2 sm:flex-row"
                  role="radiogroup"
                  aria-label={t('segEditor.list.title')}
                >
                  <ListChoice
                    selected={!frozen}
                    title={t('segEditor.list.dynamic.title')}
                    text={t('segEditor.list.dynamic.text')}
                    onSelect={() => setFrozen(false)}
                  />
                  <ListChoice
                    selected={frozen}
                    title={t('segEditor.list.frozen.title')}
                    text={t('segEditor.list.frozen.text')}
                    onSelect={() => setFrozen(true)}
                  />
                </div>
              </CrmSection>
            </div>

            <aside className="lg:sticky lg:top-6 lg:w-[280px] lg:shrink-0 lg:self-start">
              <div className="bg-bg-weak flex flex-col gap-2 rounded-lg p-4" aria-live="polite">
                <span className="text-text-soft text-label-xs font-medium">{t('segEditor.preview.title')}</span>
                {!isComplete ? (
                  <p className="text-text-sub text-paragraph-sm">{t('segEditor.preview.incomplete')}</p>
                ) : preview.isPending || (!preview.data && !preview.isError) ? (
                  <Skeleton className="h-8 w-32" />
                ) : preview.isError ? (
                  <p className="text-error-base text-paragraph-sm">{(preview.error as Error).message}</p>
                ) : (
                  <span className="text-text-strong text-[28px] font-medium leading-8 tracking-tight tabular-nums">
                    {tp('clients', preview.data?.count ?? 0)}
                  </span>
                )}
                <p className="text-text-soft text-paragraph-xs">{t('segEditor.preview.hint')}</p>
              </div>
            </aside>
          </div>

          <CrmFormFooter>
            <Button type="button" variant="secondary" mode="outline" size="xs" onClick={() => navigate(listHref)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="primary" size="xs" isLoading={create.isPending} onClick={submit}>
              {t('segEditor.create')}
            </Button>
          </CrmFormFooter>
        </div>

        <UnsavedChangesAlertDialog
          show={blocker.state === 'blocked'}
          description={t('segEditor.unsaved')}
          onCancel={() => blocker.reset?.()}
          onProceed={() => blocker.proceed?.()}
        />
      </DashboardLayout>
    </>
  );
}
