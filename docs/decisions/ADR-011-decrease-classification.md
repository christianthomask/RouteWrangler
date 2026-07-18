# ADR-011 — Classifying a decreasing read: rollover vs negative

Status: Accepted (Sprint 1)

## Context

A read lower than the meter's prior value is ambiguous: the mechanical register
may have **wrapped** (rollover), or the reading is genuinely **negative**
(swap, rollback, error, tamper). BUILD_SPEC §7.1 requires: rollover in-band →
auto-validate with a visible annotation, no exception; rollover out-of-band →
exception. `negative_consumption` is a separate seeded type. We must not fire
two rules on one decrease.

## Decision

Register max = 10^dials − 1. On a decrease, compute the wrap-implied consumption
`rolloverConsumption = (max + 1 − prior) + value`, then, in priority order:

1. **In-band** — `rolloverConsumption` is within `baseline × rolloverBandMultiplier`
   (or there's no baseline): treat as a rollover → **annotate `{rollover:true}`,
   billable, no exception.**
2. **Out-of-band but wrap-like** — the prior read sits in the top
   `(1 − rolloverProximity)` of the register (the meter plausibly wrapped) but
   the implied usage is too high → **`rollover_out_of_band`.**
3. **Otherwise** — the decrease isn't a plausible wrap → **`negative_consumption`.**

The rollover rule has higher priority than the negative rule, and the engine
takes the first consumption finding, so exactly one fires.

## Consequences

- A meter near the top of its register that wraps with normal usage passes
  cleanly with an annotation — no false exception.
- A small dip on a mid-register meter is `negative_consumption` (critical), not
  mislabeled as a rollover.
- Both discriminators (`rolloverBandMultiplier`, `rolloverProximity`) are config.
