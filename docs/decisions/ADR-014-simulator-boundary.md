# ADR-014 — Simulator boundary: generation is shared, the pipeline is public-only

Status: Accepted (Sprint 1)

## Context

Non-negotiable §2.1: the simulator is provably just another API client with zero
privileged access to the pipeline. Yet §7.6 also asks the simulator to "seed"
the world (clients, meters, 12 months of history). Building master data and
backfilling history is not something a pure HTTP reader client can do. We must
honor the boundary without contorting the seed.

## Decision

- **`packages/simulator` depends only on `@routewrangler/contracts`** — never on
  `@routewrangler/api`, and it holds no DB handle. Enforced by its dependency
  list. It has two jobs:
  1. **Pure generation logic** (seasonal curves, anomaly matrix) — deterministic
     functions with no I/O.
  2. **Playback** — replaying a route through the **public** `POST
     /ingest/read-events` with reader credentials. This is the "just another
     client" path.
- **Master data + 12-month history backfill is the API's own seed's job.** The
  seed (which legitimately owns DB access) *imports the simulator's pure
  generation functions* to build realistic history. The reverse dependency
  (api → simulator) is fine; the forbidden one (simulator → api) never exists.
- The live demo reads — the ones that prove the pipeline — go exclusively
  through the public API via playback.

## Consequences

- The "zero privileged access" claim is true for every read the pipeline
  validates: they all arrive over HTTP.
- Historical backfill is labeled fixture data, not a demonstration of capture.
- The anomaly-matrix generation is unit-tested against the validation engine
  (in `apps/api`, which may depend on the simulator) without a database.
