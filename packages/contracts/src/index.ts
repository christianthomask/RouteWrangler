/**
 * @routewrangler/contracts — the single source of request/response truth
 * (BUILD_SPEC §3, §9). Every API request/response type is a Zod schema here;
 * the API validates against these and the web app imports the inferred types.
 */
export * from './roles';
export * from './auth';
export * from './health';
export * from './validation';
export * from './ingestion';
export * from './taxonomy';
export * from './photos';
export * from './runs';
export * from './exceptions';
export * from './dashboard';
export * from './meter-history';
export * from './roster';
export * from './assignment';
export * from './field';
export * from './exports';
export * from './staff';

/**
 * The read-validation engine. Pure and dependency-free, so the field app can run
 * the same rules the server will apply — a reader learns a value looks anomalous
 * while standing at the meter, not from an exception raised hours later.
 */
export * from './engine/types';
export * from './engine/engine';
