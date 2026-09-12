import { config } from '../config.js';
import type { CanonicalEvent } from '../normalize/schema.js';
import { insertEvents } from './writer.js';

interface Pending {
  tenantId: string;
  collectorId: string | null;
  events: CanonicalEvent[];
}

export class EventBatcher {
  private readonly pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private closed = false;

  get queueDepth(): number {
    let n = 0;
    for (const p of this.pending.values()) n += p.events.length;
    return n;
  }

  add(tenantId: string, collectorId: string | null, event: CanonicalEvent): void {
    if (this.closed) return;

    const key = `${tenantId}:${collectorId ?? '-'}`;
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { tenantId, collectorId, events: [] };
      this.pending.set(key, entry);
    }
    entry.events.push(event);

    if (entry.events.length >= config.ingest.writeBatchSize) {
      void this.flush();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, config.ingest.writeFlushMs);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      while (this.pending.size > 0) {
        const batches = [...this.pending.values()];
        this.pending.clear();

        for (const batch of batches) {
          try {
            await insertEvents(batch);
          } catch (err) {
            console.error(
              `[batcher] failed to write ${batch.events.length} event(s) for tenant ` +
                `${batch.tenantId}:`,
              (err as Error).message,
            );
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

export const batcher = new EventBatcher();
