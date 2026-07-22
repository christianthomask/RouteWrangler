# Decision log (ADR-lite)

One file per decision: **Context / Decision / Consequences**. These are CTK's
review and defense material — written to be questioned (BUILD_SPEC §4). Every
sprint that makes a non-obvious choice adds one.

## Accepted

| ADR | Decision |
| --- | --- |
| [001](./ADR-001-stack-and-architecture.md) | Stack and architecture (TS monorepo; Next/Nest/Aurora/Drizzle/S3/Cognito; CommonJS backend) |
| [002](./ADR-002-immutable-read-events.md) | Read events are immutable |
| [003](./ADR-003-taxonomy-as-data-rules-as-code.md) | Taxonomy as data, rules as code |
| [004](./ADR-004-cognito-from-day-1.md) | Cognito auth from day 1 |
| [005](./ADR-005-split-invariant.md) | The split invariant |
| [006](./ADR-006-no-consumption-estimation.md) | No consumption estimation |
| [007](./ADR-007-staff-see-all-clients.md) | Staff see all clients; client switcher is a view filter |
| [008](./ADR-008-idempotent-ingestion.md) | Idempotent ingestion on a client-generated event id |
| [009](./ADR-009-billable-rule.md) | What makes a read billable (blocksBilling) |
| [010](./ADR-010-baseline-computation.md) | Consumption baseline computation |
| [011](./ADR-011-decrease-classification.md) | Classifying a decreasing read: rollover vs negative |
| [012](./ADR-012-local-dev-auth-bypass.md) | Local-only dev auth bypass |
| [013](./ADR-013-photo-key-derived.md) | Photo key is derived, not mutated onto the read |
| [014](./ADR-014-simulator-boundary.md) | Simulator boundary: shared generation, public-only pipeline |
| [015](./ADR-015-cloud-portability-ports-and-adapters.md) | Cloud portability via ports & adapters; provider by config (amends 001, 004) |
| [016](./ADR-016-design-tokens-and-status-colors.md) | Design tokens & colorblind-safe status colors (design) |
| [017](./ADR-017-product-name.md) | Product name: Verameter (provisional, design) |
| [018](./ADR-018-mobile-first-console.md) | Mobile-first for all surfaces incl. supervisor/admin (design; overrides brief) |
| [019](./ADR-019-cloudflare-deploy.md) | Cloudflare deployment via GitHub Actions (web=Workers/OpenNext, api=Containers) |
| [020](./ADR-020-field-pwa-store-and-forward.md) | Field PWA: offline store-and-forward with exactly-once capture |
| [021](./ADR-021-offline-route-map.md) | Offline route map from stop coordinates (no tiles) |
| [022](./ADR-022-self-hosted-basemap.md) | Real basemap via self-hosted PMTiles + MapLibre, offline per route |
| [023](./ADR-023-billing-export.md) | Billing export: snapshot per client + cycle |
| [024](./ADR-024-staff-directory-port.md) | Staff administration via a directory port; identity stays with the IdP (extends 015) |
| [025](./ADR-025-skips-carry-evidence.md) | A skip carries evidence, and an exception may hang off a stop (extends 003) |
