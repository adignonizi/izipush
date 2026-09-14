import { init, type TemplaticalEditor } from '@templatical/editor';
import '@templatical/editor/style.css';
import { useEffect, useRef, useState } from 'react';
import { RiArrowLeftLine } from 'react-icons/ri';
import { useNavigate, useParams } from 'react-router-dom';
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
  { label: 'Prénom', value: '{{subscriber.firstName}}', group: 'Client' },
  { label: 'Nom', value: '{{subscriber.lastName}}', group: 'Client' },
  { label: 'Email', value: '{{subscriber.email}}', group: 'Client' },
  { label: 'Pays', value: '{{subscriber.data.country_code}}', group: 'Client' },
  { label: 'Lien de désinscription', value: '{{subscriber.data.unsubscribe_url}}', group: 'Marketing' },
  { label: 'Donnée de la campagne', value: '{{payload.offre}}', group: 'Campagne' },
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
      locale: 'fr',
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

  const backToList = () =>
    navigate(buildRoute(ROUTES.CRM_TEMPLATES, { environmentSlug: currentEnvironment?.slug ?? '' }));

  const submit = async () => {
    if (!editor.current) return;

    try {
      const design = editor.current.getContent() as unknown as Record<string, unknown>;
      const mjml = await editor.current.toMjml();
      const { default: mjml2html } = await import('mjml-browser');
      const { html, errors } = mjml2html(mjml, { validationLevel: 'soft' });
      if (!html) throw new Error(errors?.[0]?.message ?? 'Rendu HTML impossible');

      const saved = await save.mutateAsync({
        templateId: isNew ? undefined : routeId,
        body: { name, subject: subject || undefined, design, html },
      });

      showSuccessToast(
        saved.propagatedSteps
          ? `Template enregistré et recopié dans ${saved.propagatedSteps} étape(s) email`
          : 'Template enregistré'
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
      showErrorToast((error as Error).message, 'Template non enregistré');
    }
  };

  return (
    <>
      <PageMeta title={isNew ? 'Nouveau template' : (template?.name ?? 'Template')} />
      <DashboardLayout
        headerStartItems={
          <div className="flex items-center gap-2">
            <Button variant="secondary" mode="ghost" size="xs" onClick={backToList}>
              <RiArrowLeftLine className="size-4" />
            </Button>
            <h1 className="text-foreground-950">{isNew ? 'Nouveau template' : (template?.name ?? '…')}</h1>
          </div>
        }
      >
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-60 flex-1 flex-col gap-1">
              <Label>Nom</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Relance KYC" />
            </div>
            <div className="flex min-w-80 flex-[2] flex-col gap-1">
              <Label>Objet proposé aux étapes email</Label>
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="{{subscriber.firstName}}, votre KYC vous attend"
              />
            </div>
            <Button variant="primary" size="sm" onClick={submit} disabled={!ready || !name.trim() || save.isPending}>
              Enregistrer
            </Button>
          </div>
          {!isNew && template?.usedBySteps ? (
            <p className="text-foreground-500 text-xs">
              Utilisé par {template.usedBySteps} étape(s) email : elles seront mises à jour à l'enregistrement.
            </p>
          ) : null}
          {!isNew && isLoading && <p className="text-foreground-500 text-sm">Chargement du template…</p>}
          <div ref={container} className="min-h-[70vh] flex-1 overflow-hidden rounded-lg border" />
        </div>
      </DashboardLayout>
    </>
  );
}
