import { RiAddLine, RiDeleteBin2Line } from 'react-icons/ri';
import type {
  CrmActivityCondition,
  CrmCondition,
  CrmConditionGroup,
  CrmFields,
  CrmProfileCondition,
  CrmProfileField,
  CrmProfileOperator,
} from '@/api/crm';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/select';
import { ACTIVITY_OPERATOR_LABELS, OPERATOR_LABELS } from './crm-labels';

// izipush-crm — constructeur de conditions d'un segment (un niveau ; les sous-groupes restent possibles via l'API).

type ConditionBuilderProps = {
  fields: CrmFields;
  value: CrmConditionGroup;
  onChange: (value: CrmConditionGroup) => void;
};

const NO_VALUE: CrmProfileOperator[] = ['exists', 'not_exists'];
const DAYS: CrmProfileOperator[] = ['within_last_days', 'more_than_days_ago'];
const LIST: CrmProfileOperator[] = ['in', 'nin'];

export function ConditionBuilder({ fields, value, onChange }: ConditionBuilderProps) {
  const hasActivity = value.conditions.some((condition) => condition.type === 'activity');

  const update = (index: number, condition: CrmCondition) =>
    onChange({ ...value, conditions: value.conditions.map((current, i) => (i === index ? condition : current)) });
  const remove = (index: number) => onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) });
  const add = (condition: CrmCondition) => onChange({ ...value, conditions: [...value.conditions, condition] });

  const firstField = fields.profile[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-foreground-600">Les clients qui remplissent</span>
        <Select
          value={value.combinator}
          onValueChange={(combinator) => onChange({ ...value, combinator: combinator as 'and' | 'or' })}
          disabled={hasActivity}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">toutes les conditions</SelectItem>
            <SelectItem value="or">au moins une condition</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {hasActivity && (
        <p className="text-foreground-500 text-xs">
          Avec une condition d'activité, toutes les conditions doivent être remplies.
        </p>
      )}

      {value.conditions.length === 0 && (
        <p className="text-foreground-500 rounded-lg border border-dashed p-3 text-sm">
          Aucune condition : le segment contient tous les clients.
        </p>
      )}

      {value.conditions.map((condition, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          {condition.type === 'profile' && (
            <ProfileRow fields={fields} condition={condition} onChange={(next) => update(index, next)} />
          )}
          {condition.type === 'activity' && (
            <ActivityRow fields={fields} condition={condition} onChange={(next) => update(index, next)} />
          )}
          {condition.type === 'group' && (
            <span className="text-foreground-600 text-sm">Sous-groupe de conditions (modifiable via l'API)</span>
          )}
          <Button type="button" variant="secondary" mode="ghost" size="xs" onClick={() => remove(index)}>
            <RiDeleteBin2Line className="size-4" />
          </Button>
        </div>
      ))}

      <div className="flex gap-2">
        {firstField && (
          <Button
            type="button"
            variant="secondary"
            mode="outline"
            size="xs"
            onClick={() => add({ type: 'profile', field: firstField.key, operator: firstField.operators[0] })}
          >
            <RiAddLine className="size-4" /> Condition sur le profil
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          mode="outline"
          size="xs"
          disabled={value.combinator === 'or'}
          onClick={() => add({ type: 'activity', metric: 'volUsd', windowDays: 30, operator: 'gt', value: 0 })}
        >
          <RiAddLine className="size-4" /> Condition sur l'activité
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
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.profile.map((candidate) => (
            <SelectItem key={candidate.key} value={candidate.key}>
              {candidate.label}
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
        <SelectTrigger className="w-52">
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
    return <NumberInput value={condition.value} placeholder="jours" onChange={set} className="w-28" />;
  }

  if (LIST.includes(condition.operator)) {
    const text = Array.isArray(condition.value) ? condition.value.join(', ') : '';

    return (
      <Input
        className="w-64"
        placeholder={field.values ? field.values.map((option) => option.value).join(', ') : 'valeur1, valeur2'}
        value={text}
        onChange={(event) =>
          set(
            event.target.value
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          )
        }
      />
    );
  }

  if (field.type === 'enum' && field.values) {
    return (
      <Select value={typeof condition.value === 'string' ? condition.value : undefined} onValueChange={set}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Choisir" />
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
        <SelectTrigger className="w-28">
          <SelectValue placeholder="Choisir" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Oui</SelectItem>
          <SelectItem value="false">Non</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'number') {
    return <NumberInput value={condition.value} onChange={set} className="w-36" />;
  }

  if (field.type === 'date') {
    const day = typeof condition.value === 'string' ? condition.value.slice(0, 10) : '';

    return (
      <Input
        type="date"
        className="w-44"
        value={day}
        onChange={(event) => set(event.target.value ? new Date(event.target.value).toISOString() : undefined)}
      />
    );
  }

  return (
    <Input
      className="w-52"
      value={typeof condition.value === 'string' ? condition.value : ''}
      onChange={(event) => set(event.target.value)}
    />
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
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.activity.metrics.map((metric) => (
            <SelectItem key={metric.key} value={metric.key}>
              {metric.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={condition.operator}
        onValueChange={(operator) => onChange({ ...condition, operator: operator as 'gt' | 'gte' })}
      >
        <SelectTrigger className="w-32">
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
      />
      <span className="text-foreground-600 text-sm">sur les</span>
      <NumberInput
        value={condition.windowDays}
        onChange={(value) => onChange({ ...condition, windowDays: Number(value ?? 1) })}
        className="w-20"
      />
      <span className="text-foreground-600 text-sm">derniers jours, produit</span>
      <Input
        className="w-32"
        placeholder="tous"
        value={condition.product ?? ''}
        onChange={(event) => onChange({ ...condition, product: event.target.value.trim() || undefined })}
      />
    </>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: unknown;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      type="number"
      className={className}
      placeholder={placeholder}
      value={typeof value === 'number' ? String(value) : ''}
      onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
    />
  );
}
