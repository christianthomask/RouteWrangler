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
- [ ] **Final product name + mark.** Repo/codebase currently uses
      "RouteWrangler" (working). Confirm the name and mark coming out of the
      Design Sprint 0 so branding is locked before the prod demo. — *owner:
      Design → CTK*
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

## Sprint 1 (raised, non-blocking)

- [ ] **Cycle model.** `route_runs.cycle_id` is a `YYYY-MM` string in the seed;
      `clients.cycle_length_days`/`cycle_anchor_day` exist but aren't yet used to
      compute cycle boundaries. Formalize cycle derivation in Sprint 2 (exception
      streaks and exports depend on it). — *owner: Dev, confirm w/ CTK*
- [ ] **Simulator scale.** Seed builds 3 clients × 2 routes × 10 meters (60
      meters, 720 history reads) for fast demos — deliberately below the "few
      hundred meters" placeholder. Swap in Jeramehl's real route numbers via
      config, no code change. — *owner: Jeramehl → Dev*
