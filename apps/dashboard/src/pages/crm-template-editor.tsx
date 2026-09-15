import { init, type TemplaticalEditor } from '@templatical/editor';
import '@templatical/editor/style.css';
import { useEffect, useRef, useState } from 'react';
import { RiMailLine } from 'react-icons/ri';
import { useNavigate, useParams } from 'react-router-dom';
import { crmLocale, t, tp } from '@/components/crm/crm-i18n';
import { CrmBreadcrumbHeader } from '@/components/crm/crm-page';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmTemplate, useSaveCrmTemplate } from '@/hooks/use-crm-templates';
import { buildRoute, ROUTES } from '@/utils/routes';

// izipush-crm — conception d'un template email avec l'éditeur templatical (JSON → MJML → HTML).

type TemplateContent = NonNullable<Parameters<typeof init>[0]['content']>;

/** Variables disponibles, au format Novu (liquid) : rendues à l'envoi pour chaque client. */
const MERGE_TAGS = [
  { label: t('mergeTag.firstName'), value: '{{subscriber.firstName}}', group: t('mergeTag.group.client') },
  { label: t('mergeTag.lastName'), value: '{{subscriber.lastName}}', group: t('mergeTag.group.client') },
  { label: t('mergeTag.email'), value: '{{subscriber.email}}', group: t('mergeTag.group.client') },
  { label: t('mergeTag.country'), value: '{{subscriber.data.country_code}}', group: t('mergeTag.group.client') },
  {
    label: t('mergeTag.unsubscribe'),
    value: '{{subscriber.data.unsubscribe_url}}',
    group: t('mergeTag.group.marketing'),
  },
  { label: t('mergeTag.campaignData'), value: '{{payload.offre}}', group: t('mergeTag.group.campaign') },
];

export function CrmTemplateEditorPage() {
  const { templateId: routeId = 'new' } = useParams<{ templateId: string }>();
  const isNew = routeId === 'new';
  const navigate = useNavigate();
  const { currentEnvironment } = useEnvironment();
  const { data: template, isLoading } = useCrmTemplate(isNew ? undefined : routeId);
  const save = useSaveCrmTemplate();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<TemplaticalEditor | undefined>(undefined);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setSubject(template.subject ?? '');
    }
  }, [template]);

  useEffect(() => {
    if (!container.current || (!isNew && !template)) return undefined;

    let cancelled = false;
    let instance: TemplaticalEditor | undefined;

    void init({
      container: container.current,
      content: template?.design as TemplateContent | undefined,
      locale: crmLocale,
      mergeTags: { syntax: 'liquid', tags: MERGE_TAGS, autocomplete: true },
    }).then((created) => {
      if (cancelled) {
        created.unmount();

        return;
      }
      instance = created;
      editor.current = created;
      setReady(true);
    });

    return () => {
      cancelled = true;
      instance?.unmount();
      editor.current = undefined;
    };
  }, [isNew, template]);

  const listHref = buildRoute(ROUTES.CRM_TEMPLATES, { environmentSlug: currentEnvironment?.slug ?? '' });

  const submit = async () => {
    if (!editor.current) return;

    try {
      const design = editor.current.getContent() as unknown as Record<string, unknown>;
      const mjml = await editor.current.toMjml();
      const { default: mjml2html } = await import('mjml-browser');
      const { html, errors } = mjml2html(mjml, { validationLevel: 'soft' });
      if (!html) throw new Error(errors?.[0]?.message ?? t('templateEditor.renderFailed'));

      const saved = await save.mutateAsync({
        templateId: isNew ? undefined : routeId,
        body: { name, subject: subject || undefined, design, html },
      });

      showSuccessToast(
        saved.propagatedSteps
          ? t('templateEditor.toast.propagated', { steps: tp('steps', saved.propagatedSteps) })
          : t('templateEditor.toast.saved')
      );

      if (isNew) {
        navigate(
          buildRoute(ROUTES.CRM_TEMPLATE_EDIT, {
            environmentSlug: currentEnvironment?.slug ?? '',
            templateId: saved._id,
          }),
          { replace: true }
        );
      }
    } catch (error) {
      showErrorToast((error as Error).message, t('templateEditor.toast.failed'));
    }
  };

  return (
    <>
      <PageMeta title={isNew ? t('templateEditor.newTitle') : (template?.name ?? t('nav.templates'))} />
      <DashboardLayout
        headerStartItems={
          <CrmBreadcrumbHeader
            parentLabel={t('nav.templates')}
            parentTo={listHref}
            current={isNew ? t('templateEditor.newTitle') : template?.name}
            icon={RiMailLine}
            isLoading={!isNew && isLoading}
          />
        }
      >
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-60 flex-1 flex-col gap-1">
              <Label htmlFor="template-name">{t('templateEditor.name')}</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('templateEditor.namePlaceholder')}
              />
            </div>
            <div className="flex min-w-80 flex-[2] flex-col gap-1">
              <Label htmlFor="template-subject">{t('templateEditor.subject')}</Label>
              <Input
                id="template-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={t('templateEditor.subjectPlaceholder')}
              />
            </div>
            <Button variant="primary" size="sm" onClick={submit} disabled={!ready || !name.trim() || save.isPending}>
              {t('common.save')}
            </Button>
          </div>
          {!isNew && template?.usedBySteps ? (
            <p className="text-text-soft text-paragraph-xs">
              {t('templateEditor.usedBy', { steps: tp('steps', template.usedBySteps) })}
            </p>
          ) : null}
          {!isNew && isLoading && <p className="text-text-soft text-paragraph-sm">{t('common.loading')}</p>}
          <div ref={container} className="min-h-[70vh] flex-1 overflow-hidden rounded-lg border" />
        </div>
      </DashboardLayout>
    </>
  );
}
