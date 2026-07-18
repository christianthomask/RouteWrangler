# ADR-012 — Local-only dev auth bypass

Status: Accepted (Sprint 1)

## Context

Auth is Cognito from day 1 (ADR-004), and there is no local Cognito emulator.
The Sprint 1 demo — "run the simulator against the API, watch validated reads
and typed exceptions appear" — must be runnable **locally**, but the global JWT
guard returns 503 until a pool is provisioned. We need local end-to-end runs
without weakening production auth.

## Decision

- A labeled shim, **off by default**: when `AUTH_DEV_BYPASS=true` **and**
  `NODE_ENV !== 'production'`, the guard trusts an `x-dev-user-sub` header and
  loads the local `users` row by that sub.
- The bypass is **hard-disabled in production** — the resolved `authDevBypass`
  flag is false whenever `NODE_ENV === 'production'`, regardless of the env var.
- When a Cognito pool **is** configured, the real JWKS path always wins; the
  bypass only applies in the unconfigured local state.
- Role enforcement is unchanged: the loaded user's DB role still gates every
  endpoint (ADR-004).

## Consequences

- The simulator authenticates locally as a seeded reader via a header; in prod
  it must present a real Cognito token. Same public endpoint either way — the
  "just another API client" property (ADR-014) holds.
- This is a clearly-scoped dev affordance, not a production code path; it can
  never silently authorize a prod request.
