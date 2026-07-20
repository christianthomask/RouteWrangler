# ADR-018 — Mobile-first for all surfaces, including supervisor/admin

Status: Accepted (Design). **Overrides DESIGN_BRIEF §1/§4** ("Supervisor
desktop-first").

## Context

The brief specced the supervisor console and admin as desktop-first. In
practice, the product owner confirmed supervisors and admins do ~9/10 of their
work — triaging exceptions, changing routes — **from the field on a phone**, not
at a desk. A desktop-first console that merely tolerates mobile would fail the
primary use.

## Decision

- **Mobile-first for every surface**, supervisor and admin included (the field
  reader app was already mobile-first).
- Layout adapts at breakpoints rather than assuming a wide viewport:
  - Console shell: a left rail on desktop becomes a **fixed bottom tab bar** on
    phones; the brand moves into the header.
  - Data lists (exception queue, runs, readers) are **card rows**, not wide
    tables — readable at 360px and comfortable on desktop.
  - The exception-detail two-pane layout **stacks** on narrow screens; the
    consumption chart is already fluid (SVG `viewBox`).
- Touch ergonomics: full-width primary actions, generous hit targets.

## Consequences

- The exception-detail "hero" works one-handed: chart → evidence → action bar
  in a single scroll on a phone.
- Tables are avoided as a layout primitive; new list screens use the shared
  `.rw-row` pattern.
- This supersedes the brief's surface-specific density guidance; dense desktop
  layouts are a progressive enhancement of the mobile baseline, not the default.
