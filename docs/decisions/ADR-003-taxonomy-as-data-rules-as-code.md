# ADR-003 — Taxonomy as data, rules as code

Status: Accepted (Sprint 0)

## Context

The system must accommodate new utilities (e.g. gas) and new exception types
later without schema churn (BUILD_SPEC §2.3). Validation logic, however, is
genuine code that deserves tests and review.

## Decision

- **Taxonomy lives in seeded lookup tables:** `exception_types`,
  `skip_reasons`, `severities` (labels, codes, default severity). Display labels
  come from data, surfaced to the UI via `GET /taxonomy`.
- **Validation logic lives in code modules**, one per exception type, registered
  against a type via a rule registry (Sprint 1). Adding a rule = a new row + a
  new module. No schema change.
- **No rule-builder UI in v1.** Thresholds live in global config.

## Consequences

- Adding a utility or exception type touches data + a code module, never the
  schema — the promised zero-migration extension path.
- The registry is the single place that maps type → rule; an unregistered type
  is a startup error, not a silent no-op.
- Per-client threshold overrides are explicitly deferred (Nice queue §12.4).
