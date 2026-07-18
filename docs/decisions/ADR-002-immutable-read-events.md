# ADR-002 — Read events are immutable

Status: Accepted (Sprint 0)

## Context

A contract meter reader's credibility rests on an unaltered record of what was
read and when. BUILD_SPEC §2.2 makes immutability a non-negotiable principle.

## Decision

- `read_events` has **no update path**. Once stored, a read event is never
  mutated. Corrections and rereads are **new events**, linked (a reread carries
  `exception_id`; ordering is by server-stamped `received_at`).
- Two timestamps, never conflated: `captured_at` (client-asserted business
  truth) and `received_at` (server-stamped, authoritative for ordering).
- The event `id` is a **client-generated UUIDv4** and doubles as the
  idempotency key (see ADR on ingestion behaviour when written, Sprint 1).
- Audit history is therefore a **consequence** of the model, not a feature
  bolted on.

## Consequences

- No `UPDATE` on reads anywhere in the codebase; reviewers can grep for its
  absence. Repositories expose insert + select only.
- "Current value" for a meter is a query (latest by `received_at`), not a stored
  mutable field.
- Storage grows monotonically; fine at this scale, revisit retention later.
