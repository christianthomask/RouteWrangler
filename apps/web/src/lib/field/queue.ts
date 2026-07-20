'use client';

import { config } from '../config';
import { authHeaders } from '../session';
import { allActions, putAction } from './db';
import {
  counts,
  stateFromIngest,
  syncable,
  type QueuedAction,
  type ReadPayload,
  type SkipPayload,
} from './types';

/**
 * Store-and-forward queue (BUILD_SPEC §7.2, W3). Captures persist to IndexedDB
 * immediately (survive restarts), sync in capture order on reconnect, and each
 * event is accepted independently — a failure retries next pass without blocking
 * the others. Exactly-once holds because a read's queue id IS its server
 * idempotency key: a retry of an already-accepted read comes back `duplicate`
 * and is treated as synced.
 */
class FieldQueue {
  private mirror: QueuedAction[] = [];
  private listeners = new Set<() => void>();
  private loaded = false;
  private syncing = false;
  /** Bumped on every change — the stable snapshot for useSyncExternalStore. */
  version = 0;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  async load() {
    if (this.loaded) return;
    this.mirror = await allActions();
    this.loaded = true;
    this.emit();
    void this.sync();
  }

  snapshot() {
    return this.mirror;
  }
  counts() {
    return counts(this.mirror);
  }

  private nextSeq() {
    return this.mirror.reduce((m, a) => Math.max(m, a.seq), 0) + 1;
  }

  private async persist(a: QueuedAction) {
    await putAction(a);
    const i = this.mirror.findIndex((x) => x.id === a.id);
    if (i >= 0) this.mirror[i] = a;
    else this.mirror.push(a);
    this.emit();
  }

  async enqueueRead(read: ReadPayload): Promise<string> {
    const id = crypto.randomUUID();
    await this.persist({ id, kind: 'read', state: 'pending', seq: this.nextSeq(), createdAt: Date.now(), read });
    void this.sync();
    return id;
  }

  async enqueueSkip(skip: SkipPayload): Promise<string> {
    const id = crypto.randomUUID();
    await this.persist({ id, kind: 'skip', state: 'pending', seq: this.nextSeq(), createdAt: Date.now(), skip });
    void this.sync();
    return id;
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const headers = authHeaders();
    if (!headers) return;

    this.syncing = true;
    try {
      for (const a of syncable(this.mirror)) {
        await this.persist({ ...a, state: 'syncing', error: undefined });
        try {
          if (a.kind === 'read' && a.read) {
            const event = {
              id: a.id, // client-generated id = idempotency key
              meterId: a.read.meterId,
              runStopId: a.read.runStopId,
              readerId: a.read.readerId,
              value: a.read.value,
              capturedAt: a.read.capturedAt,
              sourceType: 'manual' as const,
              lat: a.read.lat,
              lng: a.read.lng,
              exceptionId: a.read.exceptionId ?? undefined,
            };
            const res = await fetch(`${config.apiBaseUrl}/ingest/read-events`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...headers },
              body: JSON.stringify({ events: [event] }),
            });
            if (!res.ok) throw new Error(`ingest ${res.status}`);
            const json = await res.json();
            const status = json?.results?.[0]?.status ?? 'rejected';
            await this.persist({ ...a, state: stateFromIngest(status) });
          } else if (a.kind === 'skip' && a.skip) {
            const res = await fetch(
              `${config.apiBaseUrl}/runs/${a.skip.runId}/stops/${a.skip.stopId}/skip`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
                body: JSON.stringify({ skipReasonCode: a.skip.skipReasonCode }),
              },
            );
            if (!res.ok) throw new Error(`skip ${res.status}`);
            await this.persist({ ...a, state: 'synced' });
          }
        } catch (e) {
          await this.persist({ ...a, state: 'failed', error: e instanceof Error ? e.message : 'sync failed' });
        }
      }
    } finally {
      this.syncing = false;
      this.emit();
    }
  }
}

export const fieldQueue = new FieldQueue();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void fieldQueue.sync());
}
