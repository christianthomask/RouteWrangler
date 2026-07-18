import { z } from 'zod';

/**
 * Exception type codes (BUILD_SPEC §5 seed types). Taxonomy *labels/severities*
 * live in seeded lookup tables (ADR-003); these *codes* are the stable keys
 * that rule modules register against and that the simulator targets. Adding a
 * type = a new code here + a new row + a new rule module. No schema change.
 */
export const ExceptionCodeSchema = z.enum([
  'high_read',
  'low_read',
  'negative_consumption',
  'zero_consumption_streak',
  'leak_spike',
  'rollover_out_of_band',
  'location_absent',
  'duplicate_mismatch',
  'skipped_unresolved',
]);
export type ExceptionCode = z.infer<typeof ExceptionCodeSchema>;
export const EXCEPTION_CODES = ExceptionCodeSchema.options;

/** Severity codes (seeded severities lookup). */
export const SeverityCodeSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type SeverityCode = z.infer<typeof SeverityCodeSchema>;

/** Seeded skip reasons (BUILD_SPEC §7.2, W5). */
export const SkipReasonCodeSchema = z.enum([
  'no_access',
  'meter_obstructed',
  'unsafe_conditions',
  'meter_not_found',
  'reschedule',
]);
export type SkipReasonCode = z.infer<typeof SkipReasonCodeSchema>;

/**
 * Global validation thresholds (ADR-003 — thresholds in global config, no
 * rule-builder UI in v1). Shared so the API validates and the simulator can
 * deterministically breach each threshold. Per-client overrides are deferred
 * (Nice queue §12.4).
 */
export const ValidationConfigSchema = z.object({
  /** Trailing window for a meter's own consumption baseline. */
  baselineMonths: z.number().int().positive(),
  /** Minimum prior reads before hi/lo/leak/zero rules can judge a meter. */
  minBaselineReads: z.number().int().positive(),
  /** consumption ≥ baseline × this (and below leak) → high_read. */
  highReadMultiplier: z.number().positive(),
  /** 0 < consumption ≤ baseline × this → low_read. */
  lowReadMultiplier: z.number().positive(),
  /** consumption ≥ baseline × this → leak_spike (takes precedence over high). */
  leakSpikeMultiplier: z.number().positive(),
  /** Consecutive zero-consumption cycles → zero_consumption_streak. */
  zeroStreakCycles: z.number().int().positive(),
  /** A decrease is treated as a rollover only if the wrap-implied consumption
   *  is ≤ baseline × this; above it → rollover_out_of_band. */
  rolloverBandMultiplier: z.number().positive(),
  /** On a decrease, if the previous read sits in the top (1 − this) fraction of
   *  the register, the meter plausibly wrapped → classify borderline decreases
   *  as rollover_out_of_band rather than negative_consumption. */
  rolloverProximity: z.number().min(0).max(1),
  /** Second read on a completed stop differing by more than this → mismatch. */
  duplicateTolerance: z.number().nonnegative(),
});
export type ValidationConfig = z.infer<typeof ValidationConfigSchema>;

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  baselineMonths: 12,
  minBaselineReads: 3,
  highReadMultiplier: 2,
  lowReadMultiplier: 0.3,
  leakSpikeMultiplier: 5,
  zeroStreakCycles: 3,
  rolloverBandMultiplier: 2,
  rolloverProximity: 0.9,
  duplicateTolerance: 2,
};

/** register max = 10^dials − 1 (BUILD_SPEC §5 meters). */
export function registerMax(dials: number): number {
  return 10 ** dials - 1;
}

/**
 * Seed-and-code metadata for the taxonomy. Labels/severities live in the DB
 * lookup tables at runtime (ADR-003), but the seed is *built from* these maps so
 * there is one authoritative definition, and code that must reason about a type
 * (e.g. the billable decision) shares it. `blocksBilling` = an open exception of
 * this type keeps the read out of billing until dispositioned (ADR-009).
 */
export const SEVERITY_META: { code: SeverityCode; label: string; rank: number }[] = [
  { code: 'low', label: 'Low', rank: 1 },
  { code: 'medium', label: 'Medium', rank: 2 },
  { code: 'high', label: 'High', rank: 3 },
  { code: 'critical', label: 'Critical', rank: 4 },
];

export const EXCEPTION_META: Record<
  ExceptionCode,
  { label: string; defaultSeverity: SeverityCode; blocksBilling: boolean }
> = {
  high_read: { label: 'High read', defaultSeverity: 'high', blocksBilling: true },
  low_read: { label: 'Low read', defaultSeverity: 'medium', blocksBilling: true },
  negative_consumption: {
    label: 'Negative consumption',
    defaultSeverity: 'critical',
    blocksBilling: true,
  },
  zero_consumption_streak: {
    label: 'Zero-consumption streak',
    defaultSeverity: 'medium',
    blocksBilling: true,
  },
  leak_spike: { label: 'Leak spike', defaultSeverity: 'critical', blocksBilling: true },
  rollover_out_of_band: {
    label: 'Rollover out of band',
    defaultSeverity: 'high',
    blocksBilling: true,
  },
  location_absent: { label: 'Location absent', defaultSeverity: 'low', blocksBilling: false },
  duplicate_mismatch: { label: 'Duplicate mismatch', defaultSeverity: 'low', blocksBilling: false },
  skipped_unresolved: { label: 'Skipped, unresolved', defaultSeverity: 'medium', blocksBilling: true },
};

export const SKIP_REASON_META: { code: SkipReasonCode; label: string }[] = [
  { code: 'no_access', label: 'No access' },
  { code: 'meter_obstructed', label: 'Meter obstructed' },
  { code: 'unsafe_conditions', label: 'Unsafe conditions' },
  { code: 'meter_not_found', label: 'Meter not found' },
  { code: 'reschedule', label: 'Reschedule' },
];

/** Does an open exception of this code keep its read out of billing? */
export function blocksBilling(code: ExceptionCode): boolean {
  return EXCEPTION_META[code].blocksBilling;
}
