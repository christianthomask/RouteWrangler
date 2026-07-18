# RouteWrangler — Runbook

Operational steps for provisioning and running RouteWrangler. IaC is deferred
(Nice queue §12) — provisioning is manual and documented here, step by step.

---

## 0. Local development

Prereqs: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up            # docker-compose Postgres
pnpm db:migrate       # apply checked-in Drizzle migrations
pnpm seed             # LOCAL-ONLY mode until a Cognito pool is configured
pnpm dev              # NestJS API on :3001
# in another shell:
pnpm --filter @routewrangler/web dev   # Next.js on :3000
```

**One labeled cloud dependency:** auth talks to a real **dev Cognito user
pool** — there is no official local Cognito emulator (ADR-004). Until the pool
is provisioned and `.env` is filled in:

- the API boots, but authenticated endpoints return a labeled **503**;
- `pnpm seed` runs in **local-only** mode (Postgres rows only, `local-only:`
  subs) so the rest of the stack is exercisable.

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

## 3. Sprint 0 demo (acceptance)

Visit the prod URL → branded login → sign in as the seeded supervisor
(`jeramehl`) → authenticated hello showing the **supervisor** role.
*"It's deployed, it's real auth, it has a name."*
