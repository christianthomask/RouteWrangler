import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedAction, ReadPayload, SkipPayload } from './types';

/**
 * The 280-line exactly-once engine had no tests at all. It is the piece of this
 * system with the least margin for error: a reader's capture exists only on
 * their phone until it syncs, so every branch here is a way to lose work that
 * somebody walked to a meter to collect.
 *
 * IndexedDB is faked with a Map rather than a shim, so the assertions are about
 * queue behaviour and not about a polyfill's fidelity.
 */
const store = new Map<string, QueuedAction>();

vi.mock('./db', () => ({
  putAction: (a: QueuedAction) => {
    store.set(a.id, structuredClone(a));
    return Promise.resolve();
  },
  allActions: () =>
    Promise.resolve(
      [...store.values()].map((a) => structuredClone(a)).sort((a, b) => a.seq - b.seq),
    ),
  deleteAction: (id: string) => {
    store.delete(id);
    return Promise.resolve();
  },
}));

const headers: Record<string, string> | null = { authorization: 'Bearer t' };
const session = vi.hoisted(() => ({ headers: {} as Record<string, string> | null }));
vi.mock('../session', () => ({ authHeaders: () => session.headers }));
vi.mock('../config', () => ({ config: { apiBaseUrl: 'https://api.test' } }));

const { FieldQueue } = await import('./queue');

function read(over: Partial<ReadPayload> = {}): ReadPayload {
  return {
    meterId: 'm1',
    runStopId: 's1',
    readerId: 'r1',
    value: 1234,
    capturedAt: '2026-07-30T12:00:00.000Z',
    lat: 37,
    lng: -122,
    ...over,
  };
}

function skip(over: Partial<SkipPayload> = {}): SkipPayload {
  return { runId: 'run1', stopId: 's1', skipReasonCode: 'locked_gate', ...over };
}

/** An ingest response with the given per-event status. */
function ingestReply(status: string, message?: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ results: [{ status, message }] }),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store.clear();
  session.headers = headers;
  vi.stubGlobal('navigator', { onLine: true });
  fetchMock = vi.fn(async () => ingestReply('accepted'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The bodies POSTed to the ingestion endpoint, oldest first. */
function ingestBodies() {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]).endsWith('/ingest/read-events'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

describe('FieldQueue — capture and sync', () => {
  it('sends the queue id as the event id, which is the idempotency key', async () => {
    // This equality is the whole exactly-once story (ADR-008): a replay of an
    // already-accepted read is recognised by the server because the client chose
    // the id, so a retry can never create a second read.
    const q = new FieldQueue();
    const id = await q.enqueueRead(read());
    await q.sync();

    expect(ingestBodies()[0].events[0].id).toBe(id);
  });

  it('replays in capture order, not enqueue-completion order', async () => {
    const q = new FieldQueue();
    const first = await q.enqueueRead(read({ value: 1 }));
    const second = await q.enqueueRead(read({ value: 2 }));
    await q.sync();

    expect(ingestBodies().map((b) => b.events[0].id)).toEqual([first, second]);
  });

  it('treats `duplicate` as landed, not as a failure', async () => {
    // A retry after a lost response comes back duplicate. Marking that failed
    // would leave the reader staring at an error for work the server already has.
    fetchMock.mockResolvedValue(ingestReply('duplicate'));
    const q = new FieldQueue();
    await q.enqueueRead(read());
    await q.sync();

    expect(q.counts()).toMatchObject({ synced: 1, failed: 0 });
  });

  it('keeps the server’s reason on a rejected read', async () => {
    // Without the message the reader got a bare "1 failed" and walked away
    // believing the stop was done.
    fetchMock.mockResolvedValue(ingestReply('rejected', 'value exceeds register capacity'));
    const q = new FieldQueue();
    await q.enqueueRead(read());
    await q.sync();

    expect(q.snapshot()[0]).toMatchObject({
      state: 'failed',
      error: 'value exceeds register capacity',
    });
  });

  it('accepts each event independently — one failure does not block the rest', async () => {
    // Keyed off the payload rather than call order, because the queue retries
    // within a pass: a `mockResolvedValueOnce` would be consumed by whichever
    // attempt happened to go first.
    fetchMock.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return body.events[0].value === 1
        ? ({ ok: false, status: 500 } as Response)
        : ingestReply('accepted');
    });
    const q = new FieldQueue();
    await q.enqueueRead(read({ value: 1 }));
    await q.enqueueRead(read({ value: 2 }));
    await q.sync();

    expect(q.counts()).toMatchObject({ failed: 1, synced: 1 });
  });

  it('retries a failed action once the network comes back', async () => {
    let up = false;
    fetchMock.mockImplementation(async () =>
      up ? ingestReply('accepted') : ({ ok: false, status: 503 } as Response),
    );
    const q = new FieldQueue();
    await q.enqueueRead(read());
    await q.sync();
    expect(q.counts().failed).toBe(1);

    up = true;
    await q.sync();
    expect(q.counts()).toMatchObject({ synced: 1, failed: 0 });
  });

  it('does not send anything while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const q = new FieldQueue();
    await q.enqueueRead(read());
    await q.sync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(q.counts().pending).toBe(1);
  });

  it('does not send anything without auth headers', async () => {
    // Signed out mid-run: the capture waits rather than being posted
    // unauthenticated and rejected.
    session.headers = null;
    const q = new FieldQueue();
    await q.enqueueRead(read());
    await q.sync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(q.counts().pending).toBe(1);
  });
});

describe('FieldQueue — restart recovery', () => {
  it('rewinds a read stranded in `syncing` by a dead tab', async () => {
    // The tab died after POSTing and before the response. Left in `syncing` the
    // capture is invisible to syncable() and strands forever; resending is safe
    // because the server dedups on the id we chose.
    store.set('a1', {
      id: 'a1',
      kind: 'read',
      state: 'syncing',
      seq: 1,
      createdAt: 1,
      read: read(),
    });

    const q = new FieldQueue();
    await q.load();
    // load() kicks off a sync it does not await; sync() joins that pass.
    await q.sync();

    expect(ingestBodies()).toHaveLength(1);
    expect(q.counts()).toMatchObject({ synced: 1 });
  });

  it('prunes rows already confirmed synced in a prior session', async () => {
    store.set('old', { id: 'old', kind: 'read', state: 'synced', seq: 1, createdAt: 1, read: read() });
    store.set('new', {
      id: 'new',
      kind: 'read',
      state: 'pending',
      seq: 2,
      createdAt: 2,
      read: read(),
    });

    const q = new FieldQueue();
    await q.load();

    expect(q.snapshot().map((a) => a.id)).toEqual(['new']);
    expect(store.has('old')).toBe(false);
  });

  it('never reuses a sequence number from a pruned row', async () => {
    // The counter is seeded from everything on disk *including* the synced rows
    // just dropped. Seeding from the surviving mirror instead would hand the
    // next capture a number an earlier one already used, and capture order — the
    // thing the queue exists to preserve — would be ambiguous.
    store.set('old', { id: 'old', kind: 'read', state: 'synced', seq: 7, createdAt: 1, read: read() });

    const q = new FieldQueue();
    await q.load();
    await q.enqueueRead(read());

    expect(q.snapshot()[0]?.seq).toBe(8);
  });

  it('is idempotent — a second load does not re-send anything', async () => {
    const q = new FieldQueue();
    await q.enqueueRead(read());
    await q.sync();
    fetchMock.mockClear();

    await q.load();
    await q.load();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FieldQueue — photos', () => {
  const dataUrl = 'data:image/jpeg;base64,AAAA';

  /** presign → blob fetch → PUT, in the order the queue issues them. */
  function photoAwareFetch(putOk = true) {
    return vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('data:')) return { blob: () => Promise.resolve(new Blob()) } as Response;
      if (u.endsWith('/photos/presign')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({ uploadUrl: 'https://s3.test/put', headers: {}, photoKey: 'k' }),
        } as unknown as Response;
      }
      if (u === 'https://s3.test/put') return { ok: putOk, status: putOk ? 200 : 500 } as Response;
      return ingestReply('accepted');
    });
  }

  it('uploads the photo only after the read has landed', async () => {
    fetchMock = photoAwareFetch();
    vi.stubGlobal('fetch', fetchMock);
    const q = new FieldQueue();
    await q.enqueueRead(read({ photoDataUrl: dataUrl }));
    await q.sync();

    const order = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(order.indexOf('https://api.test/ingest/read-events')).toBeLessThan(
      order.indexOf('https://api.test/photos/presign'),
    );
    // Local copy dropped once it is safely uploaded, so IndexedDB is not holding
    // a base64 image for every stop on the route.
    expect(q.snapshot()[0]?.read?.photoDataUrl).toBeNull();
  });

  it('leaves the read synced when the photo upload fails', async () => {
    // The read is the billable artifact; the photo is evidence attached to it
    // (H6, ADR-013). Failing the read because its photo did not upload would
    // discard a good reading over a retryable upload.
    fetchMock = photoAwareFetch(false);
    vi.stubGlobal('fetch', fetchMock);
    const q = new FieldQueue();
    await q.enqueueRead(read({ photoDataUrl: dataUrl }));
    await q.sync();

    expect(q.counts()).toMatchObject({ synced: 1, failed: 0 });
    expect(q.snapshot()[0]?.read?.photoDataUrl).toBe(dataUrl);
  });

  it('uploads a skip’s photo BEFORE recording the skip', async () => {
    // The server refuses a skip without evidence (ADR-025), so the order is not
    // cosmetic: sending the skip first would just be rejected.
    fetchMock = photoAwareFetch();
    vi.stubGlobal('fetch', fetchMock);
    const q = new FieldQueue();
    await q.enqueueSkip(skip({ photoDataUrl: dataUrl }));
    await q.sync();

    const order = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(order.indexOf('https://api.test/photos/presign')).toBeLessThan(
      order.findIndex((u) => u.includes('/skip')),
    );
    expect(q.counts()).toMatchObject({ synced: 1 });
  });

  it('does not record a skip whose evidence failed to upload', async () => {
    // A skip that landed without its photo is exactly the gap ADR-025 closes:
    // the meter leaves the billing cycle on the reader's word alone.
    fetchMock = photoAwareFetch(false);
    vi.stubGlobal('fetch', fetchMock);
    const q = new FieldQueue();
    await q.enqueueSkip(skip({ photoDataUrl: dataUrl }));
    await q.sync();

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/skip'))).toBe(false);
    expect(q.counts()).toMatchObject({ failed: 1, synced: 0 });
  });
});
