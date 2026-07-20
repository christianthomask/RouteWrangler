# Component inventory (draft) — the contract

Per DESIGN_BRIEF §2: **the inventory is the contract.** Screens are designed only
with components dev has agreed to build; this list (with variants and states)
changes only by agreement. Everything references design tokens
(`apps/web/src/design/tokens.css`) — no raw hex in components. Vocabulary is
fixed: client, route, run, stop, read, reread, exception, skip (reason), export
cycle, certified read (DESIGN_BRIEF §2.4).

Status: **Sprint 0 draft** — primitives + the shared shell. Screen-specific
molecules (exception detail, split flow, side-by-side) are specified in the
Sprint 1 design pass.

Legend for states every interactive component must specify:
`default · hover · focus-visible · active · disabled · loading · error` — plus,
on the field surface, `offline` where relevant.

---

## 1. Primitives (built in Sprint 0)

| Component | Variants | States | Notes |
|---|---|---|---|
| **Button** | primary, ghost/secondary, danger | default, hover, focus, active, disabled, loading | primary = brand fill; danger reserved for destructive (never for "critical severity"). Loading shows spinner + keeps label width. |
| **Input / field** | text, password, number (tabular), select | default, focus, error, disabled, read-only | focus ring = brand; error border = danger + helper text. Number entry uses `tabular-nums`. |
| **Label + helper** | — | default, error | helper doubles as error slot. |
| **Card / panel** | flat, raised | — | raised = `--rw-shadow-2` (login, modals). |
| **Badge** | neutral, role | — | uppercase micro-label (e.g. role). |
| **Severity chip** | low, medium, high, critical | — | **color + dot + word, never color alone** (ADR-016). CVD-validated status palette. |
| **Sync pill** | pending, syncing, synced, failed | — | field surface; dot + word. Mirrors per-event store-and-forward state. |
| **Brand / mark** | full lockup, mark-only | — | droplet + meter-level line; favicon at 16px. |

## 2. Shell & navigation

| Component | Variants | States | Notes |
|---|---|---|---|
| **App header** | supervisor/admin (desktop), field (mobile) | — | brand left; identity + role + sign-out right. Field header keeps the **sync pill always visible** (DESIGN_BRIEF §4). |
| **Client switcher** | — | default, open, single-client | persistent for staff; filters all staff views (ADR-007). Not a permission wall. |
| **Side nav / tabs** | desktop rail, mobile bottom bar | default, active | role-scoped destinations. |
| **Empty state** | generic, first-run, filtered-empty | — | **every empty state teaches** (DESIGN_BRIEF §1) — says what belongs here and the next action. |
| **Loading / skeleton** | list, card, chart | — | never a bare spinner on data screens. |
| **Error state** | inline, full-panel, offline-banner | — | offline banner is informational, not an error, on the field surface. |

## 3. Data & triage molecules (specified in Sprint 1 design)

| Component | Where | Key states |
|---|---|---|
| **Data table** | roster, exception queue, meter history | empty, loading, filtered-empty, row-hover, sorted |
| **Filter bar** | exception queue (type/severity/route/client/status) | default, active-filters, cleared |
| **Stat tile / KPI** | dashboard (runs %, exceptions by severity, aging runs) | default, zero, loading |
| **Consumption chart** | exception detail, meter history | loading, empty (new meter), with-anomaly-marked |
| **GPS map pin** | exception detail (capture GPS vs registered location) | in-range, out-of-range, location-absent |
| **Photo viewer** | exception detail | present, absent, loading |
| **Action bar** | exception detail (order reread / accept / reject / escalate) | default, note-required, reread-cap-reached |
| **Side-by-side compare** | reread comparison | — |
| **Split flow** | supervisor split | preview, confirm; "safe, reversible-feeling" though audited-forever |
| **Stop capture** | field | default, GPS-denied (location-absent), photo-attached, skip-with-reason, offline-queued |

## 4. Offline states (field surface — first-class)

The field PWA must show sync truth at all times:

- **Header sync pill** — aggregate: `synced` / `N queued` / `N failed`.
- **Per-stop / per-event badge** — `pending · syncing · synced · failed`.
- **Run view** — queued count and reconnect behavior visible.
- **Capture** — a captured read shows `queued` immediately; GPS-denied records
  `location-absent` without blocking capture.
- **Reconnect** — events sync in capture order; failures retry individually and
  surface as `failed` until they land (exactly once).

---

## Change control

Adding or altering a component is a contract change — note it here with its
variants/states before a screen depends on it. Design decisions dev must honor
are logged as ADRs in `docs/decisions/`.
