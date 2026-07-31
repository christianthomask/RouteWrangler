# ADR-026 — Park AWS and Azure: delete the provider code, keep the ports

Status: Accepted. **Amends ADR-004, ADR-015.**

## Context

ADR-015 made cloud choice a config decision by putting auth and object storage
behind ports. That claim was proved twice over — the S3 adapter serves AWS S3,
MinIO and R2 by endpoint alone — and it worked. But three of the adapters behind
those ports were never run against the thing they adapt:

- **Cognito** was half-removed when Clerk became the IdP (ADR-019). What remained
  was worse than either state: the seed still provisioned a user pool, the guard
  told users of a Clerk deployment to "provision the Cognito dev pool", the
  `cognito_sub` column stored Clerk ids, `.env.example` defaulted to
  `AUTH_PROVIDER=cognito` while `wrangler.jsonc` deployed `oidc`, and the seed
  took the Cognito path whenever *any* AWS credentials happened to be in the
  environment — then threw. Every one of those was recorded as a defect in
  `docs/STATUS.md` rather than fixed, and they were all the same defect.
- **Entra** existed as an issuer-derivation branch in `env.ts` and nothing else.
- **Azure Blob** was written to the documented SAS contract, had unit tests over
  its URL signing, and had never touched a live Azure account. `docs/STATUS.md`
  listed it under "shipped but UNVERIFIED", which was honest and also a standing
  admission that we did not know whether it worked.

The repo's quality bar is *production-shaped, not production-ready: everything
shown is real, everything stubbed is labeled*. Unexercised provider code sits
awkwardly against that. It is not stubbed — it looks finished — so the label is
the only thing distinguishing it from the paths we actually run, and a label is a
weak guard for something a reader will reasonably assume works.

## Decision

**Delete the AWS and Azure provider code. Keep the ports.**

- `AUTH_PROVIDER` becomes `neon | oidc`. Cognito and Entra derivation are gone.
  The generic `oidc` branch remains and is what makes the portability claim
  testable: any standards-compliant IdP is still four environment variables.
- `STORAGE_PROVIDER` becomes `s3` alone, and the Azure Blob adapter is removed.
  One adapter covers MinIO locally, R2 in production, and S3 anywhere else —
  which is not a reduction in reach, because those three are the same protocol.
- The `StoragePort`, `TokenVerifier` and `StaffDirectoryPort` interfaces are
  untouched. The seam is the decision from ADR-015; the unexercised
  implementations behind it were not.
- The `users.cognito_sub` column is renamed to `auth_sub` (migration 0010),
  because it had been storing a non-Cognito subject id for some time.
- `AWS_REGION` becomes `S3_REGION`. It was only ever the SigV4 signing region —
  MinIO ignores it, R2 wants the literal `auto` — and its old name implied a
  vendor relationship that no longer exists.

## Consequences

- Standing up on AWS or Azure now means writing an adapter, not setting an
  environment variable. That is a real cost and it is the point of writing this
  down: we are trading a *claimed* capability we could not demonstrate for a
  smaller surface we can.
- The three "shipped but UNVERIFIED" auth/storage entries in `docs/STATUS.md`
  collapse to none. Nothing in the auth or storage path is now labeled as
  unproven, which makes the remaining labels mean something.
- `@aws-sdk/client-cognito-identity-provider` and `@azure/storage-blob` leave the
  dependency tree. `@aws-sdk/client-s3` stays — it is the S3 protocol client that
  talks to MinIO and R2, not an AWS commitment.
- The seed loses its "full mode". It writes `local-only:` subjects and nothing
  else, and says so out loud when the dev bypass is off (see ADR-027 — under a
  self-service IdP there is no identity for a script to create on someone's
  behalf).
- Recovering any of this is `git revert`-shaped, not a rewrite. The adapters were
  small; the ports were the expensive part and they are still here.
