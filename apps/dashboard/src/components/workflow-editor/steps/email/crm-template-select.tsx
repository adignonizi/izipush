import { EnvironmentTypeEnum } from '@novu/shared';
import { useFormContext } from 'react-hook-form';
import { RiMailSettingsLine } from 'react-icons/ri';
import { getCrmTemplate } from '@/api/crm-templates';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/primitives/form/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/select';
import { showErrorToast } from '@/components/primitives/sonner-helpers';
import { useEnvironment } from '@/context/environment/hooks';
import { useCrmTemplates } from '@/hooks/use-crm-templates';
import { useSaveForm } from '../save-form-context';

// izipush-crm — choix d'un template email CRM dans une étape email : son HTML est copié dans l'étape,
// et chaque nouvelle version du template y est recopiée par l'API.

const NO_TEMPLATE = 'no_crm_template';

export const CrmTemplateSelect = () => {
  const { currentEnvironment } = useEnvironment();
  const { control, setValue } = useFormContext();
  const { data: templates = [], isFetching } = useCrmTemplates();
  const { saveForm } = useSaveForm();

  return (
    <FormField
      control={control}
      name="crmTemplateId"
      render={({ field }) => (
        <FormItem className="w-auto">
          <FormControl>
            <Select
              value={field.value ?? NO_TEMPLATE}
              disabled={isFetching || currentEnvironment?.type !== EnvironmentTypeEnum.DEV}
              onValueChange={async (value) => {
                if (value === NO_TEMPLATE) {
                  field.onChange(null);
                  saveForm({ forceSubmit: true });

                  return;
                }

                try {
                  const template = await getCrmTemplate({ environment: currentEnvironment!, templateId: value });
                  field.onChange(value);
                  setValue('editorType', 'html', { shouldDirty: true });
                  setValue('body', template.html, { shouldDirty: true });
                  if (template.subject) setValue('subject', template.subject, { shouldDirty: true });
                  saveForm({ forceSubmit: true });
                } catch (error) {
                  showErrorToast((error as Error).message, 'Template non appliqué');
                }
              }}
            >
              <SelectTrigger
                size="2xs"
                className="bg-bg-weak border-transparent hover:border-transparent hover:bg-neutral-100 [&_span]:text-neutral-600"
              >
                <RiMailSettingsLine className="text-text-soft mr-2 size-4" />
                <SelectValue placeholder="Template CRM" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE} className="text-paragraph-xs">
                  Sans template CRM
                </SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template._id} value={template._id} className="text-paragraph-xs">
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};
