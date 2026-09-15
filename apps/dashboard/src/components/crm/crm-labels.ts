import type {
  CrmActivityMetric,
  CrmCampaign,
  CrmCampaignRun,
  CrmProfileField,
  CrmProfileOperator,
  CrmSchedule,
  CrmSegment,
} from '@/api/crm';
import { formatDateTime, formatList, t, tMaybe } from './crm-i18n';
import { parseCron } from './crm-schedule';

// izipush-crm — libellés affichés dans les pages CRM (traduits par crm-i18n).

type BadgeColor = 'green' | 'orange' | 'red' | 'gray' | 'blue';

export const OPERATOR_LABELS: Record<CrmProfileOperator, string> = {
  eq: t('op.eq'),
  ne: t('op.ne'),
  in: t('op.in'),
  nin: t('op.nin'),
  gt: t('op.gt'),
  gte: t('op.gte'),
  lt: t('op.lt'),
  lte: t('op.lte'),
  exists: t('op.exists'),
  not_exists: t('op.not_exists'),
  within_last_days: t('op.within_last_days'),
  more_than_days_ago: t('op.more_than_days_ago'),
};

export const ACTIVITY_OPERATOR_LABELS: Record<'gt' | 'gte', string> = {
  gt: t('activity.op.gt'),
  gte: t('activity.op.gte'),
};

export const SEGMENT_STATUS: Record<CrmSegment['status'], { label: string; color: BadgeColor }> = {
  ready: { label: t('segment.status.ready'), color: 'green' },
  freezing: { label: t('segment.status.freezing'), color: 'orange' },
  deleting: { label: t('segment.status.deleting'), color: 'gray' },
  failed: { label: t('segment.status.failed'), color: 'red' },
};

export const CAMPAIGN_STATUS: Record<CrmCampaign['status'], { label: string; color: BadgeColor }> = {
  draft: { label: t('campaign.status.draft'), color: 'gray' },
  active: { label: t('campaign.status.active'), color: 'green' },
  paused: { label: t('campaign.status.paused'), color: 'orange' },
  completed: { label: t('campaign.status.completed'), color: 'blue' },
};

export const RUN_STATUS: Record<CrmCampaignRun['status'], { label: string; color: 'green' | 'orange' | 'red' }> = {
  resolving: { label: t('run.status.resolving'), color: 'orange' },
  triggering: { label: t('run.status.triggering'), color: 'orange' },
  triggered: { label: t('run.status.triggered'), color: 'green' },
  failed: { label: t('run.status.failed'), color: 'red' },
};

export const SCHEDULE_MODE_LABELS: Record<CrmSchedule['mode'], string> = {
  immediate: t('schedule.mode.immediate'),
  scheduled: t('schedule.mode.scheduled'),
  recurring: t('schedule.mode.recurring'),
  on_event: t('schedule.mode.on_event'),
};

export function fieldLabel(field: Pick<CrmProfileField, 'key' | 'label'>): string {
  return tMaybe(`field.${field.key}`) ?? field.label;
}

export function metricLabel(metric: { key: CrmActivityMetric; label: string }): string {
  return tMaybe(`metric.${metric.key}`) ?? metric.label;
}

export function eventLabel(eventName?: string): string {
  if (!eventName) return '—';

  return tMaybe(`event.${eventName}`) ?? eventName;
}

export function timezoneLabel(timezone?: string): string {
  if (!timezone) return '';

  return tMaybe(`tz.${timezone}`) ?? timezone;
}

export function describeRecurrence(cron?: string): string {
  const draft = parseCron(cron);

  switch (draft.frequency) {
    case 'daily':
      return t('schedule.describe.daily', { time: draft.time });
    case 'weekly':
      return t('schedule.describe.weekly', {
        days: formatList(draft.weekdays.map((day) => t(`weekday.${day}` as Parameters<typeof t>[0]))),
        time: draft.time,
      });
    case 'monthly':
      return t('schedule.describe.monthly', { day: draft.dayOfMonth, time: draft.time });
    default:
      return t('schedule.describe.custom', { cron: cron ?? '' });
  }
}

export function describeSchedule(schedule: CrmSchedule): string {
  switch (schedule.mode) {
    case 'scheduled':
      return t('schedule.describe.scheduled', { date: formatDateTime(schedule.at) });
    case 'recurring': {
      const text = describeRecurrence(schedule.cron);

      return schedule.timezone ? t('schedule.describe.tz', { text, tz: timezoneLabel(schedule.timezone) }) : text;
    }
    case 'on_event':
      return t('schedule.describe.onEvent', { event: eventLabel(schedule.eventName) });
    default:
      return t('schedule.describe.immediate');
  }
}

/** @deprecated nom historique : utiliser formatDateTime. */
export const formatDate = formatDateTime;
