import { init, type TemplaticalEditor } from '@templatical/editor';
import '@templatical/editor/style.css';
import { useEffect, useRef, useState } from 'react';
import { RiArrowRightSLine, RiInformationLine, RiMailLine } from 'react-icons/ri';
import { useParams } from 'react-router-dom';
import { crmLocale, t, tp } from '@/components/crm/crm-i18n';
import { CrmBreadcrumbHeader } from '@/components/crm/crm-page';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
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
import { InlineToast } from '@/components/primitives/inline-toast';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { Skeleton } from '@/components/primitives/skeleton';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Textarea } from '@/components/primitives/textarea';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmTemplate, useSaveCrmTemplate } from '@/hooks/use-crm-templates';
import { buildRoute, ROUTES } from '@/utils/routes';
import { cn } from '@/utils/ui';

// izipush-crm — création d'un template, étape 2 sur 2 : conception dans l'éditeur templatical, en plein écran.
// Le menu du dashboard est masqué ; la flèche l'affiche ou le masque. Enregistrement : JSON → MJML → HTML.

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

const hasDesign = (design?: Record<string, unknown>) => !!design && Object.keys(design).length > 0;

function MenuToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? t('templateEditor.hideMenu') : t('templateEditor.showMenu')}
      title={open ? t('templateEditor.hideMenu') : t('templateEditor.showMenu')}
      className="hover:bg-neutral-alpha-50 focus-visible:ring-stroke-strong mr-1 flex size-8 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2"
    >
      <RiArrowRightSLine
        className={cn(
          'text-text-sub size-5 transition-transform duration-200 ease-out motion-reduce:transition-none',
          open && 'rotate-180'
        )}
        aria-hidden
      />
    </button>
  );
}

export function CrmTemplateEditorPage() {
  const { templateId = '' } = useParams<{ templateId: string }>();
  const { currentEnvironment } = useEnvironment();
  const listHref = buildRoute(ROUTES.CRM_TEMPLATES, { environmentSlug: currentEnvironment?.slug ?? '' });
  const { data: template, isLoading, isError } = useCrmTemplate(templateId);
  const save = useSaveCrmTemplate();

  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<TemplaticalEditor | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState({ name: '', description: '' });

  useEffect(() => {
    if (!template) return;
    setSubject(template.subject ?? '');
    setDetails({ name: template.name, description: template.description ?? '' });
  }, [template]);

  // L'éditeur n'est créé qu'une fois par template : l'afficher ou masquer le menu ne le recrée pas.
  const templateLoaded = !!template;
  useEffect(() => {
    if (!container.current || !templateLoaded || !template) return undefined;

    let cancelled = false;
    let instance: TemplaticalEditor | undefined;

    void init({
      container: container.current,
      content: hasDesign(template.design) ? (template.design as TemplateContent) : undefined,
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
    // biome-ignore lint/correctness/useExhaustiveDependencies: recréer l'éditeur seulement quand on change de template
  }, [templateLoaded, template?._id]);

  const submit = async () => {
    if (!editor.current) return;

    try {
      const design = editor.current.getContent() as unknown as Record<string, unknown>;
      const mjml = await editor.current.toMjml();
      const { default: mjml2html } = await import('mjml-browser');
      // MJML 5 : la conversion est asynchrone (sans « await », le HTML restait vide).
      const { html, errors } = await mjml2html(mjml, { validationLevel: 'soft' });
      if (!html) throw new Error(errors?.[0]?.message ?? t('templateEditor.renderFailed'));

      const saved = await save.mutateAsync({ templateId, body: { subject: subject.trim() || undefined, design, html } });

      showSuccessToast(
        saved.propagatedSteps
          ? t('templateEditor.toast.propagated', { steps: tp('steps', saved.propagatedSteps) })
          : t('templateEditor.toast.saved')
      );
    } catch (error) {
      showErrorToast((error as Error).message, t('templateEditor.toast.failed'));
    }
  };

  const saveDetails = async () => {
    try {
      await save.mutateAsync({
        templateId,
        body: { name: details.name.trim(), description: details.description.trim() },
      });
      showSuccessToast(t('templateEditor.toast.detailsSaved'));
      setDetailsOpen(false);
    } catch (error) {
      showErrorToast((error as Error).message, t('templateEditor.toast.failed'));
    }
  };

  return (
    <>
      <PageMeta title={template?.name ?? t('nav.templates')} />
      <DashboardLayout
        showSideNavigation={menuOpen}
        headerStartItems={
          <div className="flex min-w-0 items-center">
            <MenuToggle open={menuOpen} onToggle={() => setMenuOpen((open) => !open)} />
            <CrmBreadcrumbHeader
              parentLabel={t('nav.templates')}
              parentTo={listHref}
              current={template?.name}
              icon={RiMailLine}
              isLoading={isLoading}
            />
          </div>
        }
      >
        {isError ? (
          <div className="p-4">
            <InlineToast variant="error" description={t('templateEditor.notFound')} />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="flex flex-wrap items-end gap-3 px-1">
              <div className="flex min-w-[280px] flex-1 flex-col gap-1">
                <Label htmlFor="template-subject" className="text-label-xs text-text-sub">
                  {t('templateEditor.subject')}
                </Label>
                {isLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : (
                  <Input
                    id="template-subject"
                    size="xs"
                    value={subject}
                    placeholder={t('templateEditor.subjectPlaceholder')}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="secondary"
                mode="outline"
                size="xs"
                leadingIcon={RiInformationLine}
                disabled={!template}
                onClick={() => setDetailsOpen(true)}
              >
                {t('templateEditor.details')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="xs"
                isLoading={save.isPending}
                disabled={!ready}
                onClick={submit}
              >
                {t('common.save')}
              </Button>
            </div>
            {template?.usedBySteps ? (
              <p className="text-text-soft text-paragraph-xs px-1">
                {t('templateEditor.usedBy', { steps: tp('steps', template.usedBySteps) })}
              </p>
            ) : null}
            <div ref={container} className="border-stroke-soft min-h-[70vh] flex-1 overflow-hidden rounded-lg border">
              {!ready && (
                <div className="flex h-full items-center justify-center p-8">
                  <span className="text-text-soft text-paragraph-sm">{t('common.loading')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogPortal>
            <DialogOverlay />
            <DialogContent className="max-w-[480px] p-5">
              <DialogHeader>
                <DialogTitle>{t('templateEditor.detailsTitle')}</DialogTitle>
                <DialogDescription>{t('templateEditor.detailsText')}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="details-name">{t('templateEditor.name')}</Label>
                  <Input
                    id="details-name"
                    value={details.name}
                    onChange={(event) => setDetails((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="details-description">{t('segEditor.description.label')}</Label>
                  <Textarea
                    id="details-description"
                    rows={3}
                    value={details.description}
                    placeholder={t('templateNew.descriptionPlaceholder')}
                    onChange={(event) => setDetails((current) => ({ ...current, description: event.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" mode="outline" size="xs" onClick={() => setDetailsOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="xs"
                  isLoading={save.isPending}
                  disabled={!details.name.trim()}
                  onClick={saveDetails}
                >
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </DialogPortal>
        </Dialog>
      </DashboardLayout>
    </>
  );
}
