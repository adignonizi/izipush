import { parseExpression } from 'cron-parser';

/**
 * Prochaine échéance d'une campagne récurrente, strictement après `after`, dans son fuseau.
 * On repart toujours de « maintenant » : après un arrêt du service, les échéances manquées sont sautées,
 * pas rattrapées en rafale.
 */
export function nextCronRun(cron: string, timezone: string, after: Date): Date {
  return parseExpression(cron, { currentDate: after, tz: timezone }).next().toDate();
}
