# RouteWrangler

A **source-agnostic Meter Data Management (MDM) system** demonstrating the full
office side of contract water-meter reading — how a read is captured,
transferred, stored, validated, and exported to billing — for a fee-for-service
company that reads meters on behalf of many separately-contracted city utility
clients. Route data is **simulated**; the simulator is provably just another API
client (BUILD_SPEC §2.1).

> **Quality bar: production-shaped, not production-ready.** Everything shown is
> real — auth, migrations, deployment, data model, workflows. Everything stubbed
> is labeled, with its production path documented. We never fake a load-bearing
> thing.

## Scope lines (stated out loud)

- **No physical read-capture layer.** Capture tech (analog / touch / radio) is
  deliberately out of scope; reads enter through one abstract ingestion API.
- **No customer accounts or bills.** We hand validated reads to each city's
  billing system; the city owns the customer relationship.
- **No consumption estimation.** Gaps are **reported, never estimated** — a
  contract reader reports; it does not fabricate (ADR-006).

## Monorepo layout

```
apps/web          Next.js (App Router) — /login, /field, /supervisor, /admin
apps/api          NestJS — ingestion, validation, exceptions, exports, auth
packages/contracts   Shared Zod schemas — the single source of request/response truth
packages/simulator   Route simulator — talks ONLY to the public API (no privileged access)
verifier/         Automated UAT — boots the compiled API against a scratch database
docs/             Decision log (ADRs), runbook, project status
```

## Quick start

Prereqs: **Node 22, pnpm 10, Docker**.

```bash
cp .env.example .env
pnpm install
pnpm db:up          # docker-compose Postgres + MinIO (+ bucket)
pnpm db:migrate     # apply checked-in Drizzle migrations
pnpm seed           # users + taxonomy + world + 12-month history + demo run
pnpm dev            # API on :3001
pnpm --filter @routewrangler/web dev   # web on :3000
```

### The headless pipeline demo

With the API running and `AUTH_DEV_BYPASS=true` in `.env` (local-only shim,
ADR-012), run the simulator against the public ingestion API:

```bash
SIM_READER_SUB='local-only:reader1' pnpm --filter @routewrangler/simulator playback
```

You'll watch validated reads land and typed exceptions open — one per validation
rule — with no UI. *"The pipeline works end to end with no UI."*

**Runs with zero cloud signup.** The cloud is a config choice, not a code
dependency (ADR-015): auth, object storage, and the database each sit behind a
port. The default `.env` runs everything locally — docker Postgres, **MinIO**
(S3-compatible storage, identical presign flow to R2), and the dev-auth shim
(ADR-012, hard-disabled in production). The production target is **Cloudflare**
(Neon Auth · Neon Postgres · R2 · Workers), selected by `NEON_AUTH_BASE_URL` /
`S3_BUCKET` / `DATABASE_URL` — see the portability map in `docs/runbook.md`.
AWS and Azure are parked (ADR-026): the ports remain, the provider code is out
of the tree.

## What works today

Sprints 0–4 are shipped. The headline capabilities:

- **One public ingestion API** — `POST /ingest/read-events`: idempotent on the
  client-generated event id, single or batch, per-event statuses.
- **Validation rule registry** — one module per exception type: hi/lo vs the
  meter's own baseline, leak-spike, negative consumption, rollover (in-band
  annotate / out-of-band exception), zero-consumption streak, location-absent,
  duplicate-mismatch. Passing reads marked billable.
- **Supervisor console** — exception queue and detail with certification, runs,
  roster, assignment and mid-run splits, dashboard, exports. Escalation hands a
  decision to the admin queue without closing the item.
- **Field reader PWA** (ADR-020) — genuine offline store-and-forward: IndexedDB
  queue, capture-order sync, exactly-once via the queue id as the server's
  idempotency key, photo upload decoupled from read acceptance.
- **Offline route map** (ADR-022) — self-hosted PMTiles basemap over R2 range
  requests, pre-warmed per route, with a coordinate-plot fallback (ADR-021).
  Pack provisioning is scripted (`scripts/provision-tiles.sh`).
- **Billing export** (ADR-023) — per client and cycle, snapshotted immutably and
  re-served rather than re-rendered; supersede is transactional.
- **Skips carry evidence** (ADR-025) — reason plus a photograph, enforced
  server-side, raising a reviewable exception against the stop.
- **Auth** (ADR-027) — Neon Auth (managed Better Auth) behind a generic OIDC
  verifier that derives issuer, JWKS and audience from one base URL, with roles
  **DB-authoritative** (never read from the token). Google is the only sign-in
  method. An invitation is a `users` row with an email and no subject id; the
  auth guard attaches the identity on that person's first verified sign-in, so
  there is no webhook that can lose a delivery.
- **Simulator** — deterministic seasonal generation, playback through the public
  API with zero privileged access, and an anomaly matrix that trips every rule.

**198 tests** across API, contracts, web and simulator, plus **19 UAT scenarios**
in the versioned [`verifier/`](./verifier/README.md), which creates a scratch
database, boots the compiled API against it, and drives the whole system over
HTTP — simulator included, as an ordinary API client. It found two defects on
its first run that no unit test could see, and it prints what it did *not* prove
at the end of every run. CI runs build, lint, typecheck, migrations, the full
suite and the UAT against a real Postgres.

```bash
pnpm -r build && pnpm uat    # the pre-flight before showing anyone the product
```

**Demo:** simulator → public API → validated reads + typed exceptions in the
database. *"The pipeline works end to end with no UI."*

## Production path

The cloud target is a **config choice, not a rewrite** (ADR-015). **Cloudflare is
the chosen target** (ADR-019) — Workers/OpenNext for web, Containers for the API,
Neon for Postgres, R2 for storage, Neon Auth for identity (ADR-027) — deployed
from GitHub Actions, gated on green CI. AWS and Azure are parked, not wired.
Steps are in [`docs/runbook.md`](./docs/runbook.md).

## Where things go next

**[`docs/STATUS.md`](./docs/STATUS.md) is the single source of truth** for what
is built, what is verified versus merely scaffolded, and what is still open.
Start there. The reasoning behind each choice is in
[`docs/decisions/`](./docs/decisions/) (27 ADRs) and the operational steps are in
[`docs/runbook.md`](./docs/runbook.md).
