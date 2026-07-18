# ADR-007 — Staff see all clients; the client switcher is a view filter

Status: Accepted (Sprint 0)

## Context

The company reads meters for many separately-contracted city clients. Data is
client-scoped (routes/meters/reads/exports never mix clients — BUILD_SPEC §2.4).
The question is whether staff (supervisor/admin) are *partitioned* by client or
see everything (BUILD_SPEC §5, users note).

## Decision

- **Supervisors and admins see all clients.** The **client switcher is a view
  filter, not a permission wall.**
- A **reader** is a `User` with the `reader` role; readers are scoped to their
  assigned runs.
- Client scoping remains a **query concern** (every list query filters by the
  selected/active client), never a role/guard concern. Role guards answer "can
  this role take this action", not "which client's data".

## Consequences

- The `RolesGuard` never encodes client identity; client filtering lives in the
  data-access layer.
- Cross-client dashboards for staff are cheap to build; a future hard tenancy
  boundary (if a client contract ever demands it) would be a new ADR and a real
  permission layer.
