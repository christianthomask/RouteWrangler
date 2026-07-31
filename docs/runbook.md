# RouteWrangler — Runbook

Operational steps for running and provisioning RouteWrangler. **The cloud target
is a config choice, not a code change (ADR-015):** the app runs against
Cloudflare or a fully local stack by setting `AUTH_PROVIDER` / `STORAGE_PROVIDER`
and `DATABASE_URL`, and any OIDC provider drops in through the generic adapter.
**Cloudflare is the chosen target** (ADR-019). There is no IaC; provisioning
below is manual and documented step by step.

Build state — what is shipped, verified, or still open — lives in
[`docs/STATUS.md`](./STATUS.md).

## Portability map (ADR-015, ADR-026)

| Concern | Neutral core | Cloudflare (chosen) | Local | Elsewhere |
| --- | --- | --- | --- | --- |
| API | container | Containers¹ (or Fly/Render) | `pnpm dev` | any container host |
| DB | Postgres (`DATABASE_URL`) | Neon + Hyperdrive² | docker Postgres | any Postgres |
| Storage | `StoragePort` | **R2** (the S3 adapter) | MinIO | any S3-compatible |
| Auth | OIDC `TokenVerifier` | **Neon Auth**³ | dev-auth shim | any OIDC IdP |
| Web | Next.js | Workers (OpenNext) | `next dev` | Vercel, etc. |

¹ Cloudflare Containers is Workers-Paid-gated and beta-flavored (scale-to-zero,
ephemeral disk, no native autoscaling); for guaranteed always-on, host the API on
Fly/Render and use Cloudflare for edge/storage. ² Cloudflare has **no managed
Postgres** — bring Neon, optionally fronted by Hyperdrive. ³ Cloudflare has **no
CIAM**; Cloudflare Access is zero-trust SSO, not app-user auth. The app uses
**Neon Auth** (ADR-027), which stores users and sessions in the Neon Postgres it
already has.

**AWS and Azure were parked, not supported (ADR-026).** The Cognito, Entra and
Azure Blob adapters were deleted rather than kept as unexercised paths. The ports
remain, so either is an adapter away — but it *is* an adapter, not an environment
variable, and this table no longer implies otherwise.

**R2 is the standout fit:** the existing S3 adapter talks to R2 with only an
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
  (ADR-012, hard-disabled in production). No IdP needed; `pnpm seed` writes rows
  with `local-only:` subjects that only the shim will accept.
- **Storage:** `STORAGE_PROVIDER=s3` pointed at **MinIO** (`S3_ENDPOINT=
  http://localhost:9000`) — the same S3 adapter used for R2, identical presign
  flow. MinIO console at http://localhost:9001 (minioadmin/minioadmin).
- **DB:** docker Postgres via `DATABASE_URL`.

Run the headless pipeline end to end:

```bash
SIM_READER_SUB='local-only:reader1' pnpm --filter @routewrangler/simulator playback
```

### Before showing anyone the product

```bash
pnpm -r build && pnpm uat
```

The automated UAT ([`verifier/README.md`](../verifier/README.md)) creates its own
scratch database, boots the compiled API against it, drives the whole system over
HTTP, and prints both what passed and what it could not prove. **If it is red, do
not run the session.**

---

## 1. Deploy — Cloudflare target (ADR-019)

Deploys run in **GitHub Actions** (`.github/workflows/deploy.yml`) — automatically
on green CI for `main`, or via manual `workflow_dispatch` (see *Deploy* below).
They can also be run from a local machine with `wrangler login`, but never from a
remote Claude Code session, whose egress proxy blocks `*.cloudflare.com`.

### One-time provisioning (from local CC or the Cloudflare dashboard)
1. **Neon** — create a Postgres project; copy the direct (non-pooled) connection
   string → this is `DATABASE_URL`.
2. **Neon Auth** — enable it on the project and turn on **Google** as a sign-in
   method. Copy the branch's **Auth URL**
   (`https://<endpoint>.<region>.aws.neon.tech/<database>/auth`) → this is
   `NEON_AUTH_BASE_URL`, and the same value goes to the web app as
   `NEXT_PUBLIC_NEON_AUTH_URL`.

   That is the whole auth configuration. Issuer, JWKS and audience are derived
   from it (ADR-027) — and note that issuer and audience are the URL's **origin**,
   not the full path, which is exactly why they are derived rather than typed.

   There is **no webhook to configure and no organization to create.** Staff are
   invited through Admin → Staff, which writes a `users` row with their email and
   no identity; the auth guard attaches the identity the first time that person
   signs in with Google using that address.
3. **R2** — `wrangler r2 bucket create verameter-photos`; create an R2 API token
   (access key id + secret).
4. **Cloudflare API token** — with Workers Scripts + Containers + R2 edit perms;
   note it and your **account id**.

### Deployed URLs

| | URL |
| --- | --- |
| API | `https://verameter-api.verameter.workers.dev` |
| Web | `https://verameter-web.verameter.workers.dev` |

`GET /health` on the API is `@Public()`, so it is the one-request check that the
container booted and reached the database — no credentials needed:

```bash
curl https://verameter-api.verameter.workers.dev/health
# {"status":"ok","service":"routewrangler-api","db":"up"}
```

Expect the first request after idle to take ~5s: Containers scales to zero
(ADR-019), so a cold start is paid by whoever asks first. Warm requests are ~1s.

### GitHub secrets & variables (repo → Settings)
Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`.
Variables: `NEXT_PUBLIC_API_BASE_URL` (the deployed API URL),
`NEXT_PUBLIC_NEON_AUTH_URL` (the Auth URL from step 2).

With the `gh` CLI, the two that ADR-027 introduced are:

```bash
gh variable set NEXT_PUBLIC_NEON_AUTH_URL -R <owner>/RouteWrangler   # web build
gh variable delete NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY -R <owner>/RouteWrangler
# and, from apps/api:
wrangler secret put NEON_AUTH_BASE_URL                                # API runtime
```

The variable is read at **build** time and the secret at **run** time, so setting
the variable requires a redeploy of the web Worker to take effect; the secret
takes effect on the API's next start.

> Leave `NEXT_PUBLIC_NEON_AUTH_URL` unset and the production web build fails
> closed to "identity provider pending setup" — it never falls back to the dev
> bypass (ADR-012, H9).

### API container runtime secrets (set once via wrangler, from `apps/api`)
```bash
wrangler secret put DATABASE_URL           # Neon direct connection string
wrangler secret put NEON_AUTH_BASE_URL     # the branch Auth URL from step 2
wrangler secret put S3_ACCESS_KEY_ID       # R2 access key id
wrangler secret put S3_SECRET_ACCESS_KEY   # R2 secret
wrangler secret put S3_ENDPOINT            # https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

Two operational notes:

- **`APP_TIMEZONE`** is a non-secret var (`wrangler.jsonc`), not a secret. It
  defaults to `America/Los_Angeles` and is only the default for *new* clients —
  each client carries its own `clients.timezone`, which is what actually decides
  run dates, "today", aging and export dates (see `apps/api/src/config/clock.ts`).
- **Admin → Staff needs `NEON_AUTH_BASE_URL` set.** Without it the API resolves
  the `local` staff adapter, which is refused outside development, so creating
  staff returns a labeled 400 rather than minting an account nobody could sign in
  as. Roles and deactivation still work; only invitations need the IdP.

Non-secret, non-identifying vars are committed in `apps/api/wrangler.jsonc`
(`AUTH_PROVIDER=neon`, `STORAGE_PROVIDER=s3`, `S3_BUCKET=verameter-photos`,
`S3_FORCE_PATH_STYLE=true`, `S3_REGION=auto`, `NODE_ENV=production`). The auth
URL, endpoint and keys are secrets above, kept out of the public repo.

### Deploy
**Pushing to `main` deploys automatically** — but only once **CI** has gone green
on that same commit. Deploy chains off CI (`workflow_run`) rather than off the
push, because the first thing it does is migrate the production database, and CI
is what proves the migration and the code are sound (it lints, typechecks, runs
migrations against a real Postgres, runs the full suite, and runs the automated
UAT). All three deploy jobs check out the exact sha CI verified, not whatever
`main` points at by then.

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

## 2. First sign-in to a fresh deployment

The chicken-and-egg: staff are invited by an admin, and at first there is no
admin. Seeded users carry `local-only:` subjects that no real IdP will ever
present, so nobody can sign in as them in a deployed environment.

1. Sign in to the deployed web app with the Google account that should be the
   first admin. It will be refused — correctly, because no row invites it.
2. Insert that first row directly, once:
   ```sql
   INSERT INTO users (email, display_name, role)
   VALUES ('you@example.com', 'Your Name', 'admin');
   ```
   No subject id: this is an invitation, and it is claimed on the next sign-in.
3. Sign in again. The guard links the identity to that row and you are an admin.
4. Everyone after this goes through **Admin → Staff**.

---

## 3. Acceptance

Local, end to end with no cloud vendor — the headless pipeline in §0: simulator
→ public ingestion API → validated reads and typed exceptions in the database.
`pnpm uat` asserts that pipeline and eighteen other criteria automatically.

Deployed: prod URL → Google sign-in via Neon Auth → role-gated `/field`,
`/supervisor` and `/admin`, with the role resolved from the database rather than
the token. **This last step is the one thing the automated UAT cannot do** — its
scratch environment has no identity provider — so it is checked by signing in.

Current build state, and what is verified versus merely scaffolded, is tracked
in [`docs/STATUS.md`](./STATUS.md).
