import { Injectable } from '@nestjs/common';

const TRIGGER_TIMEOUT_MS = 15_000;

/** Erreur à ne pas retenter telle quelle (configuration, workflow inexistant…) : l'exécution passe en échec. */
export class CrmPermanentError extends Error {}

export type TriggerRecipient = { type: 'Topic'; topicKey: string } | string;

/**
 * Déclenche un workflow par l'API publique de Novu, comme le ferait Izichange.
 * Le transactionId rend le déclenchement rejouable : Novu écarte un second passage identique.
 */
@Injectable()
export class NovuTriggerClient {
  async trigger(input: {
    workflowKey: string;
    to: TriggerRecipient[];
    payload: Record<string, unknown>;
    transactionId: string;
  }): Promise<void> {
    const secretKey = process.env.NOVU_SECRET_KEY;
    if (!secretKey)
      throw new CrmPermanentError('NOVU_SECRET_KEY manquant : crm-ingest ne peut pas déclencher de workflow');

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
    const message = `Novu a répondu ${response.status} au déclenchement : ${detail}`;

    throw retryable ? new Error(message) : new CrmPermanentError(message);
  }
}
