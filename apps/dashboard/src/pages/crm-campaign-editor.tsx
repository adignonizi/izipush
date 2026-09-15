import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RiAddLine,
  RiArrowRightUpLine,
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningFill,
  RiMegaphoneLine,
} from 'react-icons/ri';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import type { CrmCampaign, CrmSchedule, CrmScheduleMode, CrmSegment } from '@/api/crm';
import { ActivateCampaignDialog } from '@/components/crm/activate-campaign-dialog';
import { formatDateTime, t, tp } from '@/components/crm/crm-i18n';
import {
  describeRecurrence,
  describeSchedule,
  eventLabel,
  SCHEDULE_MODE_LABELS,
  timezoneLabel,
} from '@/components/crm/crm-labels';
import { CrmBreadcrumbHeader, CrmFormFooter, CrmSection } from '@/components/crm/crm-page';
import {
  buildCron,
  CRM_TIMEZONES,
  DEFAULT_RECURRENCE,
  isPlausibleCron,
  parseCron,
  type RecurrenceDraft,
  type RecurrenceFrequency,
} from '@/components/crm/crm-schedule';
import { workflowChannels } from '@/components/crm/crm-stats';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import { CompactButton } from '@/components/primitives/button-compact';
import { InlineToast } from '@/components/primitives/inline-toast';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import {
  SegmentedControl,
  SegmentedControlList,
  SegmentedControlTrigger,
} from '@/components/primitives/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/select';
import { Skeleton } from '@/components/primitives/skeleton';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { UnsavedChangesAlertDialog } from '@/components/unsaved-changes-alert-dialog';
import { useEnvironment } from '@/context/environment/hooks';
import { useBeforeUnload } from '@/hooks/use-before-unload';
import {
  useCreateCrmCampaign,
  useCrmCampaign,
  useCrmFields,
  useCrmSegments,
  usePreviewCrmSegment,
  useSetCrmCampaignState,
  useUpdateCrmCampaign,
} from '@/hooks/use-crm';
import { useFetchWorkflows } from '@/hooks/use-fetch-workflows';
import { buildRoute, ROUTES } from '@/utils/routes';
import { cn } from '@/utils/ui';

// izipush-crm — création et modification d'une campagne, en quatre étapes : audience, message, envoi, vérification.

const STEPS = ['audience', 'message', 'schedule', 'review'] as const;
type Step = (typeof STEPS)[number];

const STEP_TEXT: Record<Step, { title: string; hint: string }> = {
  audience: { title: t('step.audience'), hint: t('step.audience.hint') },
  message: { title: t('step.message'), hint: t('step.message.hint') },
  schedule: { title: t('step.schedule'), hint: t('step.schedule.hint') },
  review: { title: t('step.review'), hint: t('step.review.hint') },
};

const MODES: CrmScheduleMode[] = ['immediate', 'scheduled', 'recurring', 'on_event'];
const FREQUENCIES: RecurrenceFrequency[] = ['daily', 'weekly', 'monthly', 'custom'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

type PayloadRow = { key: string; value: string };

type Draft = {
  name: string;
  segmentId?: string;
  workflowKey?: string;
  mode: CrmScheduleMode;
  /** Valeur d'un champ datetime-local (heure locale). */
  at: string;
  recurrence: RecurrenceDraft;
  timezone: string;
  eventName?: string;
  payload: PayloadRow[];
};

const EMPTY_DRAFT: Draft = {
  name: '',
  mode: 'immediate',
  at: '',
  recurrence: DEFAULT_RECURRENCE,
  timezone: 'Africa/Abidjan',
  payload: [],
};

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function draftFromCampaign(campaign: CrmCampaign): Draft {
  return {
    name: campaign.name,
    segmentId: campaign.segmentId,
    workflowKey: campaign.workflowKey,
    mode: campaign.schedule.mode,
    at: toLocalInput(campaign.schedule.at),
    recurrence: parseCron(campaign.schedule.cron),
    timezone: campaign.schedule.timezone ?? 'Africa/Abidjan',
    eventName: campaign.schedule.eventName,
    payload: Object.entries(campaign.payload ?? {}).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    })),
  };
}

function scheduleOf(draft: Draft): CrmSchedule {
  switch (draft.mode) {
    case 'scheduled':
      return { mode: 'scheduled', at: draft.at ? new Date(draft.at).toISOString() : undefined };
    case 'recurring':
      return { mode: 'recurring', cron: buildCron(draft.recurrence), timezone: draft.timezone };
    case 'on_event':
      return { mode: 'on_event', eventName: draft.eventName };
    default:
      return { mode: 'immediate' };
  }
}

function payloadOf(draft: Draft): Record<string, string> | undefined {
  const entries = draft.payload.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value] as const);

  return entries.length ? Object.fromEntries(entries) : undefined;
}

type Errors = Partial<Record<'name' | 'segmentId' | 'workflowKey' | 'at' | 'days' | 'cron' | 'eventName', string>>;

function validate(step: Step, draft: Draft): Errors {
  const errors: Errors = {};

  if (step === 'audience') {
    if (!draft.name.trim()) errors.name = t('editor.validation.name');
    if (!draft.segmentId) errors.segmentId = t('editor.validation.segment');
  }

  if (step === 'message' && !draft.workflowKey) errors.workflowKey = t('editor.validation.workflow');

  if (step === 'schedule') {
    if (draft.mode === 'scheduled' && (!draft.at || new Date(draft.at).getTime() <= Date.now())) {
      errors.at = t('editor.validation.at');
    }
    if (draft.mode === 'recurring') {
      if (draft.recurrence.frequency === 'weekly' && draft.recurrence.weekdays.length === 0) {
        errors.days = t('editor.validation.days');
      }
      if (draft.recurrence.frequency === 'custom' && !isPlausibleCron(draft.recurrence.cron)) {
        errors.cron = t('editor.validation.cron');
      }
    }
    if (draft.mode === 'on_event' && !draft.eventName) errors.eventName = t('editor.validation.event');
  }

  return errors;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p className="text-error-base text-paragraph-xs flex items-center gap-1" role="alert">
      <RiErrorWarningFill className="size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-text-soft text-paragraph-xs">{children}</p>;
}

function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id?: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-label-sm text-text-strong">
        {label}
        {optional && <span className="text-text-soft ml-1 font-normal">({t('common.optional')})</span>}
      </Label>
      {children}
      {error ? <FieldError message={error} /> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

function StepRail({
  current,
  reachable,
  completed,
  onSelect,
}: {
  current: Step;
  reachable: (step: Step) => boolean;
  completed: (step: Step) => boolean;
  onSelect: (step: Step) => void;
}) {
  return (
    <nav aria-label={t('step.progress', { current: STEPS.indexOf(current) + 1, total: STEPS.length })}>
      <ol className="flex flex-col gap-1">
        {STEPS.map((step, index) => {
          const isCurrent = step === current;
          const isDone = completed(step) && !isCurrent;

          return (
            <li key={step}>
              <button
                type="button"
                disabled={!reachable(step)}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onSelect(step)}
                className={cn(
                  'focus-visible:ring-stroke-strong flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2',
                  isCurrent ? 'bg-bg-weak' : 'hover:bg-neutral-alpha-50',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                <span
                  className={cn(
                    'text-label-xs flex size-6 shrink-0 items-center justify-center rounded-full font-medium',
                    isDone
                      ? 'bg-success-base text-static-white'
                      : isCurrent
                        ? 'bg-primary-base text-static-white'
                        : 'bg-bg-weak text-text-sub shadow-[0px_0px_0px_1px_#FFF,0px_0px_0px_2px_#E1E4EA]'
                  )}
                  aria-hidden
                >
                  {isDone ? <RiCheckLine className="size-3.5" /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={cn('text-label-sm', isCurrent ? 'text-text-strong' : 'text-text-sub')}>
                    {STEP_TEXT[step].title}
                  </span>
                  <span className="text-text-soft text-paragraph-xs">{STEP_TEXT[step].hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SegmentSummary({ segment }: { segment: CrmSegment }) {
  const preview = usePreviewCrmSegment();
  const { mutate } = preview;

  useEffect(() => {
    if (!segment.frozen) mutate(segment.audience);
  }, [segment._id, segment.frozen, segment.audience, mutate]);

  const count = segment.frozen ? segment.memberCount : preview.data?.count;

  return (
    <div className="border-stroke-soft flex flex-col gap-1 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-label-sm text-text-strong">{segment.name}</span>
        {preview.isPending ? (
          <span className="text-text-soft text-paragraph-xs">{t('editor.segment.counting')}</span>
        ) : count !== undefined ? (
          <span className="text-text-sub text-label-sm tabular-nums">
            {segment.frozen ? tp('clients', count) : t('editor.segment.today', { clients: tp('clients', count) })}
          </span>
        ) : null}
      </div>
      <span className="text-text-soft text-paragraph-xs">
        {segment.frozen
          ? t('editor.segment.frozen', { date: formatDateTime(segment.frozenAt) })
          : t('editor.segment.dynamic')}
      </span>
      {segment.status === 'freezing' && (
        <span className="text-warning-base text-paragraph-xs">{t('editor.segment.freezing')}</span>
      )}
    </div>
  );
}

function ReviewRow({ label, children, onChange }: { label: string; children: React.ReactNode; onChange: () => void }) {
  return (
    <div className="border-stroke-soft grid grid-cols-[96px_1fr_auto] items-start gap-4 border-b py-3 last:border-b-0">
      <dt className="text-text-soft text-label-sm">{label}</dt>
      <dd className="text-text-strong text-paragraph-sm min-w-0">{children}</dd>
      <Button type="button" variant="secondary" mode="ghost" size="2xs" onClick={onChange}>
        {t('editor.review.change')}
      </Button>
    </div>
  );
}

export function CrmCampaignEditorPage() {
  const { campaignId } = useParams<{ campaignId?: string }>();
  const isEdit = !!campaignId;
  const navigate = useNavigate();
  const { currentEnvironment } = useEnvironment();
  const environmentSlug = currentEnvironment?.slug ?? '';
  const listHref = buildRoute(ROUTES.CRM_CAMPAIGNS, { environmentSlug });

  const { data: campaign, isLoading: isLoadingCampaign } = useCrmCampaign(campaignId);
  const { data: segments = [], isLoading: isLoadingSegments } = useCrmSegments();
  const { data: fields } = useCrmFields();
  const { data: workflowsData, isLoading: isLoadingWorkflows } = useFetchWorkflows({ limit: 100 });
  const workflows = workflowsData?.workflows ?? [];

  const create = useCreateCrmCampaign();
  const update = useUpdateCrmCampaign();
  const setState = useSetCrmCampaignState();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [initial, setInitial] = useState(JSON.stringify(EMPTY_DRAFT));
  const [step, setStep] = useState<Step>('audience');
  const [attempted, setAttempted] = useState<Partial<Record<Step, boolean>>>({});
  const [confirmActivate, setConfirmActivate] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    if (!campaign) return;
    const loaded = draftFromCampaign(campaign);
    setDraft(loaded);
    setInitial(JSON.stringify(loaded));
  }, [campaign]);

  const isLocked = isEdit && campaign?.status === 'active';
  const isDirty = JSON.stringify(draft) !== initial;
  const isSaving = create.isPending || update.isPending || setState.isPending;

  useBeforeUnload(isDirty && !leaving.current);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname
  );

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setRecurrence = (patch: Partial<RecurrenceDraft>) =>
    setDraft((current) => ({ ...current, recurrence: { ...current.recurrence, ...patch } }));

  const segment = segments.find((candidate) => candidate._id === draft.segmentId);
  const usableSegments = segments.filter(
    (candidate) => candidate.status === 'ready' || candidate.status === 'freezing'
  );
  const workflow = workflows.find((candidate) => candidate.workflowId === draft.workflowKey);

  const stepIndex = STEPS.indexOf(step);
  const errors = attempted[step] ? validate(step, draft) : {};
  const isStepValid = (candidate: Step) => Object.keys(validate(candidate, draft)).length === 0;
  const reachable = (candidate: Step) => STEPS.slice(0, STEPS.indexOf(candidate)).every(isStepValid);

  const goNext = () => {
    setAttempted((current) => ({ ...current, [step]: true }));
    if (!isStepValid(step)) return;
    setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);
  };

  const recurrencePreview = useMemo(() => {
    if (draft.mode !== 'recurring') return '';

    return t('schedule.describe.tz', {
      text: describeRecurrence(buildCron(draft.recurrence)),
      tz: timezoneLabel(draft.timezone),
    });
  }, [draft.mode, draft.recurrence, draft.timezone]);

  const leaveTo = (href: string) => {
    leaving.current = true;
    navigate(href);
  };

  const save = async (activate: boolean) => {
    const body = {
      name: draft.name.trim(),
      segmentId: draft.segmentId ?? '',
      workflowKey: draft.workflowKey ?? '',
      schedule: scheduleOf(draft),
      payload: payloadOf(draft),
    };

    let saved: CrmCampaign;
    try {
      saved = isEdit
        ? await update.mutateAsync({ campaignId: campaignId as string, body })
        : await create.mutateAsync(body);
    } catch (error) {
      showErrorToast((error as Error).message, t('editor.toast.failed'));

      return;
    }

    if (activate) {
      try {
        await setState.mutateAsync({ campaignId: saved._id, action: 'activate' });
        showSuccessToast(t('editor.toast.activated'));
      } catch (error) {
        showErrorToast((error as Error).message, t('editor.toast.activateFailed'));
      }
    } else {
      showSuccessToast(isEdit ? t('editor.toast.updated') : t('editor.toast.draft'));
    }

    setConfirmActivate(false);
    leaveTo(buildRoute(ROUTES.CRM_CAMPAIGN_DETAIL, { environmentSlug, campaignId: saved._id }));
  };

  const title = isEdit ? t('editor.editTitle', { name: campaign?.name ?? '' }) : t('editor.newTitle');

  if (isEdit && !isLoadingCampaign && !campaign) {
    return (
      <DashboardLayout
        headerStartItems={<CrmBreadcrumbHeader parentLabel={t('nav.campaigns')} parentTo={listHref} current="—" />}
      >
        <div className="p-6">
          <InlineToast variant="error" description={t('editor.notFound')} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <>
      <PageMeta title={title} />
      <DashboardLayout
        headerStartItems={
          <CrmBreadcrumbHeader
            parentLabel={t('nav.campaigns')}
            parentTo={listHref}
            current={title}
            icon={RiMegaphoneLine}
            isLoading={isEdit && isLoadingCampaign}
          />
        }
      >
        <div className="flex min-h-full flex-col">
          <div className="flex flex-1 flex-col gap-8 px-4 py-6 md:flex-row md:gap-12 md:px-6">
            <aside className="md:sticky md:top-6 md:w-[232px] md:shrink-0 md:self-start">
              <StepRail
                current={step}
                reachable={reachable}
                completed={isStepValid}
                onSelect={(target) => reachable(target) && setStep(target)}
              />
            </aside>

            <div className="flex w-full max-w-[640px] flex-col gap-6">
              {isLocked && <InlineToast variant="warning" description={t('editor.locked')} />}

              {isEdit && isLoadingCampaign ? (
                <div className="flex flex-col gap-4">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <fieldset disabled={isLocked} className="flex flex-col gap-6">
                  {step === 'audience' && (
                    <>
                      <CrmSection title={t('step.audience')} description={t('editor.segment.exclusions')}>
                        <Field
                          id="campaign-name"
                          label={t('editor.name.label')}
                          hint={t('editor.name.hint')}
                          error={errors.name}
                        >
                          <Input
                            id="campaign-name"
                            value={draft.name}
                            placeholder={t('editor.name.placeholder')}
                            aria-invalid={!!errors.name}
                            onChange={(event) => set({ name: event.target.value })}
                          />
                        </Field>

                        <Field id="campaign-segment" label={t('editor.segment.label')} error={errors.segmentId}>
                          {isLoadingSegments ? (
                            <Skeleton className="h-9 w-full" />
                          ) : usableSegments.length === 0 ? (
                            <InlineToast
                              variant="tip"
                              description={t('editor.segment.empty')}
                              ctaLabel={t('editor.segment.create')}
                              onCtaClick={() => leaveTo(buildRoute(ROUTES.CRM_SEGMENT_NEW, { environmentSlug }))}
                            />
                          ) : (
                            <Select value={draft.segmentId} onValueChange={(segmentId) => set({ segmentId })}>
                              <SelectTrigger id="campaign-segment" aria-invalid={!!errors.segmentId}>
                                <SelectValue placeholder={t('editor.segment.placeholder')} />
                              </SelectTrigger>
                              <SelectContent>
                                {usableSegments.map((candidate) => (
                                  <SelectItem key={candidate._id} value={candidate._id}>
                                    {candidate.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </Field>

                        {segment && <SegmentSummary segment={segment} />}

                        {usableSegments.length > 0 && (
                          <Link
                            to={buildRoute(ROUTES.CRM_SEGMENT_NEW, { environmentSlug })}
                            className="text-text-sub text-label-xs hover:text-text-strong flex w-fit items-center gap-1 underline-offset-2 hover:underline"
                          >
                            <RiAddLine className="size-3.5" aria-hidden />
                            {t('editor.segment.create')}
                          </Link>
                        )}
                      </CrmSection>
                    </>
                  )}

                  {step === 'message' && (
                    <CrmSection title={t('step.message')} description={t('editor.workflow.hint')}>
                      <Field id="campaign-workflow" label={t('editor.workflow.label')} error={errors.workflowKey}>
                        {isLoadingWorkflows ? (
                          <Skeleton className="h-9 w-full" />
                        ) : workflows.length === 0 ? (
                          <InlineToast variant="tip" description={t('editor.workflow.empty')} />
                        ) : (
                          <Select value={draft.workflowKey} onValueChange={(workflowKey) => set({ workflowKey })}>
                            <SelectTrigger id="campaign-workflow" aria-invalid={!!errors.workflowKey}>
                              <SelectValue placeholder={t('editor.workflow.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                              {workflows.map((candidate) => (
                                <SelectItem key={candidate._id} value={candidate.workflowId}>
                                  <span className="flex items-center gap-2">
                                    {candidate.name}
                                    <span className="text-text-soft text-paragraph-xs">
                                      {workflowChannels(candidate.stepTypeOverviews).join(' · ')}
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </Field>

                      {draft.workflowKey && !workflow && !isLoadingWorkflows && (
                        <InlineToast
                          variant="warning"
                          description={t('editor.workflow.missing', { key: draft.workflowKey })}
                        />
                      )}

                      {workflow && (
                        <div className="border-stroke-soft flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {workflowChannels(workflow.stepTypeOverviews).map((channel) => (
                              <Badge key={channel} variant="lighter" color="gray" size="sm">
                                {channel}
                              </Badge>
                            ))}
                          </div>
                          <Link
                            to={buildRoute(ROUTES.EDIT_WORKFLOW, { environmentSlug, workflowSlug: workflow.slug })}
                            target="_blank"
                            className="text-text-sub text-label-xs hover:text-text-strong flex items-center gap-1"
                          >
                            {t('editor.workflow.open')}
                            <RiArrowRightUpLine className="size-3.5" aria-hidden />
                          </Link>
                        </div>
                      )}

                      <div className="flex flex-col gap-3 pt-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-label-sm text-text-strong">
                            {t('editor.payload.title')}{' '}
                            <span className="text-text-soft font-normal">({t('common.optional')})</span>
                          </span>
                          <FieldHint>{t('editor.payload.hint')}</FieldHint>
                        </div>
                        {draft.payload.map((row, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              aria-label={t('editor.payload.key')}
                              placeholder={t('editor.payload.key')}
                              value={row.key}
                              className="max-w-[200px]"
                              onChange={(event) =>
                                set({
                                  payload: draft.payload.map((current, i) =>
                                    i === index ? { ...current, key: event.target.value.replace(/\s/g, '_') } : current
                                  ),
                                })
                              }
                            />
                            <Input
                              aria-label={t('editor.payload.value')}
                              placeholder={t('editor.payload.value')}
                              value={row.value}
                              onChange={(event) =>
                                set({
                                  payload: draft.payload.map((current, i) =>
                                    i === index ? { ...current, value: event.target.value } : current
                                  ),
                                })
                              }
                            />
                            <CompactButton
                              icon={RiCloseLine}
                              variant="ghost"
                              type="button"
                              aria-label={t('editor.payload.remove')}
                              onClick={() => set({ payload: draft.payload.filter((_, i) => i !== index) })}
                            />
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="secondary"
                          mode="outline"
                          size="xs"
                          leadingIcon={RiAddLine}
                          className="w-fit"
                          onClick={() => set({ payload: [...draft.payload, { key: '', value: '' }] })}
                        >
                          {t('editor.payload.add')}
                        </Button>
                      </div>
                    </CrmSection>
                  )}

                  {step === 'schedule' && (
                    <CrmSection title={t('editor.schedule.label')}>
                      <SegmentedControl
                        value={draft.mode}
                        onValueChange={(mode) => set({ mode: mode as CrmScheduleMode })}
                      >
                        <SegmentedControlList
                          className="bg-bg-muted w-fit rounded-[5px] p-1"
                          floatingBgClassName="rounded-[1px]"
                        >
                          {MODES.map((mode) => (
                            <SegmentedControlTrigger key={mode} value={mode} className="text-label-xs px-3">
                              {SCHEDULE_MODE_LABELS[mode]}
                            </SegmentedControlTrigger>
                          ))}
                        </SegmentedControlList>
                      </SegmentedControl>

                      {draft.mode === 'immediate' && <FieldHint>{t('editor.schedule.immediate.hint')}</FieldHint>}

                      {draft.mode === 'scheduled' && (
                        <Field
                          id="campaign-at"
                          label={t('editor.schedule.at.label')}
                          hint={t('editor.schedule.at.hint')}
                          error={errors.at}
                        >
                          <Input
                            id="campaign-at"
                            type="datetime-local"
                            className="max-w-[260px]"
                            value={draft.at}
                            min={toLocalInput(new Date().toISOString())}
                            aria-invalid={!!errors.at}
                            onChange={(event) => set({ at: event.target.value })}
                          />
                        </Field>
                      )}

                      {draft.mode === 'recurring' && (
                        <div className="flex flex-col gap-4">
                          <Field id="campaign-frequency" label={t('editor.schedule.frequency')}>
                            <Select
                              value={draft.recurrence.frequency}
                              onValueChange={(frequency) =>
                                setRecurrence({
                                  frequency: frequency as RecurrenceFrequency,
                                  cron: buildCron(draft.recurrence),
                                })
                              }
                            >
                              <SelectTrigger id="campaign-frequency" className="max-w-[260px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FREQUENCIES.map((frequency) => (
                                  <SelectItem key={frequency} value={frequency}>
                                    {t(`freq.${frequency}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>

                          {draft.recurrence.frequency === 'weekly' && (
                            <Field label={t('editor.schedule.days')} error={errors.days}>
                              <div
                                className="flex flex-wrap gap-1.5"
                                role="group"
                                aria-label={t('editor.schedule.days')}
                              >
                                {WEEKDAYS.map((day) => {
                                  const selected = draft.recurrence.weekdays.includes(day);

                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      aria-pressed={selected}
                                      aria-label={t(`weekday.${day}` as Parameters<typeof t>[0])}
                                      onClick={() =>
                                        setRecurrence({
                                          weekdays: selected
                                            ? draft.recurrence.weekdays.filter((value) => value !== day)
                                            : [...draft.recurrence.weekdays, day].sort(),
                                        })
                                      }
                                      className={cn(
                                        'text-label-xs focus-visible:ring-stroke-strong h-8 min-w-11 rounded-md border px-2 outline-none transition-colors focus-visible:ring-2',
                                        selected
                                          ? 'border-primary-base bg-primary-alpha-10 text-primary-base'
                                          : 'border-stroke-soft text-text-sub hover:bg-neutral-alpha-50'
                                      )}
                                    >
                                      {t(`weekday.short.${day}` as Parameters<typeof t>[0])}
                                    </button>
                                  );
                                })}
                              </div>
                            </Field>
                          )}

                          {draft.recurrence.frequency === 'monthly' && (
                            <Field
                              id="campaign-dom"
                              label={t('editor.schedule.dayOfMonth')}
                              hint={t('editor.schedule.dayOfMonth.hint')}
                            >
                              <Select
                                value={String(draft.recurrence.dayOfMonth)}
                                onValueChange={(value) => setRecurrence({ dayOfMonth: Number(value) })}
                              >
                                <SelectTrigger id="campaign-dom" className="max-w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                                    <SelectItem key={day} value={String(day)}>
                                      {day}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>
                          )}

                          {draft.recurrence.frequency === 'custom' ? (
                            <Field
                              id="campaign-cron"
                              label={t('editor.schedule.cron')}
                              hint={t('editor.schedule.cron.hint')}
                              error={errors.cron}
                            >
                              <Input
                                id="campaign-cron"
                                className="font-code max-w-[260px]"
                                value={draft.recurrence.cron}
                                aria-invalid={!!errors.cron}
                                onChange={(event) => setRecurrence({ cron: event.target.value })}
                              />
                            </Field>
                          ) : (
                            <Field id="campaign-time" label={t('editor.schedule.time')}>
                              <Input
                                id="campaign-time"
                                type="time"
                                className="max-w-[140px]"
                                value={draft.recurrence.time}
                                onChange={(event) => setRecurrence({ time: event.target.value || '09:00' })}
                              />
                            </Field>
                          )}

                          <Field id="campaign-tz" label={t('editor.schedule.timezone')}>
                            <Select value={draft.timezone} onValueChange={(timezone) => set({ timezone })}>
                              <SelectTrigger id="campaign-tz">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CRM_TIMEZONES.map((timezone) => (
                                  <SelectItem key={timezone} value={timezone}>
                                    {timezoneLabel(timezone)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>

                          <p className="bg-bg-weak text-text-sub text-paragraph-sm rounded-lg px-3 py-2">
                            {recurrencePreview}
                          </p>
                        </div>
                      )}

                      {draft.mode === 'on_event' && (
                        <Field
                          id="campaign-event"
                          label={t('editor.schedule.event.label')}
                          hint={t('editor.schedule.event.hint')}
                          error={errors.eventName}
                        >
                          <Select value={draft.eventName} onValueChange={(eventName) => set({ eventName })}>
                            <SelectTrigger
                              id="campaign-event"
                              className="max-w-[320px]"
                              aria-invalid={!!errors.eventName}
                            >
                              <SelectValue placeholder={t('editor.schedule.event.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                              {(fields?.events ?? []).map((eventName) => (
                                <SelectItem key={eventName} value={eventName}>
                                  {eventLabel(eventName)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                    </CrmSection>
                  )}

                  {step === 'review' && (
                    <CrmSection title={t('step.review')} description={t('editor.review.safety')}>
                      <dl className="border-stroke-soft rounded-lg border px-4">
                        <ReviewRow label={t('editor.review.who')} onChange={() => setStep('audience')}>
                          <span className="font-medium">{segment?.name ?? '—'}</span>
                          {segment && (
                            <span className="text-text-soft block text-paragraph-xs">
                              {segment.frozen
                                ? t('editor.segment.frozen', { date: formatDateTime(segment.frozenAt) })
                                : t('editor.segment.dynamic')}
                            </span>
                          )}
                        </ReviewRow>
                        <ReviewRow label={t('editor.review.what')} onChange={() => setStep('message')}>
                          <span className="font-medium">{workflow?.name ?? draft.workflowKey ?? '—'}</span>
                          {workflow && (
                            <span className="text-text-soft block text-paragraph-xs">
                              {workflowChannels(workflow.stepTypeOverviews).join(' · ')}
                            </span>
                          )}
                        </ReviewRow>
                        <ReviewRow label={t('editor.review.when')} onChange={() => setStep('schedule')}>
                          {describeSchedule(scheduleOf(draft))}
                        </ReviewRow>
                        <ReviewRow label={t('editor.review.data')} onChange={() => setStep('message')}>
                          {payloadOf(draft) ? (
                            <span className="font-code text-code-xs text-text-sub">
                              {Object.entries(payloadOf(draft) ?? {})
                                .map(([key, value]) => `${key} = ${value}`)
                                .join(' · ')}
                            </span>
                          ) : (
                            <span className="text-text-soft">{t('editor.review.noData')}</span>
                          )}
                        </ReviewRow>
                      </dl>
                    </CrmSection>
                  )}
                </fieldset>
              )}
            </div>
          </div>

          <CrmFormFooter hint={isEdit ? undefined : t('editor.footer.hint')}>
            {stepIndex > 0 && (
              <Button
                type="button"
                variant="secondary"
                mode="outline"
                size="xs"
                onClick={() => setStep(STEPS[stepIndex - 1])}
              >
                {t('common.previous')}
              </Button>
            )}
            {step !== 'review' ? (
              <Button type="button" variant="primary" size="xs" onClick={goNext} disabled={isLocked}>
                {t('common.continue')}
              </Button>
            ) : isEdit ? (
              <Button
                type="button"
                variant="primary"
                size="xs"
                isLoading={isSaving}
                disabled={isLocked || !STEPS.every(isStepValid)}
                onClick={() => save(false)}
              >
                {t('editor.review.saveChanges')}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  mode="outline"
                  size="xs"
                  isLoading={isSaving && !confirmActivate}
                  disabled={!STEPS.every(isStepValid) || isSaving}
                  onClick={() => save(false)}
                >
                  {t('editor.review.saveDraft')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="xs"
                  disabled={!STEPS.every(isStepValid) || isSaving}
                  onClick={() => setConfirmActivate(true)}
                >
                  {t('editor.review.saveActivate')}
                </Button>
              </>
            )}
          </CrmFormFooter>
        </div>

        <ActivateCampaignDialog
          open={confirmActivate}
          onOpenChange={setConfirmActivate}
          campaign={{ name: draft.name, schedule: scheduleOf(draft) }}
          segmentName={segment?.name}
          onConfirm={() => save(true)}
          isLoading={isSaving}
        />
        <UnsavedChangesAlertDialog
          show={blocker.state === 'blocked'}
          description={t('editor.unsaved')}
          onCancel={() => blocker.reset?.()}
          onProceed={() => blocker.proceed?.()}
        />
      </DashboardLayout>
    </>
  );
}
