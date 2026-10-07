import type { CrmCampaignSchedule } from './crm-campaign.entity';

/** Planification invalide : message destiné à la personne qui configure la campagne. */
export class CrmScheduleError extends Error {}

const CRON_FIELD = /^[\d*/,-]+$/;
const DEFAULT_TIMEZONE = 'Africa/Abidjan';

/** Valide et normalise la planification saisie dans le dashboard. */
export function normalizeSchedule(input: unknown, now: Date): CrmCampaignSchedule {
  const schedule = (input ?? {}) as Record<string, unknown>;

  switch (schedule.mode) {
    case 'immediate':
      return { mode: 'immediate' };
    case 'scheduled': {
      const at = new Date(schedule.at as string);
      if (Number.isNaN(at.getTime())) throw new CrmScheduleError('Date de lancement invalide');
      if (at.getTime() <= now.getTime()) throw new CrmScheduleError('La date de lancement doit être dans le futur');

      return { mode: 'scheduled', at };
    }
    case 'recurring': {
      const cron = typeof schedule.cron === 'string' ? schedule.cron.trim().replace(/\s+/g, ' ') : '';
      const fields = cron.split(' ');
      if (fields.length !== 5 || !fields.every((field) => CRON_FIELD.test(field))) {
        throw new CrmScheduleError('Expression cron attendue sur 5 champs (ex. « 0 9 * * 1 » : le lundi à 9 h)');
      }
      const timezone =
        typeof schedule.timezone === 'string' && schedule.timezone ? schedule.timezone : DEFAULT_TIMEZONE;
      if (!isValidTimezone(timezone)) throw new CrmScheduleError(`Fuseau horaire inconnu : ${timezone}`);

      return { mode: 'recurring', cron, timezone };
    }
    case 'on_event': {
      const eventName = typeof schedule.eventName === 'string' ? schedule.eventName.trim() : '';
      if (!eventName) throw new CrmScheduleError('Événement déclencheur manquant');

      return { mode: 'on_event', eventName };
    }
    default:
      throw new CrmScheduleError('Mode de planification inconnu (immédiat, programmé, récurrent ou sur événement)');
  }
}

/**
 * Première échéance à l'activation. null : pas d'échéance fixe (campagne « sur événement »),
 * ou calculée par crm-ingest (campagne récurrente, qui a besoin de l'expression cron).
 */
export function firstRunAt(schedule: CrmCampaignSchedule, now: Date): Date | null {
  switch (schedule.mode) {
    case 'immediate':
      return now;
    case 'scheduled':
      return schedule.at && schedule.at.getTime() > now.getTime() ? schedule.at : now;
    default:
      return null;
  }
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: timezone });

    return true;
  } catch {
    return false;
  }
}
