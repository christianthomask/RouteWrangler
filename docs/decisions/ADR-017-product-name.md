# ADR-017 — Product name: Verameter

Status: Accepted (provisional — pending trademark clearance). A design decision
(DESIGN_BRIEF §3, naming is the design track's first deliverable).

## Context

The product needs a real name. DESIGN_BRIEF §3 requires: water/utility-adjacent,
enterprise-credible, one or two words, pronounceable, **not cute**; tone anchors
"Headwater"/"Confluence". The working repo/codename **RouteWrangler** fails the
brief — "Wrangler" is the cowboy/playful register the brief rules out, and
"Route" frames field logistics rather than the product's real story (capture →
**validate** → trustworthy export of reads).

Candidates were generated and collision-checked (web/company/domain signals —
not a formal trademark clearance). "Freshet" was the most water-evocative pick;
**Verameter** was the lowest-collision pick with an available domain.

## Decision

- **Product name: Verameter.** Coined from Latin *vera* (true) + *meter* — "the
  true measure." It maps precisely onto what the system is: an MDM that
  **validates** reads and certifies them for billing. Enterprise-credible, calm,
  trivially pronounceable and spellable.
- **Rationale for choosing it over Freshet:** lowest collision risk (no operating
  company found; `verameter.com` was available), and the meaning encodes the
  product's core promise (validated, trustworthy measurement) rather than only
  evoking water. Metering-forward rather than overtly water, which the team
  accepted.
- **Provisional** until a proper USPTO/EUIPO clearance in software classes (Nice
  9/42) and domain acquisition.
- **Repo and package identifiers stay `routewrangler`** (npm scope
  `@routewrangler/*`, repo name). The product brand is decoupled from code
  identifiers; the display name lives in one constant
  (`apps/web/src/design/brand.ts`) so it swaps in a single edit.

## Consequences

- Marketing/UI copy adopt "Verameter"; internal code, CI, and the repo keep
  "routewrangler" (no rename, no import churn).
- If clearance surfaces a problem, the change is one line.
- Close before public launch: trademark clearance + secure `verameter.com`
  (tracked in docs/questions.md).
