# ADR-005 — The split invariant

Status: Accepted (Sprint 0)

## Context

A route run can be split — at assignment (a route materializes as N runs) or
mid-run (carve a contiguous range of stops to another reader). Splitting must
never corrupt work already done or double-count reads (BUILD_SPEC §5, §7.3, §8).

## Decision

- **A split re-parents only `pending` run_stops** to the new run. `read` and
  `skipped` run_stops **never move.**
- The new run records **lineage** via `route_runs.split_from_run_id`.
- Every split writes an **audit entry**.
- **Offline-split collision** (a stop was moved while the original reader was
  offline and had already captured it) is resolved by the ingestion duplicate
  rule (ADR/spec §7.1): the read still persists; disagreement beyond tolerance
  opens a `duplicate_mismatch` exception. No read is ever lost.

## Consequences

- Split logic filters strictly on `status = 'pending'`; a unit test asserts that
  `read`/`skipped` rows are untouched (Sprint 3).
- "Exactly-once" for a moved-and-captured stop is a property of the immutable
  event + duplicate rule, not of locking — consistent with offline-first.
