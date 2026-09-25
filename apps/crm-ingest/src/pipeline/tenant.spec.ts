import { expect } from 'chai';

import { adaptRabbit } from './adapters';
import { CrmTenant, currentTenant, runInTenant } from './tenant';
import { TenantResolver } from './tenant.resolver';
import { CrmValidationError } from './validation';

/** Dépôt d'environnements réduit à ce que le résolveur lui demande. */
function environmentsReturning(found: { _id: string; _organizationId: string } | null) {
  let calls = 0;

  return {
    repo: {
      findEnvironmentByIdentifier: async () => {
        calls += 1;

        return found;
      },
    },
    get calls() {
      return calls;
    },
  };
}

describe('contexte de locataire', () => {
  const CONFIGURED = { environmentId: 'env-configure', organizationId: 'org-configure' };

  beforeEach(() => {
    process.env.CRM_ENVIRONMENT_ID = CONFIGURED.environmentId;
    process.env.CRM_ORGANIZATION_ID = CONFIGURED.organizationId;
  });

  it('hors contexte, retombe sur l’environnement configuré', () => {
    expect(currentTenant()).to.deep.equal(CONFIGURED);
  });

  it('dans un contexte, rend le locataire posé', async () => {
    const tenant: CrmTenant = { environmentId: 'env-a', organizationId: 'org-a' };

    await runInTenant(tenant, async () => {
      expect(currentTenant()).to.deep.equal(tenant);
    });
  });

  it('restitue le contexte précédent en sortant', async () => {
    await runInTenant({ environmentId: 'env-a', organizationId: 'org-a' }, async () => undefined);

    expect(currentTenant()).to.deep.equal(CONFIGURED);
  });

  /* Le cas qui motive AsyncLocalStorage plutôt qu'un champ du service : deux
     tâches de deux environnements traitées de front ne doivent jamais se voir. */
  it('deux traitements concurrents ne se mélangent pas', async () => {
    const vu: string[] = [];

    const tache = (id: string, attente: number) =>
      runInTenant({ environmentId: `env-${id}`, organizationId: `org-${id}` }, async () => {
        await new Promise((resolve) => setTimeout(resolve, attente));
        vu.push(currentTenant().environmentId);
      });

    // La première attend plus longtemps : elle rend la main, l'autre s'intercale.
    await Promise.all([tache('a', 20), tache('b', 5)]);

    expect(vu).to.deep.equal(['env-b', 'env-a']);
  });
});

describe('TenantResolver', () => {
  const CONFIGURED = { environmentId: 'env-configure', organizationId: 'org-configure' };

  beforeEach(() => {
    process.env.CRM_ENVIRONMENT_ID = CONFIGURED.environmentId;
    process.env.CRM_ORGANIZATION_ID = CONFIGURED.organizationId;
  });

  it('sans application_id, rend l’environnement configuré sans interroger la base', async () => {
    const environments = environmentsReturning(null);
    const resolver = new TenantResolver(environments.repo as never);

    expect(await resolver.resolve(undefined)).to.deep.equal(CONFIGURED);
    expect(environments.calls, 'aucune lecture inutile').to.equal(0);
  });

  it('avec un application_id connu, rend son environnement ET son organisation', async () => {
    const environments = environmentsReturning({ _id: 'env-izi', _organizationId: 'org-izi' });
    const resolver = new TenantResolver(environments.repo as never);

    expect(await resolver.resolve('xfPKZgo5XNEV')).to.deep.equal({
      environmentId: 'env-izi',
      organizationId: 'org-izi',
    });
  });

  it('met la correspondance en cache : une seule lecture pour deux résolutions', async () => {
    const environments = environmentsReturning({ _id: 'env-izi', _organizationId: 'org-izi' });
    const resolver = new TenantResolver(environments.repo as never);

    await resolver.resolve('xfPKZgo5XNEV');
    await resolver.resolve('xfPKZgo5XNEV');

    expect(environments.calls).to.equal(1);
  });

  /* Le point qui compte : un identifiant erroné ne doit SURTOUT PAS retomber
     sur l'environnement configuré, sinon des événements finiraient chez le
     mauvais client sans que rien ne le signale. */
  it('rejette un application_id inconnu au lieu de retomber sur la configuration', async () => {
    const environments = environmentsReturning(null);
    const resolver = new TenantResolver(environments.repo as never);

    let leve: unknown;
    try {
      await resolver.resolve('inconnu');
    } catch (error) {
      leve = error;
    }

    expect(leve, 'doit lever').to.be.instanceOf(CrmValidationError);
  });

  it('ne met pas l’absence en cache : la tentative suivante relit', async () => {
    const environments = environmentsReturning(null);
    const resolver = new TenantResolver(environments.repo as never);

    await resolver.resolve('inconnu').catch(() => undefined);
    await resolver.resolve('inconnu').catch(() => undefined);

    // Le dépôt lit sur un secondaire : un environnement tout juste créé peut
    // n'y être pas encore répliqué, la réponse doit rester réessayable.
    expect(environments.calls).to.equal(2);
  });
});

describe('adaptRabbit — application_id', () => {
  const base = {
    event_id: 'evt-001',
    event_name: 'account.logged_in',
    occurred_at: '2026-01-15T10:00:00.000Z',
    user_id: 'usr-1',
    payload: {},
  };

  it('remonte l’application_id quand l’enveloppe le porte', () => {
    const result = adaptRabbit({ ...base, application_id: 'xfPKZgo5XNEV' });

    expect(result.kind).to.equal('event');
    if (result.kind !== 'event') return;
    expect(result.event.applicationId).to.equal('xfPKZgo5XNEV');
  });

  it('reste valide sans application_id — le champ est facultatif', () => {
    const result = adaptRabbit(base);

    expect(result.kind).to.equal('event');
    if (result.kind !== 'event') return;
    expect(result.event.applicationId).to.equal(undefined);
  });
});
