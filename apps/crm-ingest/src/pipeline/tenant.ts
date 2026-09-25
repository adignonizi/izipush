import { AsyncLocalStorage } from 'node:async_hooks';

/** Environnement et organisation Novu auxquels un événement appartient. */
export type CrmTenant = {
  environmentId: string;
  organizationId: string;
};

/**
 * Locataire courant, porté par le contexte asynchrone de la tâche en cours.
 *
 * Pourquoi pas un paramètre passé de proche en proche : la dérivation lit
 * l'environnement à dix-sept endroits, répartis sur une dizaine de méthodes
 * privées. Le faire descendre partout produirait un changement illisible, où
 * un oubli — une seule méthode qui continue de lire la configuration —
 * rangerait silencieusement des données dans le mauvais environnement.
 *
 * Pourquoi pas un champ du service : `DeriveService` est un singleton et
 * plusieurs tâches s'exécutent de front. Un champ mutable se ferait écraser
 * par la tâche suivante en plein traitement, avec le même effet en pire —
 * intermittent.
 *
 * `AsyncLocalStorage` donne à chaque tâche son propre contexte, qui suit
 * naturellement les `await`. C'est exactement le besoin.
 */
const storage = new AsyncLocalStorage<CrmTenant>();

/** Exécute `fn` en attribuant son contexte au locataire donné. */
export function runInTenant<T>(tenant: CrmTenant, fn: () => Promise<T>): Promise<T> {
  return storage.run(tenant, fn);
}

/**
 * Locataire de la tâche en cours.
 *
 * Hors contexte — au démarrage, dans un script, dans un test qui n'en pose
 * pas — retombe sur l'environnement configuré. C'est ce qui rend la bascule
 * rétrocompatible : tant qu'Izichange n'envoie pas d'`application_id`, tout
 * se comporte exactement comme avant.
 */
export function currentTenant(): CrmTenant {
  return (
    storage.getStore() ?? {
      environmentId: process.env.CRM_ENVIRONMENT_ID,
      organizationId: process.env.CRM_ORGANIZATION_ID,
    }
  );
}
