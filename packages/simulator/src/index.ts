/**
 * @routewrangler/simulator — the route simulator.
 *
 * NON-NEGOTIABLE (BUILD_SPEC §2.1): the simulator is provably just another API
 * client. This package depends only on `@routewrangler/contracts` — never on
 * `@routewrangler/api`, no DB handle. Its two responsibilities:
 *
 *   - generation logic (pure, deterministic): seasonal curves + anomaly matrix,
 *     reused by the API seed to backfill 12 months of baseline history.
 *   - playback: replay a route through the PUBLIC ingestion API (HTTP only).
 */
export * from './generate';
export * from './anomalies';
export * from './playback';

/** Config surface — scale numbers are config, not code (§7.6). */
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
