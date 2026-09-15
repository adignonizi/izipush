import { Injectable } from '@nestjs/common';
import { decryptApiKey } from '@novu/application-generic';
import { EnvironmentRepository } from '@novu/dal';

const TRIGGER_TIMEOUT_MS = 15_000;
const API_KEY_TTL_MS = 5 * 60 * 1000;

/** Erreur à ne pas retenter telle quelle (configuration, workflow inexistant…) : l'exécution passe en échec. */
export class CrmPermanentError extends Error {}

export type TriggerRecipient = { type: 'Topic'; topicKey: string } | string;

/**
 * Déclenche un workflow par l'API publique de Novu, comme le ferait Izichange.
 * Chaque campagne est déclenchée avec la clé API de SON environnement : une clé unique ferait chercher
 * le workflow dans un autre environnement (« workflow_not_found »).
 * Le transactionId rend le déclenchement rejouable : Novu écarte un second passage identique.
 */
@Injectable()
export class NovuTriggerClient {
  private readonly keys = new Map<string, { key: string; expiresAt: number }>();

  constructor(private environments: EnvironmentRepository) {}

  async trigger(input: {
    environmentId: string;
    workflowKey: string;
    to: TriggerRecipient[];
    payload: Record<string, unknown>;
    transactionId: string;
  }): Promise<void> {
    const secretKey = await this.apiKey(input.environmentId);

    const response = await fetch(`${process.env.NOVU_API_URL.replace(/\/+$/, '')}/v1/events/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `ApiKey ${secretKey}` },
      body: JSON.stringify({
        name: input.workflowKey,
        to: input.to,
        payload: input.payload,
        transactionId: input.transactionId,
      }),
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });

    if (response.ok) return;

    const detail = (await response.text().catch(() => '')).slice(0, 300);
    const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
    const message = detail.includes('workflow_not_found')
      ? `Le workflow « ${input.workflowKey} » est introuvable dans l'environnement de la campagne : vérifiez qu'il existe et qu'il est publié.`
      : `Novu a répondu ${response.status} au déclenchement : ${detail}`;

    throw retryable ? new Error(message) : new CrmPermanentError(message);
  }

  private async apiKey(environmentId: string): Promise<string> {
    const cached = this.keys.get(environmentId);
    if (cached && cached.expiresAt > Date.now()) return cached.key;

    if (!process.env.STORE_ENCRYPTION_KEY)
      throw new CrmPermanentError('STORE_ENCRYPTION_KEY manquant : crm-ingest ne peut pas lire les clés API Novu');

    const [first] = (await this.environments.getApiKeys(environmentId).catch(() => [])) ?? [];
    if (!first?.key)
      throw new CrmPermanentError(`Aucune clé API pour l'environnement ${environmentId} : impossible de déclencher`);

    const key = decryptApiKey(first.key);
    this.keys.set(environmentId, { key, expiresAt: Date.now() + API_KEY_TTL_MS });

    return key;
  }
}
