'use client';

import { config } from '../config';
import { authHeaders } from '../session';
import { allActions, deleteAction, putAction } from './db';
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
/**
 * Ask the browser to exempt our origin's storage (the IndexedDB queue) from
 * eviction under storage pressure (M8). Best-effort and idempotent: where it's
 * unsupported or denied the queue still works — it's just evictable, so an
 * un-synced capture could be reclaimed. A grant makes that far less likely.
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    /* best-effort — nothing to recover if the request itself throws */
  }
}

/**
 * Upload a captured photo after its read has landed (H6, ADR-013). The read is
 * never blocked by its photo: this runs best-effort after the event is accepted,
 * the object key is derived server-side from the read-event id, and the read row
 * is never mutated. Throws on failure so the caller can keep the local copy for
 * a later retry.
 */
async function uploadPhoto(
  readEventId: string,
  dataUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  const contentType = /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'image/jpeg';
  const blob = await (await fetch(dataUrl)).blob(); // data URL → binary
  const presign = await fetch(`${config.apiBaseUrl}/photos/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ readEventId, contentType }),
  });
  if (!presign.ok) throw new Error(`presign ${presign.status}`);
  const { uploadUrl, headers: putHeaders } = (await presign.json()) as {
    uploadUrl: string;
    headers: Record<string, string>;
  };
  const put = await fetch(uploadUrl, { method: 'PUT', headers: putHeaders, body: blob });
  if (!put.ok) throw new Error(`upload ${put.status}`);
}

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
    // Ask to keep the queue out of eviction before we lean on it (M8).
    void requestPersistentStorage();
    const all = await allActions();

    // Reconcile reads stranded in `syncing` by a tab that died after POSTing but
    // before the response landed (H5). Left alone they'd never be picked up by
    // syncable() and would strand the capture forever. Rewinding to `pending` is
    // safe to resend: the server dedups on the client-generated event id
    // (ADR-008), so a replay comes back `duplicate` and is treated as synced.
    for (const a of all) {
      if (a.state === 'syncing') {
        a.state = 'pending';
        a.error = undefined;
        await putAction(a);
      }
    }

    // Prune actions confirmed synced in a prior session (M8): the server holds
    // them and a fresh run fetch reflects them on load, so they no longer need
    // to occupy the queue. Only terminal `synced` rows are dropped — this
    // session's synced rows stay live so the run view can still show "Synced".
    await Promise.all(all.filter((a) => a.state === 'synced').map((a) => deleteAction(a.id)));
    this.mirror = all.filter((a) => a.state !== 'synced');
    // Seed the sequence counter from everything on disk — including the synced
    // rows just pruned — so a new action can never reuse a number from this
    // device's history.
    this.seqCounter = all.reduce((m, a) => Math.max(m, a.seq), 0);

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

  /**
   * Monotonic within the session, seeded from disk on load.
   *
   * Deliberately a counter rather than `max(mirror.seq) + 1`: `persist()` only
   * appends to `this.mirror` *after* awaiting the IndexedDB write, so two
   * enqueues overlapping across that await would both observe the same maximum
   * and be assigned the same seq — two captures sharing an ordering key. The
   * increment here is synchronous, so no await can interleave.
   */
  private seqCounter = 0;

  private nextSeq() {
    return ++this.seqCounter;
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
    await this.persist({
      id,
      kind: 'read',
      state: 'pending',
      seq: this.nextSeq(),
      createdAt: Date.now(),
      read,
    });
    void this.sync();
    return id;
  }

  async enqueueSkip(skip: SkipPayload): Promise<string> {
    const id = crypto.randomUUID();
    await this.persist({
      id,
      kind: 'skip',
      state: 'pending',
      seq: this.nextSeq(),
      createdAt: Date.now(),
      skip,
    });
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
              note: a.read.note ?? undefined,
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
            const landed = stateFromIngest(status);
            // Keep the server's reason. A rejected read ("value exceeds register
            // capacity") otherwise left the reader with a bare "failed" count and
            // nothing to act on — they walked away believing the stop was done.
            const reason: string | undefined = json?.results?.[0]?.message;
            await this.persist({
              ...a,
              state: landed,
              error: landed === 'failed' ? (reason ?? 'the server rejected this read') : undefined,
            });

            // Photo attaches after the read lands (H6, best-effort — the read is
            // never blocked by it). On success we drop the local data URL to free
            // IndexedDB. On failure the read stays synced; the photo is left in
            // place (not auto-retried, since synced actions aren't re-sent) and
            // is reclaimed on the next session's prune.
            if (landed === 'synced' && a.read.photoDataUrl) {
              try {
                await uploadPhoto(a.id, a.read.photoDataUrl, headers);
                await this.persist({ ...a, state: 'synced', read: { ...a.read, photoDataUrl: null } });
              } catch {
                /* read is safe; photo upload is best-effort */
              }
            }
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
          await this.persist({
            ...a,
            state: 'failed',
            error: e instanceof Error ? e.message : 'sync failed',
          });
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
