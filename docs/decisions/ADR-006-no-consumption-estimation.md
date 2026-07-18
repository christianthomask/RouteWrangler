# ADR-006 — No consumption estimation

Status: Accepted (Sprint 0)

## Context

Utilities often estimate consumption when a read is missing. RouteWrangler is a
**contract reader**, not a utility: it reports what was read and hands validated
reads to each city's billing system, which owns estimation and the customer
relationship (BUILD_SPEC §1 scope lines, §2, W6).

## Decision

- **The system never estimates or fabricates a read.** Gaps are **reported**,
  never filled. Billing exports list gap meters explicitly; they do not synthesize
  values.
- No customer accounts, no bills — out of scope by design.
- This scope line is stated out loud in the README.

## Consequences

- Export logic includes a "gaps" count and an explicit list; it has no
  estimation code path to review or misuse.
- If a client ever asks for estimates, that is a scope change and a new ADR,
  not a quiet feature — the boundary is deliberate.
