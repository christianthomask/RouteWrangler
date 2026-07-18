# ADR-015 — Cloud portability via ports & adapters; provider by config

Status: Accepted (post-Sprint 1). **Amends ADR-001 and ADR-004.**

## Context

The system must be able to develop and demo with **no cloud vendor** (AWS card
verification was blocked), then choose AWS *or* Azure for production **without a
rewrite** — keeping the "production-shaped" enterprise shape. A naive
"vendor-agnostic" layer risks a lowest-common-denominator design that discards
each provider's strengths. We want portability only where it actually costs us
to be locked in.

## Decision

Adopt **hexagonal (ports & adapters)** for the genuinely vendor-specific seams,
and keep everything else neutral.

- **Already neutral, no abstraction:** the API is a **container** (runs on App
  Runner, Azure Container Apps, Cloud Run, Fly, or locally); the database is
  **Postgres via Drizzle + `DATABASE_URL`** (Aurora, Azure DB for PostgreSQL,
  Neon, or docker — identical to the code).
- **Port 1 — object storage** (`StoragePort`): adapters for **S3** (AWS S3 and
  any S3-compatible endpoint incl. **MinIO** and R2, via endpoint override) and
  **Azure Blob** (SAS). Selected by `STORAGE_PROVIDER`. Unconfigured →
  NullStorage (labeled 503).
- **Port 2 — auth** (`TokenVerifier`): a single **OIDC** verifier configured per
  provider — Cognito, Entra, or generic — differing only in
  issuer/jwks/audience/groups-claim (resolved in `env.ts`). Selected by
  `AUTH_PROVIDER`.
- **Provider is a config decision, not code.** The same build runs against AWS,
  Azure, or a local stack.
- **Local-first:** the default `.env` runs the whole system with **zero cloud
  signup** — docker Postgres + MinIO (S3-compatible) + the dev-auth shim
  (ADR-012). This decouples engineering from any payment/vendor blocker.

## Amendments

- **ADR-001 (stack):** compute stays a container and the DB stays Postgres —
  unchanged and already portable. App Runner / Aurora become *one* deployment
  target, not a hard dependency.
- **ADR-004 (Cognito day 1):** generalized to **OIDC day 1** — Cognito is the
  default adapter; Entra (Azure) is a config change. The JWKS-verify-then-load-
  local-user pattern was already standards-based, so no security change.

## Consequences

- Switching prod target = new config + (for Azure) a verified Blob adapter +
  IaC for that provider. No application code changes.
- The Azure Blob adapter is implemented to the SAS contract but **not yet
  verified against a live account** (none provisioned — see docs/questions.md);
  the S3/MinIO path is verified end to end.
- We keep provider strengths where they don't cost portability (e.g. Aurora
  scale-to-zero remains available on the AWS target; it's just not assumed).
- Promotes "IaC" from the Nice queue toward the top, since deployment is now the
  main provider-specific artifact; IaC tool choice (Terraform vs per-cloud) is
  an open question.
