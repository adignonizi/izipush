import { RiAddLine, RiCloseLine } from 'react-icons/ri';
import type {
  CrmActivityCondition,
  CrmActivityOperator,
  CrmCondition,
  CrmConditionGroup,
  CrmFields,
  CrmProfileCondition,
  CrmProfileField,
  CrmProfileOperator,
} from '@/api/crm';
import { Button } from '@/components/primitives/button';
import { CompactButton } from '@/components/primitives/button-compact';
import { Input } from '@/components/primitives/input';
import { MultiSelect } from '@/components/primitives/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/select';
import { cn } from '@/utils/ui';
import { t } from './crm-i18n';
import { ACTIVITY_OPERATOR_LABELS, fieldLabel, metricLabel, OPERATOR_LABELS } from './crm-labels';

// izipush-crm — critères d'un segment, qui se lisent comme une phrase :
// « Pays est Côte d'Ivoire et Volume (USD) supérieur à 100 sur les 30 derniers jours ».

type ConditionBuilderProps = {
  fields: CrmFields;
  value: CrmConditionGroup;
  onChange: (value: CrmConditionGroup) => void;
};

const NO_VALUE: CrmProfileOperator[] = ['exists', 'not_exists'];
const DAYS: CrmProfileOperator[] = ['within_last_days', 'more_than_days_ago'];
const LIST: CrmProfileOperator[] = ['in', 'nin'];

/** Un critère sans valeur ne peut pas être compté : l'aperçu attend qu'il soit complet. */
export function isConditionComplete(condition: CrmCondition): boolean {
  if (condition.type === 'group') return condition.conditions.every(isConditionComplete);
  if (condition.type === 'activity') return Number.isFinite(condition.value) && condition.windowDays > 0;
  if (NO_VALUE.includes(condition.operator)) return true;
  if (Array.isArray(condition.value)) return condition.value.length > 0;

  return condition.value !== undefined && condition.value !== '';
}

export function ConditionBuilder({ fields, value, onChange }: ConditionBuilderProps) {
  const hasActivity = value.conditions.some((condition) => condition.type === 'activity');
  const firstField = fields.profile[0];

  const update = (index: number, condition: CrmCondition) =>
    onChange({ ...value, conditions: value.conditions.map((current, i) => (i === index ? condition : current)) });
  const remove = (index: number) => onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) });
  const add = (condition: CrmCondition) =>
    onChange({
      ...value,
      combinator: condition.type === 'activity' ? 'and' : value.combinator,
      conditions: [...value.conditions, condition],
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="text-paragraph-sm text-text-sub flex flex-wrap items-center gap-2">
        <span>{t('segEditor.criteria.lead')}</span>
        <Select
          value={value.combinator}
          onValueChange={(combinator) => onChange({ ...value, combinator: combinator as 'and' | 'or' })}
          disabled={hasActivity}
        >
          <SelectTrigger className="w-48" size="2xs" aria-label={t('segEditor.criteria.lead')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">{t('segEditor.combinator.and')}</SelectItem>
            <SelectItem value="or">{t('segEditor.combinator.or')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {hasActivity && (
        <p className="text-text-soft text-paragraph-xs">
          {t('segEditor.activityAll')} {t('segEditor.activityZero')}
        </p>
      )}

      {value.conditions.length === 0 ? (
        <p className="border-stroke-soft text-text-soft text-paragraph-sm rounded-lg border border-dashed px-3 py-4">
          {t('segEditor.criteria.empty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {value.conditions.map((condition, index) => (
            <li key={index} className="flex flex-col gap-2">
              {index > 0 && (
                <span className="text-text-soft text-label-xs pl-3 font-medium uppercase tracking-wider">
                  {value.combinator === 'and' ? t('segEditor.connector.and') : t('segEditor.connector.or')}
                </span>
              )}
              <div className="border-stroke-soft bg-bg-white flex flex-wrap items-center gap-2 rounded-lg border p-2">
                {condition.type === 'profile' && (
                  <ProfileRow fields={fields} condition={condition} onChange={(next) => update(index, next)} />
                )}
                {condition.type === 'activity' && (
                  <ActivityRow fields={fields} condition={condition} onChange={(next) => update(index, next)} />
                )}
                {condition.type === 'group' && (
                  <span className="text-text-soft text-paragraph-sm px-1">{t('segEditor.subgroup')}</span>
                )}
                <CompactButton
                  icon={RiCloseLine}
                  variant="ghost"
                  type="button"
                  className="ml-auto"
                  aria-label={t('segEditor.removeCriterion')}
                  onClick={() => remove(index)}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        {firstField && (
          <Button
            type="button"
            variant="secondary"
            mode="outline"
            size="xs"
            leadingIcon={RiAddLine}
            onClick={() => add({ type: 'profile', field: firstField.key, operator: firstField.operators[0] })}
          >
            {t('segEditor.addProfile')}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          mode="outline"
          size="xs"
          leadingIcon={RiAddLine}
          disabled={value.combinator === 'or' && value.conditions.length > 1}
          onClick={() => add({ type: 'activity', metric: 'volUsd', windowDays: 30, operator: 'gt', value: 0 })}
        >
          {t('segEditor.addActivity')}
        </Button>
      </div>
    </div>
  );
}

function ProfileRow({
  fields,
  condition,
  onChange,
}: {
  fields: CrmFields;
  condition: CrmProfileCondition;
  onChange: (condition: CrmProfileCondition) => void;
}) {
  const field = fields.profile.find((candidate) => candidate.key === condition.field) ?? fields.profile[0];

  return (
    <>
      <Select
        value={field.key}
        onValueChange={(key) => {
          const next = fields.profile.find((candidate) => candidate.key === key) ?? field;
          onChange({ type: 'profile', field: next.key, operator: next.operators[0] });
        }}
      >
        <SelectTrigger className="w-56" size="2xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.profile.map((candidate) => (
            <SelectItem key={candidate.key} value={candidate.key}>
              {fieldLabel(candidate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={condition.operator}
        onValueChange={(operator) =>
          onChange({ ...condition, operator: operator as CrmProfileOperator, value: undefined })
        }
      >
        <SelectTrigger className="w-48" size="2xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.operators.map((operator) => (
            <SelectItem key={operator} value={operator}>
              {OPERATOR_LABELS[operator]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ProfileValue field={field} condition={condition} onChange={onChange} />
    </>
  );
}

function ProfileValue({
  field,
  condition,
  onChange,
}: {
  field: CrmProfileField;
  condition: CrmProfileCondition;
  onChange: (condition: CrmProfileCondition) => void;
}) {
  const set = (value: unknown) => onChange({ ...condition, value });

  if (NO_VALUE.includes(condition.operator)) return null;

  if (DAYS.includes(condition.operator)) {
    return (
      <span className="text-text-sub text-paragraph-sm flex items-center gap-2">
        <NumberInput value={condition.value} onChange={set} className="w-20" label={t('op.days')} />
        {t('op.days')}
      </span>
    );
  }

  if (LIST.includes(condition.operator)) {
    const values = Array.isArray(condition.value) ? condition.value.map(String) : [];

    if (field.values) {
      return (
        <MultiSelect
          className="w-64"
          size="2xs"
          values={values}
          options={field.values}
          placeholder={t('segEditor.value.list')}
          onValuesChange={(next) => set(next)}
        />
      );
    }

    return (
      <div className={cn('shrink-0', 'w-64')}>
        <Input
          size="2xs"
          placeholder={t('segEditor.value.listText')}
          value={values.join(', ')}
          onChange={(event) =>
            set(
              event.target.value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            )
          }
        />
      </div>
    );
  }

  if (field.type === 'enum' && field.values) {
    return (
      <Select value={typeof condition.value === 'string' ? condition.value : undefined} onValueChange={set}>
        <SelectTrigger className="w-56" size="2xs">
          <SelectValue placeholder={t('segEditor.value.choose')} />
        </SelectTrigger>
        <SelectContent>
          {field.values.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'boolean') {
    return (
      <Select
        value={condition.value === undefined ? undefined : String(condition.value)}
        onValueChange={(choice) => set(choice === 'true')}
      >
        <SelectTrigger className="w-28" size="2xs">
          <SelectValue placeholder={t('segEditor.value.choose')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t('segEditor.value.yes')}</SelectItem>
          <SelectItem value="false">{t('segEditor.value.no')}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'number') {
    return <NumberInput value={condition.value} onChange={set} className="w-36" label={fieldLabel(field)} />;
  }

  if (field.type === 'date') {
    const day = typeof condition.value === 'string' ? condition.value.slice(0, 10) : '';

    return (
      <div className={cn('shrink-0', 'w-44')}>
        <Input
          type="date"
          size="2xs"
          aria-label={fieldLabel(field)}
          value={day}
          onChange={(event) => set(event.target.value ? new Date(event.target.value).toISOString() : undefined)}
        />
      </div>
    );
  }

  return (
    <div className={cn('shrink-0', 'w-56')}>
      <Input
        size="2xs"
        aria-label={fieldLabel(field)}
        value={typeof condition.value === 'string' ? condition.value : ''}
        onChange={(event) => set(event.target.value)}
      />
    </div>
  );
}

function ActivityRow({
  fields,
  condition,
  onChange,
}: {
  fields: CrmFields;
  condition: CrmActivityCondition;
  onChange: (condition: CrmActivityCondition) => void;
}) {
  return (
    <>
      <Select
        value={condition.metric}
        onValueChange={(metric) => onChange({ ...condition, metric: metric as CrmActivityCondition['metric'] })}
      >
        <SelectTrigger className="w-52" size="2xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.activity.metrics.map((metric) => (
            <SelectItem key={metric.key} value={metric.key}>
              {metricLabel(metric)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={condition.operator}
        onValueChange={(operator) => onChange({ ...condition, operator: operator as CrmActivityOperator })}
      >
        <SelectTrigger className="w-36" size="2xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.activity.operators.map((operator) => (
            <SelectItem key={operator} value={operator}>
              {ACTIVITY_OPERATOR_LABELS[operator]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <NumberInput
        value={condition.value}
        onChange={(value) => onChange({ ...condition, value: Number(value ?? 0) })}
        className="w-28"
        label={metricLabel({ key: condition.metric, label: condition.metric })}
      />
      <span className="text-text-sub text-paragraph-sm">{t('segEditor.activity.over')}</span>
      <NumberInput
        value={condition.windowDays}
        onChange={(value) => onChange({ ...condition, windowDays: Number(value ?? 1) })}
        className="w-20"
        label={t('segEditor.activity.days')}
      />
      <span className="text-text-sub text-paragraph-sm">
        {t('segEditor.activity.days')}, {t('segEditor.activity.product')}
      </span>
      <div className={cn('shrink-0', 'w-28')}>
        <Input
          size="2xs"
          aria-label={t('segEditor.activity.product')}
          placeholder={t('segEditor.activity.allProducts')}
          value={condition.product ?? ''}
          onChange={(event) => onChange({ ...condition, product: event.target.value.trim() || undefined })}
        />
      </div>
    </>
  );
}

function NumberInput({
  value,
  onChange,
  className,
  label,
}: {
  value: unknown;
  onChange: (value: number | undefined) => void;
  className?: string;
  label: string;
}) {
  return (
    <div className={cn('shrink-0', className)}>
      <Input
        type="number"
        size="2xs"
        aria-label={label}
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </div>
  );
}
