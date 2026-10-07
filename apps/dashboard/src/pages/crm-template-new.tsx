import { useState } from 'react';
import { RiErrorWarningFill, RiMailLine } from 'react-icons/ri';
import { useNavigate } from 'react-router-dom';
import { t } from '@/components/crm/crm-i18n';
import { CrmBreadcrumbHeader, CrmFormFooter } from '@/components/crm/crm-page';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Label } from '@/components/primitives/label';
import { showErrorToast } from '@/components/primitives/sonner-helpers';
import { Textarea } from '@/components/primitives/textarea';
import { useEnvironment } from '@/context/environment/hooks';
import { useCreateCrmTemplate } from '@/hooks/use-crm-templates';
import { buildRoute, ROUTES } from '@/utils/routes';
import { cn } from '@/utils/ui';

// izipush-crm — création d'un template, étape 1 sur 2 : nom, description, objet. L'étape 2 est l'éditeur plein écran.

function StepPill({ index, label, current }: { index: number; label: string; current: boolean }) {
  return (
    <li className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
      <span
        className={cn(
          'text-label-xs flex size-6 items-center justify-center rounded-full font-medium',
          current
            ? 'bg-primary-base text-static-white'
            : 'bg-bg-weak text-text-sub shadow-[0px_0px_0px_1px_#FFF,0px_0px_0px_2px_#E1E4EA]'
        )}
        aria-hidden
      >
        {index}
      </span>
      <span className={cn('text-label-sm', current ? 'text-text-strong' : 'text-text-soft')}>{label}</span>
    </li>
  );
}

export function CrmTemplateNewPage() {
  const navigate = useNavigate();
  const { currentEnvironment } = useEnvironment();
  const environmentSlug = currentEnvironment?.slug ?? '';
  const listHref = buildRoute(ROUTES.CRM_TEMPLATES, { environmentSlug });
  const create = useCreateCrmTemplate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [attempted, setAttempted] = useState(false);
  const nameError = attempted && !name.trim() ? t('templateNew.nameRequired') : undefined;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setAttempted(true);
    if (!name.trim()) return;

    try {
      const template = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        subject: subject.trim() || undefined,
      });
      navigate(buildRoute(ROUTES.CRM_TEMPLATE_EDIT, { environmentSlug, templateId: template._id }), { replace: true });
    } catch (error) {
      showErrorToast((error as Error).message, t('templateNew.toast.failed'));
    }
  };

  return (
    <>
      <PageMeta title={t('templateNew.title')} />
      <DashboardLayout
        headerStartItems={
          <CrmBreadcrumbHeader
            parentLabel={t('nav.templates')}
            parentTo={listHref}
            current={name.trim() || t('templateNew.title')}
            icon={RiMailLine}
          />
        }
      >
        <form className="flex min-h-full flex-col" onSubmit={submit}>
          <div className="mx-auto flex w-full max-w-[600px] flex-1 flex-col gap-8 px-4 py-10">
            <ol className="flex items-center gap-3" aria-label={t('templateNew.step', { current: 1 })}>
              <StepPill index={1} label={t('templateNew.step1')} current />
              <li className="bg-stroke-soft h-px w-10" aria-hidden />
              <StepPill index={2} label={t('templateNew.step2')} current={false} />
            </ol>

            <div className="flex flex-col gap-1">
              <h1 className="text-text-strong text-[20px] font-medium leading-7 tracking-tight">
                {t('templateNew.title')}
              </h1>
              <p className="text-text-soft text-paragraph-sm">{t('templateNew.intro')}</p>
            </div>

            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-name" className="text-label-sm text-text-strong">
                  {t('templateEditor.name')}
                </Label>
                <Input
                  id="template-name"
                  autoFocus
                  value={name}
                  placeholder={t('templateEditor.namePlaceholder')}
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
                <Label htmlFor="template-description" className="text-label-sm text-text-strong">
                  {t('segEditor.description.label')}{' '}
                  <span className="text-text-soft font-normal">({t('common.optional')})</span>
                </Label>
                <Textarea
                  id="template-description"
                  rows={3}
                  value={description}
                  placeholder={t('templateNew.descriptionPlaceholder')}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-subject" className="text-label-sm text-text-strong">
                  {t('templateEditor.subject')}{' '}
                  <span className="text-text-soft font-normal">({t('common.optional')})</span>
                </Label>
                <Input
                  id="template-subject"
                  value={subject}
                  placeholder={t('templateEditor.subjectPlaceholder')}
                  onChange={(event) => setSubject(event.target.value)}
                />
                <p className="text-text-soft text-paragraph-xs">{t('templateNew.subjectHint')}</p>
              </div>
            </div>
          </div>

          <CrmFormFooter hint={t('templateNew.step', { current: 1 })}>
            <Button type="button" variant="secondary" mode="outline" size="xs" onClick={() => navigate(listHref)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="xs" isLoading={create.isPending}>
              {t('templateNew.continue')}
            </Button>
          </CrmFormFooter>
        </form>
      </DashboardLayout>
    </>
  );
}
