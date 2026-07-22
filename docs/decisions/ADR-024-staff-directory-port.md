# ADR-024 — Staff administration via a directory port; identity stays with the IdP

Status: Accepted (post-deploy). **Extends ADR-015.**

## Context

Admin had no user management. `/admin` was a Sprint 0 placeholder and the API
exposed only `GET /me`, so the only way to onboard a supervisor or a reader was
for someone with Clerk dashboard access to add them to the organization and let
the `organizationMembership.*` webhook upsert the `users` row. An administrator
could not provision, re-role, or offboard anyone from inside the product.

The obvious fix — let admin insert a `users` row — is wrong. Clerk owns identity
in production; the `users` row is only the *authorization* record (the guard
reads `role` and `active` from it on every request, never from token claims). A
directly-inserted row has no corresponding identity, so nobody can ever
authenticate as it, and when the real person is later added in Clerk they arrive
under a different `cognito_sub` and get a *second* row.

## Decision

Add **Port 3 — the staff directory**, alongside ADR-015's storage and auth ports,
selected by config the same way.

- The port abstracts **only the identity-provider side** of staff administration.
  Writing the `users` row is deliberately outside the interface: `StaffService`
  owns it for both adapters, so both produce identical database state.
- **`local` adapter** — no external IdP exists, so "creating" a staff member is
  just minting the `local-only:<username>` subject the dev shim (ADR-012) will
  recognise. Active only when Clerk credentials are absent, and `StaffService`
  additionally refuses to create local accounts when the dev bypass is off.
- **`clerk` adapter** — creates an organization **invitation**. The `users` row
  still appears only when the person accepts and the existing webhook fires, so
  there remains exactly one writer of the authorization record. Role changes and
  membership revocation are pushed to Clerk *and* written locally; both are
  idempotent, so the webhook confirming the change afterwards is harmless and the
  UI does not have to wait on a round-trip.
- `staffProvider` resolves to `clerk` iff `CLERK_SECRET_KEY` and
  `CLERK_ORGANIZATION_ID` are both set — a secret key with no organization has
  nothing to invite anyone into.
- **Offboarding is deactivation, never deletion.** `users.id` is FK-referenced
  by runs, reads, exceptions, exports and audit rows without cascade, so a
  departed staff member with history cannot be hard-deleted.
- **Guardrails** are enforced server-side: you cannot change your own role or
  deactivate yourself, and the last active admin can be neither demoted nor
  deactivated. The last-admin rule is a predicate folded into the `UPDATE`'s
  `WHERE`, not a prior `SELECT`, so two admins demoting each other concurrently
  cannot both succeed and leave the organization unadministered.

The login page's "Continue as …" list also moves from a hardcoded constant to
`GET /dev/users`, which is served only while the bypass is active and 404s
otherwise. The constant had already drifted (it listed three of four seeded
users) and could never have included staff created through admin.

## Consequences

- Onboarding is a product feature rather than a Clerk dashboard errand, and the
  same admin UI works in local development and in production — only the adapter
  differs.
- **Reactivation is asymmetric.** Deactivating Clerk-managed staff deletes the
  org membership, and Clerk has no inverse, so restoring access means inviting
  the person again. The API returns an explicit 400 saying so rather than
  re-activating a local row for an identity no longer in the organization.
- Pending invitations are read live from Clerk rather than mirrored into our
  schema — no reconciliation, and no migration was needed for this feature.
- The `local` adapter mints accounts that the dev shim accepts with no
  credential. That is the same trust boundary ADR-012 already established, and it
  is unreachable in production for the same reason, but it does mean a local UAT
  environment must not be internet-reachable.
- Admin remains the only role-gated-to-`admin` surface in the API; client, route
  and meter management are still unbuilt.
