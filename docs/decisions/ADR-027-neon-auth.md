# ADR-027 — Neon Auth is the identity provider; invitations are rows, not webhooks

Status: Accepted. **Supersedes the Clerk choice in ADR-019. Amends ADR-004,
ADR-024.**

## Context

Clerk was chosen as the IdP in ADR-019 and never got an ADR of its own — the
decision lived inside a deployment ADR and the runbook, which `docs/STATUS.md`
flagged as debt. It worked, but it added a second vendor alongside Neon (already
chosen for Postgres) and it brought a webhook with it.

That webhook was the expensive part. Clerk owned identity, so a `users` row could
only be written when `organizationMembership.created` arrived at
`POST /webhooks/clerk`. That meant: a Svix signature to verify, `rawBody: true`
on the Nest bootstrap so the exact bytes survived, a role map to keep in step in
two directions, a publicly reachable endpoint on an otherwise closed API, and an
onboarding path that failed *silently and remotely* — an admin invites someone,
the person accepts, delivery fails, and nobody finds out until they try to sign
in and get "no local user for this identity". Reconciling that state had no
mechanism at all; you re-sent the webhook from a dashboard.

Neon Auth (Managed Better Auth) stores users, sessions and OAuth config in the
same Neon Postgres the app already uses, gives every database branch its own
isolated auth environment, and exposes a standards-shaped JWKS endpoint. Adopting
it removes a vendor and — more importantly — removes the reason the webhook
existed.

## Decision

**Neon Auth is the identity provider, reached through the existing generic OIDC
verifier. Staff are invited as `users` rows, and identities attach themselves on
first sign-in.**

### Verification is one setting

Neon issues each branch an Auth URL — `https://<endpoint>.neon.tech/<db>/auth`.
`AUTH_PROVIDER=neon` derives everything from it:

- JWKS: `<base>/.well-known/jwks.json`
- `iss` and `aud`: the **origin** of that URL, *not* the full path

The origin/path distinction is the entire reason this is a named provider rather
than three generic `OIDC_*` variables. An operator hand-deriving the issuer would
reasonably copy the base URL, and every valid token would then fail verification
with nothing in the error to suggest why. One variable cannot be internally
inconsistent. The web app takes the same URL as `NEXT_PUBLIC_NEON_AUTH_URL`, so
the two sides cannot be configured to disagree either.

No algorithm allow-list is pinned: Neon Auth signs **EdDSA (Ed25519)** where most
OIDC providers sign RS256, and the JWKS is what constrains which keys — and so
which algorithms — can verify at all.

### Google is the only sign-in method

Everyone who signs in was invited by an admin who already knows their work
address. A password to forget, reset and phish would add support burden and
attack surface for no gain, and Google-verified email is precisely what makes the
invitation match below safe.

### Invitations are pending rows; the guard links them

`users.auth_sub` becomes nullable and `users.email` is added (migration 0010). A
row is in one of two states:

- **invited** — `auth_sub` null, `email` set. Someone has a role but no identity.
- **linked** — `auth_sub` holds the IdP subject. Written exactly once, by the
  auth guard, on that person's first verified sign-in.

Admin → Staff writes the invited row. When a verified token arrives bearing a
subject we have never seen, the guard claims the matching pending row:

```sql
UPDATE users SET auth_sub = $sub
 WHERE auth_sub IS NULL AND lower(email) = $verified_email
```

One conditional `UPDATE`, not select-then-update: two concurrent first requests
from the same new user would both observe the row unclaimed, and the loser must
match zero rows rather than overwrite the winner. The unique index on `auth_sub`
is the backstop.

The email must be **verified by the IdP** — both `email_verified` (OIDC) and
`emailVerified` (Better Auth) are accepted, and a token carrying an address with
no verification claim is treated as unverified. Without that check, anyone able
to sign up under a chosen address could claim a colleague's invited role.

Failure to match is reported identically to "no such user", so someone who can
reach the IdP cannot probe which colleagues have accounts here.

### The staff directory port survives, with nothing behind it

ADR-024's `StaffDirectoryPort` stays, and its `oidc` adapter makes no outbound
calls at all. That is the decision, not an omission: under Neon Auth there is no
organization to invite anyone into and no provider-side role to mirror. Roles are
DB-authoritative already (BUILD_SPEC §6), and deactivation takes effect on the
staff member's *next request* because the guard reads `active` every time —
revoking the IdP session too would end it a few seconds sooner and cost a vendor
dependency to do it. The port remains because the seam is real: an IdP with a
management API drops in here without touching `StaffService`.

Pending invitations are therefore not mirrored state — they are the same rows,
filtered by `auth_sub IS NULL`. Admin can withdraw one, restricted by predicate
to unclaimed rows, so it can never become a delete path for a staff member whose
runs and audit entries reference them.

## Consequences

- **The webhook, the Svix dependency, `rawBody`, the role map and the public
  webhook endpoint are all deleted.** Onboarding cannot fail in delivery because
  nothing is delivered; the invitation is a row that is either there or not.
- One vendor instead of two, and auth data lives in the database we already back
  up and branch. A preview branch gets its own isolated auth environment for
  free, which is what makes UAT against non-production identities cheap.
- **An admin can now write a row for an address nobody controls.** Previously
  Clerk gated who could exist. The guard's verified-email requirement is what
  keeps that safe, and it is load-bearing — weakening it re-opens role theft by
  address squatting.
- **Case matters and is handled once.** Addresses are stored lowercased, matched
  with `lower(email)`, and a unique index on `lower(email)` prevents two
  invitations for the same person in different cases.
- `@neondatabase/auth` is **0.4.2-beta**. That is a real risk and is recorded as
  such in `docs/STATUS.md`: the API side is standards-only (`jose` against a JWKS)
  and would survive the SDK being replaced, but the web sign-in and token refresh
  are SDK-coupled. It also declares a peer dependency on Next ≥ 16 while this app
  is on 15; nothing we import touches Next, and the build is clean, but that is a
  warning we are choosing to carry rather than a compatibility we have proven.
- The seed can no longer create sign-in-capable staff for a deployed environment,
  because a script cannot complete somebody's Google sign-in. It writes
  `local-only:` subjects and says so.
