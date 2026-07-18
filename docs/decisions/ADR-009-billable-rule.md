# ADR-009 — What makes a read billable

Status: Accepted (Sprint 1)

## Context

Passing reads are marked billable; failures open typed exceptions
(BUILD_SPEC §7.1). But not every exception is about the read's *value* — a
missing GPS fix (`location_absent`) or a duplicate-coverage disagreement
(`duplicate_mismatch`) are metadata concerns, low severity. Blocking billing on
those would strand otherwise-valid reads.

## Decision

- Each exception type carries a **`blocksBilling`** flag in the taxonomy
  (seeded from the shared `EXCEPTION_META` in `@routewrangler/contracts`).
- A read is **billable iff it has no open exception whose type blocks billing.**
- Consumption anomalies (high/low/leak/negative/rollover-oob/zero-streak) block.
  `location_absent` and `duplicate_mismatch` (low severity) **do not** block.
- Rollover **in-band** is an annotation, not an exception — it never blocks.

## Consequences

- `location_absent` reads remain billable while still surfacing a low-severity
  exception for follow-up — reporting without penalizing a valid value.
- The billable decision is shared between the engine (a constant map) and the
  taxonomy lookup (the runtime UI source), kept in sync by one definition.
- Estimation is never involved (ADR-006): a blocked read is *excluded and
  reported*, never fabricated.
