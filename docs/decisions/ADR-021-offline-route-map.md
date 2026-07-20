# ADR-021 — Offline route map from stop coordinates (no tiles)

Status: Accepted.

## Context

Readers need to see the shape of their route, where they are in it, and how to
get to the next stop — while working exactly where connectivity is worst
(basements, vaults, rural routes; DESIGN_BRIEF §4, ADR-020). A conventional
street-tile map (Google/Mapbox/Leaflet+OSM) needs network to fetch tiles and an
API key, and degrades to blank squares offline unless tiles are pre-cached — the
one place it must not fail.

## Decision

- **Plot, don't tile.** `RouteMap` (a dependency-free SVG component) projects each
  stop from its own `lat`/`lng` — data already on `RunStopView` — using an
  equirectangular projection with longitude corrected by `cos(meanLat)` so the
  route isn't stretched east–west. It fits the stops to a bounding box and draws:
  the route polyline in sequence, status-colored markers (done / skipped /
  pending), and a highlighted current stop.
- **Two focuses, one component.** `focus="route"` fits the whole run (route page,
  with progress shown by marker color and a `You`-marker at the next actionable
  stop). `focus="current"` zooms to current + next (stop page), drawing a dashed
  brand leg from **You** to **Next**.
- **Real navigation is a handoff.** A "Directions" button deep-links to the
  phone's native Maps (`https://www.google.com/maps/dir/?api=1&destination=…`),
  which is where turn-by-turn belongs and works online without us shipping a map
  stack. Step-through (Prev/Next by sequence) is in-app and needs no network.
- **No keys, no vendor, no external requests.** Renders identically with zero
  signal and is CSP-safe for the installed PWA (ADR-020).

## Consequences

- The map shows route *topology and progress*, not streets. For "which house is
  it," the reader taps Directions and hands off. This is the right split for a
  field tool that must never blank out offline.
- Projection is accurate at route scale (a few km); it is not a survey-grade
  geodesic. Stops without coordinates are dropped from the plot, and a run with
  no located stops shows a friendly placeholder instead of an empty box.
- Because the map is pure SVG over data the run already returns, it costs no
  extra request on the route/stop screens and no bundle weight beyond the
  component itself.
