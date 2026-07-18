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
pnpm seed           # seed users (LOCAL-ONLY until a Cognito pool is configured)
pnpm dev            # API on :3001
pnpm --filter @routewrangler/web dev   # web on :3000
```

**One labeled cloud dependency:** auth uses a real **dev Cognito user pool** —
there is no official local Cognito emulator (ADR-004). Before the pool is
provisioned (`docs/runbook.md`), authenticated endpoints return a labeled `503`
and the seed runs in local-only mode. This is the pre-provisioning skeleton
state, and it is honest about it.

## What works today (Sprint 0 — walking skeleton)

- Monorepo scaffold, shared Zod contracts, CI (build · lint · typecheck · test ·
  migrate · migration-check).
- NestJS API with a **real JWKS-based JWT guard** (Cognito), server-side role
  enforcement, `/health`, and the `/me` authenticated-hello endpoint.
- Drizzle schema + migration for `users`; seed that creates **both halves**
  (Cognito pool user + linked local row), with a labeled local-only fallback.
- Next.js app: branded login and role-gated `/field`, `/supervisor`, `/admin`
  shells that display the authenticated role.
- Seven accepted ADRs; runbook (incl. the pricing-verification task); open
  questions log.

**Sprint 0 demo:** prod URL → branded login → sign in as the seeded supervisor
→ authenticated hello with role. *"It's deployed, it's real auth, it has a
name."*

## Production path

Deployment is manual and documented step-by-step in
[`docs/runbook.md`](./docs/runbook.md) (App Runner · Aurora Serverless v2 ·
S3 · Cognito · Vercel). IaC is deferred and labeled (Nice queue, BUILD_SPEC
§12). Decisions are logged in [`docs/decisions/`](./docs/decisions/).

## Where things go next

See `SPRINT_PLAN.md`. Sprint 1 = the headless core (full schema, ingestion,
validation rule registry, the simulator's seed/playback/anomaly modes).
