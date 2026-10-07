import { Injectable } from '@nestjs/common';
import type { CrmIngestOutcome } from '@novu/dal';

type Count = { day: string; eventName: string; outcome: CrmIngestOutcome; count: number };

/** Compteurs d'ingestion en mémoire, versés dans Mongo par StatusReporter toutes les 30 s. */
@Injectable()
export class IngestCounters {
  private counts = new Map<string, Count>();

  lastMessageAt: Date | null = null;

  add(outcome: CrmIngestOutcome, eventName = 'inconnu'): void {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${day}|${eventName}|${outcome}`;
    const existing = this.counts.get(key);

    if (existing) existing.count++;
    else this.counts.set(key, { day, eventName, outcome, count: 1 });

    this.lastMessageAt = new Date();
  }

  drain(): Count[] {
    const drained = [...this.counts.values()];
    this.counts = new Map();

    return drained;
  }

  /** Versement en échec : les compteurs sont remis pour le prochain passage. */
  restore(counts: Count[]): void {
    for (const count of counts) {
      const key = `${count.day}|${count.eventName}|${count.outcome}`;
      const existing = this.counts.get(key);

      if (existing) existing.count += count.count;
      else this.counts.set(key, { ...count });
    }
  }
}
