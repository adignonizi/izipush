import type { CrmCampaign, CrmCampaignRun, CrmProfileOperator, CrmSchedule, CrmSegment } from '@/api/crm';

// izipush-crm — libellés affichés dans les pages CRM.

export const OPERATOR_LABELS: Record<CrmProfileOperator, string> = {
  eq: 'est',
  ne: "n'est pas",
  in: 'fait partie de',
  nin: 'ne fait pas partie de',
  gt: 'supérieur à',
  gte: 'au moins',
  lt: 'inférieur à',
  lte: 'au plus',
  exists: 'est renseigné',
  not_exists: "n'est pas renseigné",
  within_last_days: 'dans les derniers jours',
  more_than_days_ago: 'il y a plus de (jours)',
};

export const ACTIVITY_OPERATOR_LABELS: Record<'gt' | 'gte', string> = { gt: 'supérieur à', gte: 'au moins' };

export const SEGMENT_STATUS: Record<
  CrmSegment['status'],
  { label: string; color: 'green' | 'orange' | 'red' | 'gray' }
> = {
  ready: { label: 'Prêt', color: 'green' },
  freezing: { label: 'Figeage en cours', color: 'orange' },
  deleting: { label: 'Suppression', color: 'gray' },
  failed: { label: 'Échec', color: 'red' },
};

export const CAMPAIGN_STATUS: Record<
  CrmCampaign['status'],
  { label: string; color: 'green' | 'orange' | 'blue' | 'gray' }
> = {
  draft: { label: 'Brouillon', color: 'gray' },
  active: { label: 'Active', color: 'green' },
  paused: { label: 'En pause', color: 'orange' },
  completed: { label: 'Terminée', color: 'blue' },
};

export const RUN_STATUS: Record<CrmCampaignRun['status'], { label: string; color: 'green' | 'orange' | 'red' }> = {
  resolving: { label: 'Calcul de la liste', color: 'orange' },
  triggering: { label: 'Déclenchement', color: 'orange' },
  triggered: { label: 'Envoyée à Novu', color: 'green' },
  failed: { label: 'Échec', color: 'red' },
};

export const SCHEDULE_MODE_LABELS: Record<CrmSchedule['mode'], string> = {
  immediate: 'Immédiat',
  scheduled: 'Programmé',
  recurring: 'Récurrent',
  on_event: 'Sur événement',
};

export function describeSchedule(schedule: CrmSchedule): string {
  switch (schedule.mode) {
    case 'scheduled':
      return `Le ${formatDate(schedule.at)}`;
    case 'recurring':
      return `Cron « ${schedule.cron} » (${schedule.timezone})`;
    case 'on_event':
      return `À chaque ${schedule.eventName}`;
    default:
      return "Dès l'activation";
  }
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';

  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
