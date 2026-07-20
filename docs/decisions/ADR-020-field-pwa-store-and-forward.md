# ADR-020 — Field PWA: offline store-and-forward with exactly-once capture

Status: Accepted.

## Context

Readers work where connectivity is unreliable — basements, vaults, rural routes
(BUILD_SPEC §7.2, DESIGN_BRIEF §4). A read taken in airplane mode must never be
lost, and reconnecting must never bill a customer twice. The field client is the
same Next.js app as the console (ADR-018), installed as a PWA.

## Decision

- **Queue owns delivery, not the network layer.** Every capture (read or skip)
  is written to **IndexedDB** first (`lib/field/db.ts`) and only then attempted
  over the wire (`lib/field/queue.ts`). The write survives reload, process kill,
  and battery death; sync is a best-effort follow-up that retries on the next
  pass. Per-event state (`pending → syncing → synced | failed`) means one stop's
  failure never blocks the rest of the run.
- **Exactly-once = client id is the server idempotency key.** A read's
  queue-generated UUID is sent as the read event `id`; the server closes the
  race with `onConflictDoNothing` on `read_events.id` (ADR-002 immutability). A
  replay comes back `duplicate`, which the client maps to `synced`
  (`stateFromIngest`). Draining the queue twice — or a flaky reconnect that
  double-fires — lands exactly one row. Verified end-to-end: 3 reads captured
  while the ingest endpoint was unreachable, 0 leaked; on reconnect + a forced
  second sync, exactly 3 rows landed (`ingestion.integration.test.ts` proves the
  server half; `lib/field/types.test.ts` the client half).
- **Sync triggers:** on queue load, after each enqueue, and on the `online`
  event. `sync()` is single-flight (`syncing` guard) and short-circuits when
  `navigator.onLine` is false, so no work is wasted offline.
- **Service worker is app-shell only** (`public/sw.js`), and registers **in
  production only**. It caches the shell and hashed static assets so the
  installed app launches with no signal; it never touches non-GET requests and
  never caches API responses. Caching POSTs would create a second delivery path
  and break the single exactly-once guarantee — the queue is the only writer.
- **Installable PWA:** `manifest.webmanifest` scoped to `/field`
  (standalone, portrait, brand theme `#0e7490`), with `any` + `maskable` icons
  and an apple-touch-icon, wired via the `/field` route segment's metadata.

## Consequences

- The offline guarantee lives in code we test (the queue), not in browser SW
  behavior we don't control. The SW is a pure launch-offline convenience; losing
  it degrades to "must be online to open the app," never to lost reads.
- Because the SW deliberately does not cache dynamic RSC payloads, deep links to
  a specific stop are not reachable offline from a cold launch — the reader
  opens the run online and works from there. Full offline deep-linking would
  need RSC-aware caching and is out of scope for W3.
- GPS denial and photo attach are non-blocking: a read still captures and syncs
  as location-absent (ADR-013 derives the photo key from the event id, so photos
  attach asynchronously without mutating the read).
- Skips share the same queue and idempotency shape (the skip endpoint is
  idempotent on stop state), so a replayed skip is a no-op.
