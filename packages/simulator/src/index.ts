/**
 * @routewrangler/simulator — the route simulator.
 *
 * NON-NEGOTIABLE (BUILD_SPEC §2.1): the simulator is provably just another API
 * client. It talks ONLY to the public ingestion API with reader credentials and
 * has zero privileged access — no imports from `@routewrangler/api`, no DB
 * handle. That boundary is enforced by this package's dependency list.
 *
 * Sprint 0 ships this skeleton. Sprint 1 implements:
 *   - seed mode:     3 clients, config-driven scale, 12-month seasonal history
 *   - playback mode: replay a route in accelerated time via POST /ingest/read-events
 *   - anomaly injection matrix (every validation rule tripped ≥ once)
 *   - the named demo seed (BUILD_SPEC §7.6, §10)
 */

/** Placeholder config surface — scale numbers are config, not code (§7.6). */
export interface SimulatorConfig {
  apiBaseUrl: string;
  clients: number;
  routesPerClient: number;
  metersPerRoute: number;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  apiBaseUrl: 'http://localhost:3001',
  clients: 3,
  routesPerClient: 3,
  metersPerRoute: 150,
};
