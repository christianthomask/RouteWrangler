# ADR-016 — Design tokens & colorblind-safe status colors

Status: Accepted (Design Sprint 0). A **design decision dev must honor**
(DESIGN_BRIEF §5).

## Context

The evaluator explores the deployed app alone and triages exceptions **by
severity color** (DESIGN_BRIEF §1, §3). Severity and sync-state colors must
survive colorblind checks, and the UI must read as calm, dense, trustworthy
enterprise software. We need a token contract dev imports, not ad-hoc hex.

## Decision

- **Tokens are the styling contract.** `apps/web/src/design/tokens.css` defines
  semantic roles (surfaces, ink, brand, severity, sync, type scale, spacing,
  elevation, radius); `tokens.ts` exposes the programmatic slice. Components
  reference roles only — **no raw hex in components.**
- **Light-first, full dark support.** Light reads as enterprise software a city
  trusts with billing data; dark is a selected theme (its own steps, via
  `prefers-color-scheme` + a `data-theme` override), not an auto-invert.
- **Brand = water-teal** (`#0e7490`) — the identity/interactive hue (mark,
  primary actions, focus). It is deliberately *not* used for data encoding.
- **Severity & sync use a CVD-validated status palette**, drawn from the dataviz
  status ramp: low = slate, medium = amber, high = orange, critical = red;
  sync pending = amber, syncing = brand, synced = green, failed = red. Green is
  **reserved** for OK/resolved/billable/synced — never a severity.
- **Never color alone.** Every severity chip and sync pill renders **color + a
  dot + a text word.** This is the mitigation for the two known limits (below),
  and it means a colorblind supervisor never loses information.

## Why "never color alone" is required, with numbers

Run against the dataviz validator, the amber↔orange (medium↔high) pair measures
**normal-vision ΔE ≈ 13.6** (below the 15 "tell-apart" floor) and amber/orange
sit **below 3:1** contrast on white. As a *categorical* palette that would FAIL.
But severity is a **status** role, and the validated pattern for status colors is
**icon + label, never hue alone** — which we enforce in the chip component. With
the word present, the sub-floor hue separation is not load-bearing. (Blue/slate
low vs the warm ramp, and red critical, are unambiguous for all CVD types.)

## Consequences

- Dev builds severity/sync UI from the chip/pill primitives, which bake in the
  dot + label — a screen physically cannot ship a color-only status.
- Re-theming (brand refresh, a client's palette) changes token values in one
  file; re-run the validator on any new severity/sync hues.
- Charts (Sprint 1) use the dataviz *categorical* palette for series — a
  separate slot set from status, so a series color never impersonates a
  severity.
