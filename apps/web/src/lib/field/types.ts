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
export function stateFromIngest(status: IngestEventStatus): ActionState {
  return status === 'rejected' ? 'failed' : 'synced';
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
