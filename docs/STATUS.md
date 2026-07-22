# Project status — single source of truth

**Last reconciled against code: 2026-07-22** (HEAD `153e4d8`).

This file is the one place that records **what is built, what is verified, and
what is still open**. It replaces `docs/questions.md`, which had drifted far
enough from the code to be misleading.

How to use it:

- **Shipped** means it exists in code and is covered by tests or was checked live.
- **Unverified** means the code exists but has never run against the real thing.
  This distinction is load-bearing — see the quality bar in the README.
- **Open** items carry an owner. Anything owned by **CTK** is a decision, not a
  task; don't build around it.

Governing specs — `BUILD_SPEC` and `SPRINT_PLAN` — are **maintained outside this
repository** (owner: CTK). ADRs and source comments cite them by section
(`BUILD_SPEC §7.2`, `SPRINT_PLAN risk note 2`); those citations resolve against
the external documents, not against anything in-tree.

---

## Where the project stands

Sprints 0 through 4 are shipped, followed by a deployment scaffold, an audit
remediation pass, two rounds of UAT fixes, and a backlog close-out. The system
runs end to end locally with no cloud vendor.

| Sprint | Scope | State |
| --- | --- | --- |
| 0 | Walking skeleton — monorepo, auth guard, CI, ADRs | Shipped |
| 1 | Headless core — schema, ingestion, validation registry, simulator | Shipped |
| 2 | Supervisor console — exceptions, dashboard, meter history | Shipped |
| 3 | Field reader PWA — offline store-and-forward, route map | Shipped |
| 4 | Route assignment + splits; billing export | Shipped |
| — | Cloudflare deploy scaffold, Clerk auth, staff administration | Shipped, **deploy unverified** |
| — | Audit remediation; UAT rounds 1–2; skip evidence | Shipped |

**Tests: 140 across 17 files** — 109 API (9 DB-backed, self-skipping without
`DATABASE_URL`), 18 contracts, 8 web, 5 simulator. CI runs build, lint,
typecheck, migrate, migration-check and the full suite against a real Postgres.

---

## Shipped and verified

**Ingestion & validation.** One public ingestion API (`POST /ingest/read-events`),
idempotent on a client-generated event id, single or batch, per-event statuses.
Nine exception codes, eight of them rule modules in a registry
(`packages/contracts/src/engine/rules.ts`); at most one consumption finding wins
by priority, independent findings stack, and `billable = !exceptions.some(blocksBilling)`.

**Immutable read events** (ADR-002), taxonomy as data with rules as code (ADR-003),
derived photo keys (ADR-013).

**Supervisor console.** Exception queue with low-severity collapsing, exception
detail with certification, runs, roster, assignment, dashboard, exports.

**Field PWA** (ADR-020). Real offline store-and-forward: IndexedDB queue,
capture-order sync, per-event independent acceptance, exactly-once via queue id
as the server idempotency key, photo upload decoupled from read acceptance,
service worker scoped to `/field` that refuses non-GET so it never races the queue.

**Offline basemap** (ADR-022). Self-hosted PMTiles over R2 range requests,
MapLibre client, z13–15 pre-warm per route bbox, with the coordinate-plot
fallback of ADR-021 still live.

**Billing export** (ADR-023). Keyed on (client, cycle). The rendered body is
snapshotted immutably and re-served on download rather than re-rendered.
Supersede runs inside a transaction so the partial unique index holds at every
step. One row per stop, never per exception.

**Skips carry evidence** (ADR-025). Reason required and resolved against the
taxonomy; photo enforced server-side, with `unsafe_conditions` deliberately
exempt. A skip opens a `skipped_unresolved` exception against the *stop* —
exceptions are polymorphic over read/stop with a DB check constraint enforcing
exactly one target. Reading a skipped stop later auto-resolves it.

**Auth.** One generic `OidcTokenVerifier`; Cognito/Entra/Clerk differ only as
config resolved in `env.ts`. Clerk is the chosen IdP via `AUTH_PROVIDER=oidc`.
Roles are **DB-authoritative** — the guard reads the DB row, never the token's
groups claim. Clerk webhook (Svix-verified) maps org membership to roles, and
revocation deactivates before attempting delete so an FK-blocked delete cannot
leave access alive.

**Dev auth bypass** (ADR-012) is hard-disabled in production independently on
both sides: the API collapses it at config load (`env.ts:150`), and the web fails
closed when Clerk is unconfigured in a production build.

**Staff administration** (ADR-024) behind a `StaffDirectoryPort` with Clerk and
local adapters.

**Storage.** One S3 adapter serves AWS S3, MinIO and R2 by endpoint config alone.

---

## Shipped but UNVERIFIED

These exist in code and have never been proven against the real service. Each is
labeled as such at its call site.

| Thing | Why unverified | Owner |
| --- | --- | --- |
| **Cloudflare deploy end to end** (ADR-019) | Never run against a live account. Cloudflare Containers is beta: scale-to-zero, ephemeral disk, no native autoscaling. Fallback documented — host the root `Dockerfile` on Fly/Render, keep Cloudflare for web + R2. | Dev + CTK |
| **Azure Blob adapter** | Written to the documented SAS contract, never run against a live Azure account. The S3/MinIO path is verified end to end. | Dev |
| **PMTiles tile packs** | The client is shipped and works; provisioning the packs to R2 is a manual infra step. Two packs are hardcoded in `apps/web/src/app/tiles/[z]/[x]/[y]/route.ts` (Central Coast, Bend OR). See `docs/runbooks/offline-basemap.md`. | Dev |

---

## Open decisions — owner CTK

Genuinely open. Not buildable around.

- **Product name clearance.** "Verameter" (ADR-017) is provisional and is now
  hardcoded throughout — service worker, IndexedDB name (`verameter-field`), R2
  bucket `verameter-photos`, deployed Worker names. Before public launch:
  USPTO/EUIPO clearance in Nice classes 9/42, and secure `verameter.com`.
  A rename is now a data-migration-shaped change, not a find-and-replace.
- **Validation thresholds.** `DEFAULT_VALIDATION_CONFIG` ships engineering
  defaults, not domain-blessed ones: high ≥ 2× baseline, leak ≥ 5×, low ≤ 0.3×,
  zero-streak 3 cycles, rollover band 2×, rollover proximity 0.9, duplicate
  tolerance 2, min 3 baseline reads. Confirm against real reading data with
  Jeramehl. Per-client overrides remain deferred.
- **Real route numbers.** Seed builds 3 clients × 2 routes × 10 meters (60
  meters, 720 history reads) for fast demos. Swapping in Jeramehl's real numbers
  is config, not code.
- **Cycle model.** `clients.cycle_length_days` and `cycle_anchor_day` exist in
  the schema but are read by nothing. All cycle derivation is one function
  returning `YYYY-MM`. Confirm whether real clients bill on calendar months or
  on anchored cycles before this is formalized — the answer changes exception
  streaks and exports.
- **IaC tool choice.** There is no IaC in the repo at all; infrastructure is
  wrangler config plus manual `wrangler secret put`. Terraform vs per-cloud
  (CDK/Bicep) is undecided and only matters once the deploy is verified.

---

## Open engineering items — owner Dev

Found by a code audit on 2026-07-22 and recorded rather than fixed, so each can
land as its own reviewable change.

**Cognito residue contradicts the Clerk deployment.** Cognito was half-removed.
Still present: the seed's Cognito pool provisioning (`apps/api/seed/cognito.ts`),
the `@aws-sdk/client-cognito-identity-provider` dependency, and the `cognito_sub`
column — which now stores Clerk user ids, so the column name is a lie. Two
concrete defects:

- `apps/api/src/auth/jwt-auth.guard.ts:93` returns *"provision the Cognito dev
  pool"* to users of a Clerk deployment.
- `apps/api/seed/seed.ts:19` gates `fullMode` on `authConfigured && hasAwsCreds`
  rather than on `AUTH_PROVIDER === 'cognito'`. Seeding a Clerk deployment with
  any AWS creds in the environment takes the Cognito path and throws.
- `.env.example:19` ships `AUTH_PROVIDER=cognito` while `wrangler.jsonc:26`
  deploys `oidc`.

**Cycle boundaries use UTC while run dates use client timezone.**
`currentCycleId()` (`apps/api/src/catalog/catalog.service.ts:8`) truncates a UTC
date, but run dates, "today", aging and export dates all go through
`dateIn(tz)`. For a Pacific client late in the month these disagree — the same
class of bug that commit `2021bf6` was spent eliminating elsewhere. Also
`AssignmentInput.cycleId` is a free-form unvalidated string.

**`baselineMonths: 12` is declared but never enforced.** `derive()` averages the
entire history passed to it; the windowing is left to callers.

**Web test coverage is thin.** 8 tests across 2 files, both in `lib/field/`.
Nothing covers `queue.ts` (280 lines — the exactly-once engine), `mapCache.ts`,
or the 741-line capture page. No E2E framework.

**ADR-004 has no Clerk decision record.** It is amended-not-rewritten and its
body still asserts "one Cognito user pool per environment." The Clerk choice is
documented only inside ADR-019 and the runbook — it deserves its own ADR.

---

## Pointers

- Decisions: [`docs/decisions/`](./decisions/) — 25 ADRs
- Operations: [`docs/runbook.md`](./runbook.md)
- Basemap provisioning: [`docs/runbooks/offline-basemap.md`](./runbooks/offline-basemap.md)
- Design: [`docs/design/component-inventory.md`](./design/component-inventory.md)
