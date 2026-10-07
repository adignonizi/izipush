// izipush-crm — planification récurrente en langage courant ⇄ expression cron (5 champs, calculée pour l'API).

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';

export type RecurrenceDraft = {
  frequency: RecurrenceFrequency;
  /** 1 = lundi … 7 = dimanche. */
  weekdays: number[];
  dayOfMonth: number;
  /** HH:MM */
  time: string;
  /** Utilisée seulement en « personnalisée ». */
  cron: string;
};

export const DEFAULT_RECURRENCE: RecurrenceDraft = {
  frequency: 'weekly',
  weekdays: [1],
  dayOfMonth: 1,
  time: '09:00',
  cron: '0 9 * * 1',
};

const SIMPLE_CRON = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|\d(?:,\d)*)$/;

function timeParts(time: string): [number, number] {
  const [hours = '9', minutes = '0'] = time.split(':');

  return [Number(hours), Number(minutes)];
}

export function buildCron(draft: RecurrenceDraft): string {
  if (draft.frequency === 'custom') return draft.cron.trim();

  const [hours, minutes] = timeParts(draft.time);

  if (draft.frequency === 'daily') return `${minutes} ${hours} * * *`;
  if (draft.frequency === 'monthly') return `${minutes} ${hours} ${draft.dayOfMonth} * *`;

  // cron : 0 = dimanche ; ici 7 = dimanche.
  const days = [...new Set(draft.weekdays)].map((day) => day % 7).sort((a, b) => a - b);

  return `${minutes} ${hours} * * ${days.join(',')}`;
}

/** Relit une expression cron ; ce qui ne se décrit pas simplement reste « personnalisée ». */
export function parseCron(cron: string | undefined): RecurrenceDraft {
  const value = (cron ?? '').trim();
  const match = SIMPLE_CRON.exec(value);
  if (!match)
    return {
      ...DEFAULT_RECURRENCE,
      frequency: value ? 'custom' : DEFAULT_RECURRENCE.frequency,
      cron: value || DEFAULT_RECURRENCE.cron,
    };

  const [, minutes, hours, dayOfMonth, weekdays] = match;
  const time = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  const base = { ...DEFAULT_RECURRENCE, time, cron: value };

  if (Number(hours) > 23 || Number(minutes) > 59) return { ...base, frequency: 'custom' };
  if (dayOfMonth !== '*' && weekdays === '*') return { ...base, frequency: 'monthly', dayOfMonth: Number(dayOfMonth) };
  if (dayOfMonth === '*' && weekdays === '*') return { ...base, frequency: 'daily' };
  if (dayOfMonth === '*') {
    const days = weekdays.split(',').map((day) => (Number(day) === 0 ? 7 : Number(day)));
    if (days.every((day) => day >= 1 && day <= 7)) return { ...base, frequency: 'weekly', weekdays: days };
  }

  return { ...base, frequency: 'custom' };
}

/** Contrôle de forme seulement (5 champs) ; l'API valide l'expression complète. */
export function isPlausibleCron(cron: string): boolean {
  return cron.trim().split(/\s+/).length === 5;
}

export const CRM_TIMEZONES = [
  'Africa/Abidjan',
  'Africa/Lagos',
  'Africa/Douala',
  'Africa/Kinshasa',
  'Africa/Lubumbashi',
  'Europe/Paris',
  'UTC',
] as const;

export type CrmTimezone = (typeof CRM_TIMEZONES)[number];
