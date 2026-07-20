# ADR-019 — Cloudflare deployment via GitHub Actions

Status: Accepted (scaffolded; **unverified against a live account**).

## Context

Prod target is Cloudflare (ADR-015). The Claude Code session that authored this
cannot reach Cloudflare (egress proxy blocks `*.cloudflare.com`) or complete the
MCP OAuth, so deploys must run where Cloudflare is reachable: **GitHub Actions**
(or a local Claude Code instance with `wrangler login`). The API is a long-lived
NestJS server; the web app is Next.js.

## Decision

- **Web → Cloudflare Workers via OpenNext** (`@opennextjs/cloudflare`).
  `apps/web/wrangler.jsonc` + `open-next.config.ts`. (`next-on-pages` is
  deprecated.)
- **API → Cloudflare Containers.** A thin container Worker (`apps/api/worker/
  index.ts`, `@cloudflare/containers`) routes to the unmodified Nest server; the
  image is the monorepo-root `Dockerfile`. Scales to zero.
  - **Beta risk, flagged:** Cloudflare Containers is beta and this path is
    unverified. **Fallback:** the same image runs on Fly/Render; point the web
    app's `NEXT_PUBLIC_API_BASE_URL` at it and keep Cloudflare for web + R2.
- **DB → Neon** (the container connects directly via `DATABASE_URL`; no
  Hyperdrive needed since the API is a container, not a Worker).
- **Storage → R2** through the existing S3 adapter (env only — ADR-015).
- **Auth → Clerk** via the generic OIDC verifier (`AUTH_PROVIDER=oidc`).
- **Migrations** run in CI against Neon before either deploy
  (`.github/workflows/deploy.yml`, `workflow_dispatch`).

## Consequences

- Deploys never run from the Claude Code session; they run in CI or from a local
  CC. First green run is the verification.
- Deploy config (wrangler, Dockerfile, worker wrapper, workflow) lives outside
  the app build/lint/typecheck, so it doesn't gate the main CI — but is also not
  type-checked here; validate on first deploy.
- Container runtime secrets (`DATABASE_URL`, R2 keys) are set once via `wrangler
  secret put`, not committed.
- If Containers proves unreliable, switching the API to Fly/Render is a runbook
  change, not an app change.
