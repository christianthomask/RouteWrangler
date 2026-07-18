# ADR-001 — Stack and architecture

Status: Accepted (Sprint 0). **Amended by ADR-015** — compute (container) and DB
(Postgres) are portable; App Runner/Aurora are one target, not a hard dependency.

## Context

RouteWrangler is a production-shaped MDM system (BUILD_SPEC §1) that must
demonstrate real auth, migrations, deployment, and a clean data model on a tiny
idle budget (≈$5–15/mo, §11). It has a headless core (ingestion/validation), a
mobile-first offline field app, and a supervisor console, plus an in-repo
simulator that must have no privileged access to the pipeline.

## Decision

- **TypeScript end to end.** One language across web, API, contracts, simulator.
- **Monorepo, pnpm workspaces:** `apps/web` (Next.js App Router on Vercel),
  `apps/api` (NestJS on AWS App Runner), `packages/contracts` (shared Zod — the
  single source of request/response truth), `packages/simulator`, `docs/`.
- **Aurora Serverless v2 PostgreSQL via Drizzle** — plain-SQL-readable
  migrations, checked in. **S3** for photos/exports via presigned URLs.
  **Cognito** for auth (see ADR-004).
- **CommonJS for the backend workspaces** (`api`, `contracts`, `simulator`);
  the Next.js app uses bundler resolution. This keeps NestJS's decorator/DI
  emit on the well-trodden path and avoids ESM/CJS interop friction across the
  monorepo.
- **CI (GitHub Actions) gates every push:** build → lint → typecheck → test →
  migrate against a real Postgres → migration consistency check.

## Consequences

- One dependency graph, one type system; contracts changes ripple to both sides
  at compile time.
- Contracts must be built before dependents typecheck; CI runs a topological
  `pnpm -r build` first. Acceptable; revisit with TS project references if the
  ordering becomes a burden.
- App Runner + Aurora scale-to-zero keep idle cost low but add cold-start
  latency — acceptable for an internal tool; documented in the runbook.
- Choosing CommonJS now means a future ESM migration is a deliberate, separate
  effort rather than a default.
