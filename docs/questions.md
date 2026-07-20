# Open questions

Anything that touches a BUILD_SPEC §2 non-negotiable goes to **CTK**, never
guessed (SPRINT_PLAN standing risk note 3). Log it here; don't build around it.

Format: `[status] question — context / who owns it`.

---

## Sprint 0

- [ ] **Pricing sign-off before provisioning.** The `docs/runbook.md` §1 table
      is estimates, not quotes. Confirm App Runner idle/pause, Aurora
      scale-to-zero availability + resume latency in our region, and Cognito
      free-tier MAU against live pricing. Target idle ≈ $5–15/mo; **flag to CTK
      if reality disagrees before creating paid resources.** — *owner: CTK*
- [x] **Product name chosen: Verameter** (ADR-017, provisional). Repo/package ids
      stay `routewrangler`. **Before public launch:** (a) USPTO/EUIPO clearance in
      software classes (Nice 9/42); (b) secure `verameter.com`. — *owner: CTK*
- [ ] **AWS region.** Runbook assumes `us-west-2` (Central Coast proximity).
      Confirm region for both dev and prod (affects Aurora scale-to-zero
      availability). — *owner: CTK*
- [ ] **Cognito username scheme.** Seed uses simple usernames (`jeramehl`,
      `reader1`). Confirm whether prod should key on email instead. — *owner:
      CTK*

## Parked for later sprints (raised early, not yet blocking)

- [ ] **Real route numbers.** Simulator scale is config (clients / routes /
      meters). Swap in Jeramehl's real numbers when they arrive — no code
      change (SPRINT_PLAN risk note 2). — *owner: Jeramehl → Dev*
- [ ] **Validation thresholds — confirm defaults.** Sprint 1 shipped working
      defaults in `DEFAULT_VALIDATION_CONFIG` (high ≥ 2× baseline, leak ≥ 5×,
      low ≤ 0.3×, zero-streak = 3 cycles, rollover band = 2×, rollover proximity
      = 0.9, duplicate tolerance = 2). These are engineering defaults, not
      domain-blessed — confirm with CTK/Jeramehl against real reading data.
      Per-client overrides remain deferred (Nice §12.4). — *owner: CTK*

## Cloud portability pivot (ADR-015)

- [ ] **Production cloud target undecided.** AWS card verification was blocked;
      the app is now provider-agnostic (ports & adapters) and runs fully local.
      Candidates: AWS, Azure, **Cloudflare** (user preference). Decide when a
      payment method verifies. **Card notes:** Azure sign-up needs a verifiable
      card; on Cloudflare, Pages/Workers-Free/Hyperdrive-Free need **no** card,
      but **R2 and Containers/Workers-Paid require a card** (Cloudflare accepts
      **PayPal**, which may sidestep the AWS issue). — *owner: CTK*
- [x] **Prod target chosen: Cloudflare.** Auth IdP: **Clerk** (via generic OIDC
      adapter). Storage: **R2** (existing S3 adapter, env only — see .env.example).
      Web: Next.js via **OpenNext on Workers**. DB: **Neon + Hyperdrive**.
- [ ] **Cloudflare API unreachable from the Claude Code session** — the egress
      proxy blocks *.cloudflare.com, so provisioning/deploy can't run here. Deploy
      via **GitHub Actions** (CI can reach Cloudflare; needs `CLOUDFLARE_API_TOKEN`
      + `CLOUDFLARE_ACCOUNT_ID` repo secrets) or from a local machine. — *owner:
      Dev + CTK*
- [ ] **API compute on Cloudflare:** confirm Cloudflare Containers (Workers-Paid,
      beta) vs hosting the NestJS API on Fly/Render with Cloudflare for edge/R2.
      Decide once we test cold-start/idle behavior. — *owner: Dev → CTK*
- [ ] **Azure Blob adapter unverified.** Implemented to the SAS contract but not
      yet run against a live Azure account. Verify (or delete) once an Azure
      account exists. The S3/MinIO path is verified end to end. — *owner: Dev*
- [ ] **IaC tool choice.** Deployment is now the main provider-specific artifact.
      Pick Terraform (one tool, multi-cloud) vs per-cloud (CDK for AWS / Bicep
      for Azure) when the prod target is chosen. — *owner: Dev → CTK*
- [ ] **DB scale-to-zero on non-AWS.** Aurora Serverless v2 scale-to-zero was the
      idle-cost lever. Azure PG Flexible Server can stop but not true
      scale-to-zero; Neon offers scale-to-zero if we want it provider-independent.
      Revisit with the target decision. — *owner: CTK*

## Sprint 1 (raised, non-blocking)

- [ ] **Cycle model.** `route_runs.cycle_id` is a `YYYY-MM` string in the seed;
      `clients.cycle_length_days`/`cycle_anchor_day` exist but aren't yet used to
      compute cycle boundaries. Formalize cycle derivation in Sprint 2 (exception
      streaks and exports depend on it). — *owner: Dev, confirm w/ CTK*
- [ ] **Simulator scale.** Seed builds 3 clients × 2 routes × 10 meters (60
      meters, 720 history reads) for fast demos — deliberately below the "few
      hundred meters" placeholder. Swap in Jeramehl's real route numbers via
      config, no code change. — *owner: Jeramehl → Dev*
