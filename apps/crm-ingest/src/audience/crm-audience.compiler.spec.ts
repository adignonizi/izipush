import { CrmAudienceError, CrmConditionGroup, compileActivityPipeline, compileAudience } from '@novu/dal';
import { expect } from 'chai';

const now = new Date('2026-09-14T12:00:00.000Z');
const and = (...conditions: CrmConditionGroup['conditions']): CrmConditionGroup => ({
  type: 'group',
  combinator: 'and',
  conditions,
});

describe('compileAudience', () => {
  it('segment vide : tout le monde', () => {
    expect(compileAudience(and(), now)).to.deep.equal({
      profileFilter: {},
      activityConditions: [],
      exclusionConditions: [],
    });
  });

  it('pays ∈ {CI, SN} ET KYC validé ET inscrit il y a plus de 30 jours', () => {
    const { profileFilter } = compileAudience(
      and(
        { type: 'profile', field: 'country_code', operator: 'in', value: ['ci', 'SN'] },
        { type: 'profile', field: 'kyc_status', operator: 'eq', value: 'validated' },
        { type: 'profile', field: 'account_created_at', operator: 'more_than_days_ago', value: 30 }
      ),
      now
    );

    expect(profileFilter).to.deep.equal({
      $and: [
        { 'data.country_code': { $in: ['CI', 'SN'] } },
        { 'data.kyc_status': 'validated' },
        { 'data.account_created_at': { $lt: '2026-08-15T12:00:00.000Z' } },
      ],
    });
  });

  it('sous-groupe « OU » imbriqué', () => {
    const { profileFilter } = compileAudience(
      and(
        { type: 'profile', field: 'lifetime_vol_usd', operator: 'gte', value: 1000 },
        {
          type: 'group',
          combinator: 'or',
          conditions: [
            { type: 'profile', field: 'last_tx_at', operator: 'within_last_days', value: 7 },
            { type: 'profile', field: 'last_login_at', operator: 'within_last_days', value: 7 },
          ],
        }
      ),
      now
    );

    expect(profileFilter).to.deep.equal({
      $and: [
        { 'data.lifetime_vol_usd': { $gte: 1000 } },
        {
          $or: [
            { 'data.last_tx_at': { $gte: '2026-09-07T12:00:00.000Z' } },
            { 'data.last_login_at': { $gte: '2026-09-07T12:00:00.000Z' } },
          ],
        },
      ],
    });
  });

  it('sépare les conditions d’activité du filtre de profil', () => {
    const compiled = compileAudience(
      and(
        { type: 'profile', field: 'country_code', operator: 'eq', value: 'CI' },
        { type: 'activity', metric: 'volUsd', windowDays: 30, product: 'crypto', operator: 'gt', value: 500 }
      ),
      now
    );

    expect(compiled.profileFilter).to.deep.equal({ 'data.country_code': 'CI' });
    expect(compiled.activityConditions).to.have.length(1);
    expect(compiled.exclusionConditions).to.have.length(0);
  });

  it('inactifs : « 0 transaction sur 30 jours » se lit sur la date de dernière transaction, jamais-transacté inclus', () => {
    const compiled = compileAudience(
      and(
        { type: 'profile', field: 'country_code', operator: 'eq', value: 'CI' },
        { type: 'activity', metric: 'tx', windowDays: 30, operator: 'eq', value: 0 }
      ),
      now
    );

    expect(compiled.activityConditions).to.have.length(0);
    expect(compiled.exclusionConditions).to.have.length(0);
    expect(compiled.profileFilter).to.deep.equal({
      $and: [
        { 'data.country_code': 'CI' },
        {
          $or: [{ 'data.last_tx_at': { $lt: '2026-08-16T00:00:00.000Z' } }, { 'data.last_tx_at': { $exists: false } }],
        },
      ],
    });
  });

  it('seuil bas ou produit précis : clients écartés d’après leur activité', () => {
    const compiled = compileAudience(
      and(
        { type: 'activity', metric: 'tx', windowDays: 30, operator: 'lte', value: 2 },
        { type: 'activity', metric: 'volUsd', windowDays: 30, product: 'crypto', operator: 'eq', value: 0 }
      ),
      now
    );

    expect(compiled.activityConditions).to.have.length(0);
    expect(compiled.exclusionConditions).to.have.length(2);
  });

  it('avec une condition impossible sans activité, tout se lit depuis les lignes d’activité', () => {
    const compiled = compileAudience(
      and(
        { type: 'activity', metric: 'tx', windowDays: 30, operator: 'gte', value: 1 },
        { type: 'activity', metric: 'volUsd', windowDays: 30, operator: 'lte', value: 100 }
      ),
      now
    );

    expect(compiled.activityConditions.map((condition) => condition.operator)).to.deep.equal(['gte', 'lte']);
    expect(compiled.exclusionConditions).to.have.length(0);
  });

  it('refuse l’activité hors d’un « ET » de premier niveau, « ≥ 0 » et « < 0 »', () => {
    const activity = {
      type: 'activity' as const,
      metric: 'tx' as const,
      windowDays: 30,
      operator: 'gt' as const,
      value: 0,
    };

    expect(() => compileAudience({ type: 'group', combinator: 'or', conditions: [activity] }, now)).to.throw(
      CrmAudienceError
    );
    expect(() => compileAudience(and({ type: 'group', combinator: 'and', conditions: [activity] }), now)).to.throw(
      CrmAudienceError
    );
    expect(() => compileAudience(and({ ...activity, operator: 'gte', value: 0 }), now)).to.throw(CrmAudienceError);
    expect(() => compileAudience(and({ ...activity, operator: 'lt', value: 0 }), now)).to.throw(CrmAudienceError);
  });

  it('refuse un champ inconnu, un opérateur inadapté ou une valeur du mauvais type', () => {
    expect(() => compileAudience(and({ type: 'profile', field: 'solde', operator: 'eq', value: 1 }), now)).to.throw(
      CrmAudienceError
    );
    expect(() =>
      compileAudience(and({ type: 'profile', field: 'kyc_status', operator: 'gt', value: 'a' }), now)
    ).to.throw(CrmAudienceError);
    expect(() =>
      compileAudience(and({ type: 'profile', field: 'lifetime_tx', operator: 'gt', value: '10' }), now)
    ).to.throw(CrmAudienceError);
  });
});

describe('compileActivityPipeline', () => {
  it('une seule lecture sur la plus grande fenêtre, une somme par condition', () => {
    const pipeline = compileActivityPipeline(
      'env',
      [
        { type: 'activity', metric: 'volUsd', windowDays: 30, product: 'crypto', operator: 'gt', value: 500 },
        { type: 'activity', metric: 'tx', windowDays: 7, operator: 'gte', value: 2 },
      ],
      now
    );

    expect(pipeline[0]).to.deep.equal({ $match: { _environmentId: 'env', day: { $gte: '2026-08-16' } } });
    expect(pipeline[1]).to.deep.equal({
      $group: {
        _id: '$subscriberId',
        m0: {
          $sum: {
            $cond: [{ $and: [{ $gte: ['$day', '2026-08-16'] }, { $eq: ['$product', 'crypto'] }] }, '$volUsd', 0],
          },
        },
        m1: { $sum: { $cond: [{ $and: [{ $gte: ['$day', '2026-09-08'] }] }, '$tx', 0] } },
      },
    });
    expect(pipeline[2]).to.deep.equal({ $match: { m0: { $gt: 500 }, m1: { $gte: 2 } } });
  });

  it('exclusion : clients qui ratent au moins une condition, triés par identifiant', () => {
    const pipeline = compileActivityPipeline(
      'env',
      [
        { type: 'activity', metric: 'tx', windowDays: 30, operator: 'lte', value: 2 },
        { type: 'activity', metric: 'volUsd', windowDays: 30, product: 'crypto', operator: 'eq', value: 0 },
      ],
      now,
      'exclude'
    );

    expect(pipeline[2]).to.deep.equal({ $match: { $or: [{ m0: { $gt: 2 } }, { m1: { $ne: 0 } }] } });
    expect(pipeline[3]).to.deep.equal({ $sort: { _id: 1 } });
  });
});
