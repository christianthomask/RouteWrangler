# ADR-004 — Cognito auth from day 1

Status: Accepted (Sprint 0)

## Context

Auth is load-bearing and must be real from the first demo — "it's real auth"
is the Sprint 0 demo statement. Retrofitting real identity late is where
production-shaped projects quietly become fake (BUILD_SPEC §6).

## Decision

- **One Cognito user pool per environment** (dev / prod). Cognito **groups map
  1:1 to roles** (`reader`, `supervisor`, `admin`).
- **Custom login UI** (no hosted UI), using the Cognito SDK; the NestJS guard
  verifies JWTs against the pool **JWKS** and loads the local `users` row by
  `cognito_sub`. The **DB row's role is authoritative**, not the token's groups.
- **Seeding creates both halves:** `AdminCreateUser` provisions the pool user;
  the seed links a local `users` row to the returned `sub`.
- **Role enforcement is server-side on every endpoint.** Frontend route groups
  (`/field`, `/supervisor`, `/admin`) are convenience, not security.
- Cognito is the **one labeled cloud dependency in local dev** — no official
  local emulator exists. Documented in the README quick start.

## Consequences

- The skeleton boots before the pool exists: authenticated endpoints return a
  labeled **503 "auth not configured"** rather than faking a session. The seed
  runs in a labeled **local-only** mode (Postgres rows only) until AWS creds +
  pool id are present.
- Verifying tokens requires network egress to the pool JWKS; the guard caches
  the JWK set.
- Free-tier terms are verified during Sprint 0 pricing work (§11).
