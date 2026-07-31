# Project status — single source of truth

**Last reconciled against code: 2026-07-30** (HEAD `7c797e0`).

This file is the one place that records **what is built, what is verified, and
what is still open**.

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
remediation pass, two rounds of UAT fixes, a backlog close-out, and the pivot to
Neon Auth. The system runs end to end locally against one vendor's free tier or
none at all.

| Sprint | Scope | State |
| --- | --- | --- |
| 0 | Walking skeleton — monorepo, auth guard, CI, ADRs | Shipped |
| 1 | Headless core — schema, ingestion, validation registry, simulator | Shipped |
| 2 | Supervisor console — exceptions, dashboard, meter history | Shipped |
| 3 | Field reader PWA — offline store-and-forward, route map | Shipped |
| 4 | Route assignment + splits; billing export | Shipped |
| — | Cloudflare deploy scaffold, staff administration | Shipped, **deploy unverified** |
| — | Audit remediation; UAT rounds 1–2; skip evidence | Shipped |
| — | Neon Auth (ADR-027); AWS/Azure parked (ADR-026); automated UAT | Shipped |

**Tests: 198 across 21 files** — 132 API (16 DB-backed, self-skipping without
`DATABASE_URL`), 34 web, 27 contracts, 5 simulator. Plus **19 UAT scenarios** in
`verifier/`, which boots the compiled API against a scratch database and drives
the whole system over HTTP. CI runs build, lint, typecheck, migrate,
migration-check, the full suite, and the UAT, all against a real Postgres.

---

## Shipped and verified

**Ingestion & validation.** One public ingestion API (`POST /ingest/read-events`),
idempotent on a client-generated event id, single or batch, per-event statuses.
Nine exception codes, eight of them rule modules in a registry
(`packages/contracts/src/engine/rules.ts`); at most one consumption finding wins
by priority, independent findings stack, and `billable = !exceptions.some(blocksBilling)`.
The baseline window (`baselineMonths`) is enforced inside the engine rather than
left to callers, so the field app's preview and the server's verdict are computed
over the same reads.

**Immutable read events** (ADR-002), taxonomy as data with rules as code (ADR-003),
derived photo keys (ADR-013).

**Supervisor console.** Exception queue with low-severity collapsing, exception
detail with certification, runs, roster, assignment, dashboard, exports.

**Field PWA** (ADR-020). Real offline store-and-forward: IndexedDB queue,
capture-order sync, per-event independent acceptance, exactly-once via queue id
as the server idempotency key, photo upload decoupled from read acceptance,
service worker scoped to `/field` that refuses non-GET so it never races the queue.
A concurrent sync now joins the pass in flight instead of returning early and
leaving the capture that triggered it queued until something else happened.

**Offline basemap** (ADR-022). Self-hosted PMTiles over R2 range requests,
MapLibre client, z13–15 pre-warm per route bbox, with the coordinate-plot
fallback of ADR-021 still live.

**Billing export** (ADR-023). Keyed on (client, cycle). The rendered body is
snapshotted immutably and re-served on download rather than re-rendered.
Supersede runs inside a transaction, and the self-referencing foreign key is
deferred (migration 0011) so the partial unique index holds at every step —
before that, every re-run was a 500. One row per stop, never per exception.

**Skips carry evidence** (ADR-025). Reason required and resolved against the
taxonomy; photo enforced server-side, with `unsafe_conditions` deliberately
exempt. A skip opens a `skipped_unresolved` exception against the *stop* —
exceptions are polymorphic over read/stop with a DB check constraint enforcing
exactly one target. Reading a skipped stop later auto-resolves it.

**Auth** (ADR-027). One generic `OidcTokenVerifier`; **Neon Auth** is the chosen
IdP and needs exactly one setting, `NEON_AUTH_BASE_URL`, from which issuer, JWKS
and audience are derived. Google is the only sign-in method. Roles are
**DB-authoritative** — the guard reads the DB row, never the token's claims.
Invitations are `users` rows with an email and no subject id; the guard attaches
the identity on the invitee's first verified sign-in, so there is no webhook to
lose a delivery.

**Dev auth bypass** (ADR-012) is hard-disabled in production independently on
both sides: the API collapses it at config load, and the web fails closed when no
auth URL is configured in a production build.

**Staff administration** (ADR-024) behind a `StaffDirectoryPort` with `oidc` and
`local` adapters, plus withdrawal of an unaccepted invitation.

**Storage.** One S3 adapter serves AWS S3, MinIO and R2 by endpoint config alone.

---

## Shipped but UNVERIFIED

These exist in code and have never been proven against the real service. Each is
labeled as such at its call site.

| Thing | Why unverified | Owner |
| --- | --- | --- |
| **Cloudflare deploy end to end** (ADR-019) | **The pipeline ran green for the first time on 2026-07-30** (`cf1b068`): migrations applied to Neon, the API container deployed, the web app built with OpenNext and deployed. That is three jobs exiting zero — it is *not* evidence that the deployed services answer requests. Cloudflare Containers is beta (scale-to-zero, ephemeral disk, no native autoscaling), and nobody has hit the deployed URLs. Fallback still documented — host the root `Dockerfile` on Fly/Render, keep Cloudflare for web + R2. **Next check:** `GET /health` on the deployed API (it is `@Public()`, so it answers without auth). | Dev + CTK |
| **Neon Auth sign-in** (ADR-027) | The API's verification path is standards-only (`jose` against a JWKS) and unit-tested, but nobody has completed a Google sign-in against a real Neon Auth instance. The automated UAT *cannot* cover this — its scratch environment has no IdP — and says so on every run. **The deployed environment is currently unconfigured for it:** `NEON_AUTH_BASE_URL` (wrangler secret) and `NEXT_PUBLIC_NEON_AUTH_URL` (GitHub repo variable) are new in ADR-027 and replace the Clerk values, so unless they were set by hand after this deploy they are unset. Expect the deployed login page to read "Identity provider pending setup" and authenticated API endpoints to answer a labeled 503 — both are the intended fail-closed behaviour (ADR-012, H9), not a fault. See the runbook §1 and §2. | Dev + CTK |
| **`@neondatabase/auth` is 0.4.2-beta** | A beta SDK on the web sign-in and token-refresh path. It also declares a peer dependency on Next ≥ 16 while the app is on 15; nothing imported touches Next and the build is clean, but that compatibility is unproven. The API side would survive the SDK being replaced. | Dev |
| **PMTiles tile packs** | The client is shipped and works; provisioning the packs to R2 is a manual infra step. Two packs are hardcoded in `apps/web/src/app/tiles/[z]/[x]/[y]/route.ts` (Central Coast, Bend OR). See `docs/runbooks/offline-basemap.md`. **Demo consequence:** with no packs provisioned, `/tiles/{z}/{x}/{y}` answers `204` and the field route map renders as an unzoomed world basemap — which reads as broken rather than as unconfigured. Before a stakeholder session, either provision the packs or set `NEXT_PUBLIC_MAP_STYLE_URL=''` to force the coordinate-plot fallback (ADR-021), which looks deliberate. | Dev |

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
  returning `YYYY-MM`, now enforced by `CycleIdSchema`. Confirm whether real
  clients bill on calendar months or on anchored cycles before this is
  formalized — the answer changes exception streaks and exports.
- **IaC tool choice.** There is no IaC in the repo at all; infrastructure is
  wrangler config plus manual `wrangler secret put`. Terraform vs per-cloud
  (CDK/Bicep) is undecided and only matters once the deploy is verified.

---

## Open engineering items — owner Dev

**No E2E framework for the web app.** The UAT covers the API and the pipeline
end to end, and the offline queue and tile pre-warm now have real unit tests
(34 web tests, up from 8). What nothing covers is the browser: the 741-line
capture page is exercised only through the functions it calls.

**Photo storage is unexercised by the UAT.** Presigning is local crypto and is
unit-tested against both MinIO and R2 endpoint shapes, but no automated run
uploads a byte. Set `S3_BUCKET` and the UAT will use it; nothing yet asserts on
the result.

---

## What the last audit closed

Recorded here so the same items are not re-filed. All fixed on 2026-07-30:

- Cognito residue that contradicted the deployment — the seed's pool
  provisioning, the AWS SDK dependency, the `cognito_sub` column name, the
  guard's "provision the Cognito dev pool" message, and `.env.example` disagreeing
  with `wrangler.jsonc`. Cognito, Entra and Azure Blob are gone (ADR-026).
- `currentCycleId()` truncating a UTC date while every other date went through
  the client's timezone.
- `baselineMonths: 12` declared but never enforced.
- Thin web test coverage over `queue.ts` and `mapCache.ts`.
- ADR-004 having no successor record for the IdP choice — now ADR-026 and ADR-027.

And two found by the new automated UAT, neither visible to any unit test:

- **The baseline query returned nothing for any real field read.** `run_stop_id
  <> $1` is NULL — and so not true — for every row where the column is NULL,
  which is all back-filled history. No consumption rule could fire; reads came
  back clean and billable with a null consumption.
- **Export supersede could never commit.** The self-referencing foreign key was
  immediate, so pointing the current row at the row about to be inserted was
  rejected. Every re-run was a 500.

---

## Pointers

- Decisions: [`docs/decisions/`](./decisions/) — 27 ADRs
- Automated UAT: [`verifier/README.md`](../verifier/README.md)
- Operations: [`docs/runbook.md`](./runbook.md)
- Basemap provisioning: [`docs/runbooks/offline-basemap.md`](./runbooks/offline-basemap.md)
- Design: [`docs/design/component-inventory.md`](./design/component-inventory.md)
