import { expect } from 'chai';

import { nextCronRun } from './next-run';

describe('nextCronRun', () => {
  it('le lundi à 9 h, heure d’Abidjan (UTC)', () => {
    // Dimanche 13 septembre 2026 → lundi 14 à 09:00 UTC.
    const next = nextCronRun('0 9 * * 1', 'Africa/Abidjan', new Date('2026-09-13T10:00:00.000Z'));

    expect(next.toISOString()).to.equal('2026-09-14T09:00:00.000Z');
  });

  it('respecte le fuseau (9 h à Paris = 7 h UTC en été)', () => {
    const next = nextCronRun('0 9 * * *', 'Europe/Paris', new Date('2026-09-14T06:00:00.000Z'));

    expect(next.toISOString()).to.equal('2026-09-14T07:00:00.000Z');
  });

  it('strictement après la date de référence', () => {
    const next = nextCronRun('0 9 * * *', 'Africa/Abidjan', new Date('2026-09-14T09:00:00.000Z'));

    expect(next.toISOString()).to.equal('2026-09-15T09:00:00.000Z');
  });
});
