# RouteWrangler — Runbook

Operational steps for running and provisioning RouteWrangler. **The cloud target
is a config choice, not a code change (ADR-015):** the app runs against
Cloudflare, AWS, Azure, or a fully local stack by setting `AUTH_PROVIDER` /
`STORAGE_PROVIDER` and `DATABASE_URL`. **Cloudflare is the chosen target**
(ADR-019). There is no IaC; provisioning below is manual and documented step by
step.

Build state — what is shipped, verified, or still open — lives in
[`docs/STATUS.md`](./STATUS.md).

## Portability map (ADR-015)

| Concern | Neutral core | AWS | Azure | Cloudflare | Local |
| --- | --- | --- | --- | --- | --- |
| API | container | App Runner | Container Apps | Containers¹ (or Fly/Render) | `pnpm dev` |
| DB | Postgres (`DATABASE_URL`) | Aurora Serverless v2 | Azure DB for PostgreSQL | Neon + Hyperdrive² | docker Postgres |
| Storage | `StoragePort` | S3 | Azure Blob | **R2 (existing S3 adapter)** | MinIO (S3-compatible) |
| Auth | OIDC `TokenVerifier` | Cognito | Entra External ID | **Clerk** (OIDC)³ | dev-auth shim |
| Web | Next.js | Vercel | Static Web Apps | Workers (OpenNext) | `next dev` |

¹ Cloudflare Containers is Workers-Paid-gated and beta-flavored (scale-to-zero,
ephemeral disk, no native autoscaling); for guaranteed always-on, host the API on
Fly/Render and use Cloudflare for edge/storage. ² Cloudflare has **no managed
Postgres** — bring Neon/Supabase, optionally fronted by Hyperdrive. ³ Cloudflare
has **no CIAM**; Cloudflare Access is zero-trust SSO, not app-user auth — the app
uses **Clerk** via the generic OIDC adapter (`AUTH_PROVIDER=oidc`, see .env.example).

**R2 is the standout fit:** our existing S3 adapter talks to R2 with only an
endpoint + access-key change (zero code), and R2 has no egress fees.

---

## 0. Local development — zero cloud signup

Prereqs: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env          # defaults: local Postgres + MinIO + dev auth
pnpm install
pnpm db:up                    # docker-compose Postgres + MinIO (+ bucket)
pnpm db:migrate               # apply checked-in Drizzle migrations
pnpm seed                     # users + taxonomy + world + history + demo run
pnpm dev                      # NestJS API on :3001
# in another shell:
pnpm --filter @routewrangler/web dev   # Next.js on :3000
```

The default `.env` runs the **entire system with no cloud vendor** (ADR-015):

- **Auth:** `AUTH_DEV_BYPASS=true` — the API trusts an `x-dev-user-sub` header
  (ADR-012, hard-disabled in production). No IdP needed. `pnpm seed` runs in
  **local-only** mode (Postgres rows, `local-only:` subs).
- **Storage:** `STORAGE_PROVIDER=s3` pointed at **MinIO** (`S3_ENDPOINT=
  http://localhost:9000`) — the same S3 adapter used for AWS, identical presign
  flow. MinIO console at http://localhost:9001 (minioadmin/minioadmin).
- **DB:** docker Postgres via `DATABASE_URL`.

Run the headless pipeline end to end:

```bash
SIM_READER_SUB='local-only:reader1' pnpm --filter @routewrangler/simulator playback
```

---

## 1. Deploy — Cloudflare target (ADR-019)

Deploys run in **GitHub Actions** (`.github/workflows/deploy.yml`) — automatically
on green CI for `main`, or via manual `workflow_dispatch` (see *Deploy* below).
They can also be run from a local machine with `wrangler login`, but never from a
remote Claude Code session, whose egress proxy blocks `*.cloudflare.com`.

### One-time provisioning (from local CC or the Cloudflare dashboard)
1. **Neon** — create a Postgres project; copy the direct (non-pooled) connection
   string → this is `DATABASE_URL`.
2. **R2** — `wrangler r2 bucket create verameter-photos`; create an R2 API token
   (access key id + secret).
3. **Clerk** — create an application; note the **publishable key** and the
   **issuer** (`https://<slug>.clerk.accounts.dev`). Then:
   - **Enable Organizations** and create custom org roles `org:reader`,
     `org:supervisor`, `org:admin`. Roles are provisioned into the DB from
     org membership (the API is DB-authoritative — it does not read token
     roles), so add each staff member to the org with the right role.
   - Create a **JWT template named `api`** with an `aud` claim (e.g. `verameter-api`).
     The web calls `getToken({ template: 'api' })`; the API verifies that `aud`
     via `OIDC_AUDIENCE`, so it rejects any token not minted for it.
   - Add a **webhook** → `https://<deployed-api>/webhooks/clerk`, subscribed to
     `organizationMembership.created/updated/deleted`; note the **signing secret**
     (`CLERK_WEBHOOK_SECRET`).
4. **Cloudflare API token** — with Workers Scripts + Containers + R2 edit perms;
   note it and your **account id**.

### GitHub secrets & variables (repo → Settings)
Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`.
Variables: `NEXT_PUBLIC_API_BASE_URL` (the deployed API URL),
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.

### API container runtime secrets (set once via wrangler, from `apps/api`)
```bash
wrangler secret put DATABASE_URL           # Neon direct connection string
wrangler secret put S3_ACCESS_KEY_ID       # R2 access key id
wrangler secret put S3_SECRET_ACCESS_KEY   # R2 secret
wrangler secret put S3_ENDPOINT            # https://<ACCOUNT_ID>.r2.cloudflarestorage.com
wrangler secret put OIDC_ISSUER            # Clerk issuer, e.g. https://<slug>.clerk.accounts.dev
wrangler secret put OIDC_JWKS_URI          # <issuer>/.well-known/jwks.json
wrangler secret put OIDC_AUDIENCE          # aud of the Clerk "api" JWT template
wrangler secret put CLERK_WEBHOOK_SECRET   # Svix secret for POST /webhooks/clerk
wrangler secret put CLERK_SECRET_KEY       # sk_... — lets Admin → Staff invite people (ADR-024)
wrangler secret put CLERK_ORGANIZATION_ID  # org_... — the org invitations are sent into
```

Two operational notes:

- **`APP_TIMEZONE`** is a non-secret var (`wrangler.jsonc`), not a secret. It
  defaults to `America/Los_Angeles` and is only the default for *new* clients —
  each client carries its own `clients.timezone`, which is what actually decides
  run dates, "today", aging and export dates (see `apps/api/src/config/clock.ts`).
- **Admin → Staff needs the two Clerk values above.** Without them the API
  resolves the `local` staff adapter, which is refused outside development, so
  creating staff returns a labeled 400 rather than minting an account nobody
  could sign in as. Roles and deactivation still work; only invitations need Clerk.

Non-secret, non-identifying vars are committed in `apps/api/wrangler.jsonc`
(`AUTH_PROVIDER=oidc`, `STORAGE_PROVIDER=s3`, `S3_BUCKET=verameter-photos`,
`S3_FORCE_PATH_STYLE=true`, `AWS_REGION=auto`, `NODE_ENV=production`). Issuer,
audience, endpoint and keys are secrets above (kept out of the public repo).

### Deploy
**Pushing to `main` deploys automatically** — but only once **CI** has gone green
on that same commit. Deploy chains off CI (`workflow_run`) rather than off the
push, because the first thing it does is migrate the production database, and CI
is what proves the migration and the code are sound (it lints, typechecks, runs
migrations against a real Postgres, and runs the full suite). All three deploy
jobs check out the exact sha CI verified, not whatever `main` points at by then.

The pipeline is: applies migrations to Neon → builds the web app with OpenNext
and `wrangler deploy` (Worker) → builds/pushes the API image and deploys the
container Worker.

If CI fails, nothing deploys. To ship without waiting on CI — or to re-run
migrations against an unchanged tree — dispatch **Deploy (Cloudflare)** manually.

> A failing migration is a safe failure: `migrate` runs before both deploy jobs,
> so the running web and API are left untouched.

> **Beta caveat (ADR-019):** Cloudflare Containers is beta and this path is
> unverified. If it misbehaves, host the root `Dockerfile` image on **Fly/Render**
> and point `NEXT_PUBLIC_API_BASE_URL` at it — Cloudflare still serves web + R2.

---

## 2. Provisioning — Azure target (ADR-015)

Same app, different provider config. Verify Azure pricing before provisioning
(free account: $200/30-day credit + 12-month free tiers; Container Apps consumption
scales to zero). **Note:** Azure sign-up also requires a verifiable card.

1. **Auth — Microsoft Entra External ID** (CIAM). Create a tenant + app
   registration; map app roles `reader`/`supervisor`/`admin`. Set
   `AUTH_PROVIDER=entra`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`. (Issuer/JWKS are
   derived automatically.)
2. **DB — Azure Database for PostgreSQL Flexible Server.** Create; set
   `DATABASE_URL`; `pnpm db:migrate`.
3. **Storage — Azure Blob.** Create a storage account + a `photos` container.
   Set `STORAGE_PROVIDER=azure_blob`, `AZURE_STORAGE_ACCOUNT`,
   `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_ACCOUNT_KEY`. ⚠️ The Blob adapter is
   implemented but **not yet verified against a live account** (docs/STATUS.md).
4. **API — Azure Container Apps.** Deploy the `apps/api` container; env from a
   Key Vault / secret store; ingress health probe `/health`; consumption plan
   (scale-to-zero).
5. **Web — Vercel or Azure Static Web Apps.** Set `NEXT_PUBLIC_API_BASE_URL` and
   the Entra client config.

---

## 3. Acceptance

Local, end to end with no cloud vendor — the headless pipeline in §0: simulator
→ public ingestion API → validated reads and typed exceptions in the database.

Deployed: prod URL → branded login (Clerk) → role-gated `/field`, `/supervisor`
and `/admin`, with the role resolved from the database rather than the token.

Current build state, and what is verified versus merely scaffolded, is tracked
in [`docs/STATUS.md`](./STATUS.md).
