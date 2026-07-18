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
- [ ] **Validation thresholds.** Hi/lo baseline window, leak-spike multiple,
      zero-streak N, duplicate tolerance — default global config values need a
      first pass in Sprint 1; confirm defaults with CTK. — *owner: CTK*
