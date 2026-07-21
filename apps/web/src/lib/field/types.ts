import type { IngestEventStatus } from '@routewrangler/contracts';

/** Per-event state of a queued field action (BUILD_SPEC §7.2). */
export type ActionState = 'pending' | 'syncing' | 'synced' | 'failed';

export interface ReadPayload {
  meterId: string;
  runStopId: string | null;
  readerId: string;
  value: number;
  capturedAt: string;
  lat: number | null;
  lng: number | null;
  /** Reader's free-text note, captured with the read (immutable once ingested). */
  note?: string | null;
  exceptionId?: string | null;
  /** Optional local photo (data URL); uploaded best-effort after the read lands. */
  photoDataUrl?: string | null;
}

export interface SkipPayload {
  runId: string;
  stopId: string;
  skipReasonCode: string;
}

export interface QueuedAction {
  /** Client-generated UUID. For reads this IS the read-event idempotency key. */
  id: string;
  kind: 'read' | 'skip';
  state: ActionState;
  /** Capture order — sync replays in ascending seq. */
  seq: number;
  createdAt: number;
  read?: ReadPayload;
  skip?: SkipPayload;
  error?: string;
}

/** Accept both a fresh insert and an idempotent replay as "landed exactly once". */
/**
 * Only an explicit `accepted` or `duplicate` means the server holds the read
 * (ADR-008 — a replay of an accepted read comes back `duplicate`). Everything
 * else stays retryable.
 *
 * Deliberately an allowlist rather than `status === 'rejected' ? … : 'synced'`:
 * that form defaults *unknown* statuses to synced, so the server gaining a new
 * status — as it did with `failed` — would silently mark an unstored capture as
 * safe and let the queue drop it. Failing closed costs a redundant retry;
 * failing open loses a reader's work.
 */
export function stateFromIngest(status: IngestEventStatus): ActionState {
  return status === 'accepted' || status === 'duplicate' ? 'synced' : 'failed';
}

/** The actions to (re)send this sync pass, in capture order. */
export function syncable(actions: QueuedAction[]): QueuedAction[] {
  return actions
    .filter((a) => a.state === 'pending' || a.state === 'failed')
    .sort((a, b) => a.seq - b.seq);
}

export function counts(actions: QueuedAction[]): Record<ActionState, number> {
  const c: Record<ActionState, number> = { pending: 0, syncing: 0, synced: 0, failed: 0 };
  for (const a of actions) c[a.state]++;
  return c;
}
