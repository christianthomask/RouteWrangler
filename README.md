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
docs/             Decision log (ADRs), runbook, open questions
```

## Quick start

Prereqs: **Node 22, pnpm 10, Docker**.

```bash
cp .env.example .env
pnpm install
pnpm db:up          # docker-compose Postgres
pnpm db:migrate     # apply checked-in Drizzle migrations
pnpm seed           # users + taxonomy + world + 12-month history + demo run
pnpm dev            # API on :3001
pnpm --filter @routewrangler/web dev   # web on :3000
```

### The headless pipeline demo (Sprint 1)

With the API running and `AUTH_DEV_BYPASS=true` in `.env` (local-only shim,
ADR-012), run the simulator against the public ingestion API:

```bash
SIM_READER_SUB='local-only:reader1' pnpm --filter @routewrangler/simulator playback
```

You'll watch validated reads land and typed exceptions open — one per validation
rule — with no UI. *"The pipeline works end to end with no UI."*

**One labeled cloud dependency:** auth uses a real **dev Cognito user pool** —
there is no official local Cognito emulator (ADR-004). Before the pool is
provisioned (`docs/runbook.md`), authenticated endpoints return a labeled `503`
and the seed runs in local-only mode. This is the pre-provisioning skeleton
state, and it is honest about it.

## What works today

**Sprint 0 — walking skeleton**
- Monorepo scaffold, shared Zod contracts, CI (build · lint · typecheck · test ·
  migrate · migration-check).
- NestJS API with a **real JWKS-based JWT guard** (Cognito), server-side role
  enforcement, `/health`, and the `/me` authenticated-hello endpoint.
- Seed that creates **both halves** (Cognito pool user + linked local row), with
  a labeled local-only fallback.
- Next.js app: branded login and role-gated `/field`, `/supervisor`, `/admin`
  shells that display the authenticated role.

**Sprint 1 — the headless core**
- Full schema + migrations (clients, meters, routes, runs, immutable
  read_events, exceptions, taxonomy lookups, exports, audit).
- **One public ingestion API** — `POST /ingest/read-events`: idempotent on the
  client-generated event id, single or batch, per-event statuses.
- **Validation rule registry** — one module per exception type: hi/lo vs the
  meter's own 12-month baseline, leak-spike, negative consumption, rollover
  (in-band annotate / out-of-band exception), zero-consumption streak,
  location-absent, duplicate-mismatch. Passing reads marked billable.
- `POST /photos/presign` (real S3, labeled 503 until provisioned), `GET
  /taxonomy`, minimal `GET /runs`.
- **Simulator** — deterministic seasonal generation + playback through the
  public API (zero privileged access), with an anomaly matrix that trips every
  rule. The seed backfills 12 months of history and stages today's demo run.
- Vitest: every anomaly asserts its exception, idempotency (DB-backed), rollover
  math, deterministic generation — 37 tests.

**Sprint 0 demo:** prod URL → branded login → authenticated hello with role.
*"It's deployed, it's real auth, it has a name."*

**Sprint 1 demo:** simulator → public API → validated reads + typed exceptions
in the database. *"The pipeline works end to end with no UI."*

## Production path

Deployment is manual and documented step-by-step in
[`docs/runbook.md`](./docs/runbook.md) (App Runner · Aurora Serverless v2 ·
S3 · Cognito · Vercel). IaC is deferred and labeled (Nice queue, BUILD_SPEC
§12). Decisions are logged in [`docs/decisions/`](./docs/decisions/).

## Where things go next

See `SPRINT_PLAN.md`. Sprint 1 = the headless core (full schema, ingestion,
validation rule registry, the simulator's seed/playback/anomaly modes).
