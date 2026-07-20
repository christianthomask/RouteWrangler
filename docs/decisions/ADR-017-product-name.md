# ADR-017 — Product name: Freshet

Status: Accepted (provisional — pending trademark clearance). A design decision
(DESIGN_BRIEF §3, naming is the design track's first deliverable).

## Context

The product needs a real name. DESIGN_BRIEF §3 requires: water-adjacent,
enterprise-credible, one or two words, pronounceable, **not cute**; tone anchors
"Headwater"/"Confluence". The working repo/codename is **RouteWrangler**, which
fails the brief — "Wrangler" is the cowboy/playful register the brief rules out,
and "Route" frames field logistics rather than the product's real story
(capture → **validate** → trustworthy export of reads).

Candidates were generated and collision-checked (web/company/domain signals —
not a formal trademark clearance). Runners-up: **Verameter** (safest; "true
measure"; domain available; slightly metering- not water-forward), **Meterwell**,
**Clariver**.

## Decision

- **Product name: Freshet.** A freshet is the surge of fresh water as a stream
  rises — flow, source, freshness, clarity in one calm, credible word. It is the
  only vetted candidate that fully satisfies the binding water-adjacency
  criterion while matching the calm/trustworthy tone, and no software / metering
  / utility collision was found.
- **Provisional** until a proper USPTO/EUIPO clearance in software classes (Nice
  9/42) and a domain sweep. One same-sector namesake exists — *Freshet Systems*,
  water-storage **hardware** (different class, likely clearable). `freshet.com`
  is parked/for-sale.
- **Repo and package identifiers stay `routewrangler`** (npm scope
  `@routewrangler/*`, repo name). The product brand is decoupled from code
  identifiers; the display name lives in one constant
  (`apps/web/src/design/brand.ts`) so it swaps in a single edit.

## Consequences

- If clearance fails or you prefer a runner-up, the change is one line —
  no code/package churn.
- Docs/marketing copy adopt "Freshet"; internal code, CI, and the repo keep
  "routewrangler" (no rename needed, no import churn).
- Close before any public launch: trademark clearance vs *Freshet Systems* in
  software classes, and secure `freshet.com` or a committed alternate TLD
  (tracked in docs/questions.md).
