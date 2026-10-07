import { CrmScheduleError, firstRunAt, normalizeSchedule } from '@novu/dal';
import { expect } from 'chai';

const now = new Date('2026-09-14T12:00:00.000Z');

describe('normalizeSchedule', () => {
  it('programmé : date future obligatoire', () => {
    expect(normalizeSchedule({ mode: 'scheduled', at: '2026-09-20T09:00:00.000Z' }, now)).to.deep.equal({
      mode: 'scheduled',
      at: new Date('2026-09-20T09:00:00.000Z'),
    });
    expect(() => normalizeSchedule({ mode: 'scheduled', at: '2026-09-01T09:00:00.000Z' }, now)).to.throw(
      CrmScheduleError
    );
  });

  it('récurrent : cron sur 5 champs, fuseau par défaut Abidjan', () => {
    expect(normalizeSchedule({ mode: 'recurring', cron: ' 0  9 * * 1 ' }, now)).to.deep.equal({
      mode: 'recurring',
      cron: '0 9 * * 1',
      timezone: 'Africa/Abidjan',
    });
    expect(() => normalizeSchedule({ mode: 'recurring', cron: '0 9 * *' }, now)).to.throw(CrmScheduleError);
    expect(() => normalizeSchedule({ mode: 'recurring', cron: '0 9 * * 1', timezone: 'Mars/Olympus' }, now)).to.throw(
      CrmScheduleError
    );
  });

  it('sur événement : nom obligatoire ; mode inconnu refusé', () => {
    expect(normalizeSchedule({ mode: 'on_event', eventName: 'kyc.approved' }, now)).to.deep.equal({
      mode: 'on_event',
      eventName: 'kyc.approved',
    });
    expect(() => normalizeSchedule({ mode: 'on_event' }, now)).to.throw(CrmScheduleError);
    expect(() => normalizeSchedule({ mode: 'weekly' }, now)).to.throw(CrmScheduleError);
  });
});

describe('firstRunAt', () => {
  it('immédiat → maintenant ; programmé → sa date ; récurrent et événement → calculé ailleurs', () => {
    const at = new Date('2026-09-20T09:00:00.000Z');

    expect(firstRunAt({ mode: 'immediate' }, now)).to.deep.equal(now);
    expect(firstRunAt({ mode: 'scheduled', at }, now)).to.deep.equal(at);
    expect(firstRunAt({ mode: 'recurring', cron: '0 9 * * 1' }, now)).to.equal(null);
    expect(firstRunAt({ mode: 'on_event', eventName: 'kyc.approved' }, now)).to.equal(null);
  });
});
