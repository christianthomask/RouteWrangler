# ADR-010 — Consumption baseline computation

Status: Accepted (Sprint 1)

## Context

Hi/lo, leak-spike, and rollover-band rules compare a read's consumption to the
meter's **own** 12-month baseline (BUILD_SPEC §7.1). We must define how baseline
and per-read consumption are derived from the immutable event history.

## Decision

- **Consumption of a read = value − prior read's value**, ordered by the
  server-stamped `received_at` (authoritative ordering, ADR-002). Stored on the
  read at ingest as `consumption`.
- **Baseline = mean of prior *positive* consumptions** within the trailing
  `baselineMonths` window. Zeros and nulls are excluded so gaps and no-usage
  cycles don't drag a normal meter's band down.
- A meter needs at least `minBaselineReads` positive prior consumptions before
  hi/lo/leak/rollover-band rules will judge it; below that they **decline**
  (can't judge) rather than guess.
- Thresholds (`highReadMultiplier`, `leakSpikeMultiplier`, …) live in one global
  config shared by the API and the simulator; per-client overrides are deferred
  (Nice queue §12.4).

## Consequences

- New meters produce no false hi/lo/leak flags until they have history.
- Baseline is recomputed per read from history — no denormalized "baseline"
  column to keep in sync.
- The window is enforced by `received_at ≥ now − baselineMonths`; the seed
  backfills historical reads with `received_at = captured_at` so ordering and
  the window are correct.
