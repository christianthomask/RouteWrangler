# RouteWrangler — Runbook

Operational steps for running and provisioning RouteWrangler. **The cloud target
is a config choice, not a code change (ADR-015):** the app runs against AWS,
Azure, or a fully local stack by setting `AUTH_PROVIDER` / `STORAGE_PROVIDER` and
`DATABASE_URL`. IaC is deferred (Nice queue §12); provisioning below is manual
and documented step by step.

## Portability map (ADR-015)

| Concern | Neutral core | AWS target | Azure target | Local |
| --- | --- | --- | --- | --- |
| API | container | App Runner | Container Apps | `pnpm dev` |
| DB | Postgres (`DATABASE_URL`) | Aurora Serverless v2 | Azure DB for PostgreSQL | docker Postgres |
| Storage | `StoragePort` | S3 | Azure Blob | MinIO (S3-compatible) |
| Auth | OIDC `TokenVerifier` | Cognito | Entra External ID | dev-auth shim |

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

## 1. Pricing verification (Sprint 0 — DO THIS BEFORE PROVISIONING)

Target idle footprint ≈ **$5–15/mo**. Verify current terms and record the
result in `docs/questions.md` for CTK sign-off **before** creating paid
resources. Flag to CTK if reality disagrees with the table below.

| Component | Idle cost driver | What to verify | Est. idle |
| --- | --- | --- | --- |
| App Runner | pause-when-idle / min instances | Confirm you can scale the service to **0 provisioned** (or use pause); an always-warm min instance is the main idle-cost risk | ~$0 paused, else ~$5–7/mo per 0.25 vCPU warm |
| Aurora Serverless v2 | min ACUs; **scale-to-zero** | Confirm scale-to-zero (auto-pause to 0 ACU) is available in the chosen region and the resume latency is acceptable | ~$0 paused; ~$0.06/ACU-hr when active |
| S3 | storage + requests | Negligible at demo volume | < $1/mo |
| Cognito | MAU free tier | Confirm current free-tier MAU allowance covers the seed roster + demo | $0 within free tier |
| Vercel | hobby/pro | Confirm the plan covers one app | $0 hobby |

> The numbers above are **estimates to be confirmed against live pricing at
> provisioning time**, not quotes. Do not provision until this table is
> confirmed and logged.

---

## 2. Provisioning (dev, then prod) — manual, per environment

Do this once per environment (`dev`, then `prod`). Record IDs/ARNs in the
environment's secret store; never commit them.

### 2.1 Cognito user pool
1. Create a user pool (custom UI — hosted UI not required).
2. Create an app client (no client secret for the SPA; enable
   `USER_SRP_AUTH`).
3. Create three groups: `reader`, `supervisor`, `admin`.
4. Record `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `AWS_REGION`.
5. Fill `.env` (API) and `NEXT_PUBLIC_COGNITO_*` (web). Re-run `pnpm seed`
   with AWS creds present to provision pool users and link local rows.

### 2.2 Aurora Serverless v2 (PostgreSQL)
1. Create an Aurora PostgreSQL cluster, Serverless v2, min capacity set to allow
   **scale-to-zero**; note the writer endpoint.
2. Set `DATABASE_URL` in the environment secret store.
3. Run `pnpm db:migrate` against it.

### 2.3 S3
1. Create a private bucket for photos + export files.
2. Grant the API's role `PutObject`/`GetObject` (presigned URLs only).
3. Set `S3_BUCKET`.

### 2.4 App Runner (API)
1. Deploy `apps/api` (container). Configure env from the secret store.
2. Health check path: `/health`.
3. Confirm the idle/pause behaviour matches §1.

### 2.5 Vercel (web)
1. Import `apps/web`. Set `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_COGNITO_*`.
2. Deploy; verify the branded login renders and `/me` round-trips.

---

## 2b. Provisioning — Azure target (ADR-015)

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
   implemented but **not yet verified against a live account** (docs/questions.md).
4. **API — Azure Container Apps.** Deploy the `apps/api` container; env from a
   Key Vault / secret store; ingress health probe `/health`; consumption plan
   (scale-to-zero).
5. **Web — Vercel or Azure Static Web Apps.** Set `NEXT_PUBLIC_API_BASE_URL` and
   the Entra client config.

---

## 3. Sprint 0 demo (acceptance)

Visit the prod URL → branded login → sign in as the seeded supervisor
(`jeramehl`) → authenticated hello showing the **supervisor** role.
*"It's deployed, it's real auth, it has a name."*
