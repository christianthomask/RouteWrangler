# ADR-023 — Billing export: snapshot per client + cycle

Status: Accepted.

## Context

The end of the pipeline (BUILD_SPEC §7.4, W4): a client utility's billable reads
for a cycle have to leave the system as a file their billing platform ingests.
Two things must be true — the file contains exactly the reads that are safe to
bill, and there's an auditable record of what was sent and by whom.

## Decision

- **Billability is derived, never stored as a mutable flag.** For a client+cycle
  we join the run stops to their completed read and any exception on it, then a
  pure `classify` decides each stop:
  - **billable** — a read with no exception, a non-blocking exception, or a
    blocking exception that was **resolved/overridden** (billed at the certified
    read — ADR-002, so a reread's value substitutes without mutating anything);
  - **held** — a read with an unresolved blocking exception (stays out until a
    supervisor clears it);
  - **missing** — a stop with no read (pending/skipped).
  The rules live in `export.core.ts` with no I/O, so every case is unit-tested.
- **An export is an immutable snapshot.** `POST /exports` renders the file and
  stores the rendered body + counts in an `export_runs` row. Re-running for the
  same client+cycle inserts a new row and **supersedes** the prior one
  (`supersededByRunId`) rather than editing it — the history of what was sent is
  preserved and audited.
- **Format from the client profile.** `clients.exportProfile.format` selects the
  renderer; CSV is the only format today, behind an enum seam so others slot in.
- **Preview before commit.** `GET /exports/preview` returns the same counts plus
  the held/missing meter list, so a supervisor sees what's blocking billing and
  can go resolve it before generating the file.
- **Stored in-row, not object storage (for now).** The StoragePort is
  presign/client-upload only; a server-rendered file doesn't fit it, and the
  snapshot is small (one row per meter). Keeping the body in Postgres makes the
  export downloadable and auditable with no storage dependency and runs locally
  with no MinIO. `export_runs.fileKey` is retained for a future R2 offload of
  large bodies.
- **Supervisor/admin only**, enforced by the role guard (readers get 403).

## Consequences

- The export always reflects current certification state at the moment it's run;
  running it again after clearing exceptions produces a new, superseding file.
- Held/missing meters are surfaced, not silently dropped — the supervisor knows
  precisely why a meter isn't being billed.
- Body-in-Postgres is fine at this scale (thousands of meters → tens of KB). If a
  client's cycle grows large, move the body to R2 via `fileKey` and stream the
  download — a localized change, no schema churn.
- CSV columns are a sensible default (serial, address, date, value, consumption);
  per-client column mapping can extend `exportProfile` when a real billing import
  spec lands.
