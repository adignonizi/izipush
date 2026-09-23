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
        { type: 'activity', metric: 'volUsd', windowDays: 30, productId: 'crypto', operator: 'gt', value: 500 }
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
        { type: 'activity', metric: 'volUsd', windowDays: 30, productId: 'crypto', operator: 'eq', value: 0 }
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
        { type: 'activity', metric: 'volUsd', windowDays: 30, productId: 'crypto', operator: 'gt', value: 500 },
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
            $cond: [{ $and: [{ $gte: ['$day', '2026-08-16'] }, { $eq: ['$productId', 'crypto'] }] }, '$volUsd', 0],
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
        { type: 'activity', metric: 'volUsd', windowDays: 30, productId: 'crypto', operator: 'eq', value: 0 },
      ],
      now,
      'exclude'
    );

    expect(pipeline[2]).to.deep.equal({ $match: { $or: [{ m0: { $gt: 2 } }, { m1: { $ne: 0 } }] } });
    expect(pipeline[3]).to.deep.equal({ $sort: { _id: 1 } });
  });
});

describe('compileAudience · produits', () => {
  it('cross-selling : actif crypto sans le wallet', () => {
    const { profileFilter, activityConditions } = compileAudience(
      and(
        { type: 'activity', metric: 'tx', windowDays: 30, productId: 'crypto', operator: 'gte', value: 2 },
        { type: 'profile', field: 'products', operator: 'has_not', value: 'wallet' }
      ),
      now
    );

    expect(profileFilter).to.deep.equal({ 'data.products': { $ne: 'wallet' } });
    expect(activityConditions).to.have.length(1);
  });

  it('« utilise », « utilise tous » et « utilise l’un de »', () => {
    const one = compileAudience(and({ type: 'profile', field: 'products', operator: 'has', value: 'card' }), now);
    const all = compileAudience(
      and({ type: 'profile', field: 'products', operator: 'has_all', value: ['card', 'wallet'] }),
      now
    );
    const any = compileAudience(
      and({ type: 'profile', field: 'products', operator: 'has_any', value: ['card', 'wallet'] }),
      now
    );

    expect(one.profileFilter).to.deep.equal({ 'data.products': 'card' });
    expect(all.profileFilter).to.deep.equal({ 'data.products': { $all: ['card', 'wallet'] } });
    expect(any.profileFilter).to.deep.equal({ 'data.products': { $in: ['card', 'wallet'] } });
  });

  it('deux conditions sur les produits se combinent sans s’écraser', () => {
    const { profileFilter } = compileAudience(
      and(
        { type: 'profile', field: 'products', operator: 'has', value: 'crypto' },
        { type: 'profile', field: 'products', operator: 'has_not', value: 'wallet' }
      ),
      now
    );

    expect(profileFilter).to.deep.equal({
      $and: [{ 'data.products': 'crypto' }, { 'data.products': { $ne: 'wallet' } }],
    });
  });

  it('refuse « n’utilise pas » seul : aucun index ne peut le résoudre', () => {
    expect(() =>
      compileAudience(and({ type: 'profile', field: 'products', operator: 'has_not', value: 'wallet' }), now)
    ).to.throw(CrmAudienceError, /seule condition/);
  });

  it('refuse un opérateur de liste sur un champ qui n’en est pas un', () => {
    expect(() =>
      compileAudience(and({ type: 'profile', field: 'kyc_status', operator: 'has', value: 'validated' }), now)
    ).to.throw(CrmAudienceError);
  });

  it('nombre de produits : « mono-produit » est un simple filtre indexé', () => {
    const { profileFilter } = compileAudience(
      and({ type: 'profile', field: 'product_count', operator: 'eq', value: 1 }),
      now
    );

    expect(profileFilter).to.deep.equal({ 'data.product_count': 1 });
  });

  it('l’agrégation d’activité filtre sur productId', () => {
    const [match] = compileActivityPipeline(
      'env',
      [{ type: 'activity', metric: 'volUsd', windowDays: 30, productId: 'wallet', operator: 'gt', value: 100 }],
      now
    ).slice(1) as { $group: Record<string, unknown> }[];

    expect(JSON.stringify(match)).to.contain('$productId');
  });
});

describe('compileAudience · paliers exprimés en bande', () => {
  // Un palier d'inactivité ne doit désigner que les clients qui viennent de l'atteindre. « 0 transaction
  // depuis 30 jours » reste vrai les jours suivants : une campagne quotidienne renverrait le message
  // chaque jour. La bande « 0 sur 30 j ET au moins 1 sur 31 j » ne vise que ceux dont la dernière
  // transaction date d'exactement 30 jours — c'est ce qui remplace un compteur de palier mémorisé.
  it('« inactif J30 » : la borne haute se lit sur l’index last_tx_at, pas dans l’activité', () => {
    const compiled = compileAudience(
      and(
        { type: 'activity', metric: 'tx', windowDays: 30, operator: 'eq', value: 0 },
        { type: 'activity', metric: 'tx', windowDays: 31, operator: 'gte', value: 1 }
      ),
      now
    );

    // « Aucune transaction sur 30 jours », tous produits, se déduit de la date de dernière transaction :
    // un filtre indexé sur subscribers, sans toucher aux lignes d'activité.
    expect(compiled.profileFilter).to.deep.equal({
      $or: [{ 'data.last_tx_at': { $lt: '2026-08-16T00:00:00.000Z' } }, { 'data.last_tx_at': { $exists: false } }],
    });

    // Seule « au moins 1 sur 31 jours » ouvre l'activité : une agrégation, une somme.
    expect(compiled.activityConditions).to.have.length(1);
    const [, group] = compileActivityPipeline('env', compiled.activityConditions, now) as [
      unknown,
      { $group: Record<string, unknown> },
    ];
    expect(Object.keys(group.$group)).to.deep.equal(['_id', 'm0']);
  });

  it('une bande par produit reste une seule lecture', () => {
    const compiled = compileAudience(
      and(
        { type: 'profile', field: 'products', operator: 'has', value: 'card' },
        { type: 'activity', metric: 'tx', windowDays: 30, productId: 'card', operator: 'eq', value: 0 },
        { type: 'activity', metric: 'tx', windowDays: 31, productId: 'card', operator: 'gte', value: 1 }
      ),
      now
    );

    expect(compiled.profileFilter).to.deep.equal({ 'data.products': 'card' });
    expect(compiled.activityConditions).to.have.length(2);
  });

  it('« jamais activé » : KYC validé il y a plus de 30 jours et aucune transaction', () => {
    const { profileFilter } = compileAudience(
      and(
        { type: 'profile', field: 'kyc_status', operator: 'eq', value: 'validated' },
        { type: 'profile', field: 'kyc_validated_at', operator: 'more_than_days_ago', value: 30 },
        { type: 'profile', field: 'lifetime_tx', operator: 'eq', value: 0 }
      ),
      now
    );

    expect(profileFilter.$and).to.have.length(3);
    expect(profileFilter.$and).to.deep.include({ 'data.lifetime_tx': 0 });
  });
});
