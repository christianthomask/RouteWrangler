# ADR-008 — Idempotent ingestion on a client-generated event id

Status: Accepted (Sprint 1)

## Context

The field app is offline-first: it queues reads and syncs batches on reconnect,
retrying failures individually (BUILD_SPEC §7.1, W3). The pipeline must accept a
replayed batch without creating duplicate reads, and report the fate of each
event so the client can reconcile its queue.

## Decision

- The read event **`id` is a client-generated UUIDv4** and **is the idempotency
  key** (it is the `read_events` primary key).
- Ingestion returns a **per-event status**: `accepted | duplicate | rejected`,
  plus batch tallies.
- Dedup is enforced at the database: a fast existence check short-circuits
  replays, and the insert uses `ON CONFLICT (id) DO NOTHING` to close the
  concurrent-replay race. A no-op insert is reported as `duplicate`.
- Events are processed in **arrival order** (capture order) so reconciliation is
  deterministic.

## Consequences

- Replaying a full synced batch creates **zero** duplicates and returns
  exactly-once statuses — asserted by an integration test.
- The client owns id generation; a buggy client reusing an id would collide by
  design (dedup), which is the correct, safe failure.
- Combined with immutability (ADR-002), ingestion is a pure append: no updates,
  replay-safe.
