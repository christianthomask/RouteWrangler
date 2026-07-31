import type { ExceptionCode, ValidationConfig } from '../validation';

/** A prior read for the same meter, oldest-first (trailing baseline window). */
export interface PriorRead {
  value: number;
  consumption: number | null;
  /** ISO timestamp of *capture*, not receipt — see `loadHistory` in ingestion. */
  capturedAt: string;
}

/** Duplicate context supplied by ingestion when a completed stop is re-read. */
export interface DuplicateContext {
  completedValue: number;
}

/** Pure input to validation — no DB, no framework (unit-testable in isolation). */
export interface ValidationInput {
  value: number;
  lat: number | null;
  lng: number | null;
  registerDials: number;
  /**
   * ISO timestamp this read was captured at. Required, because it is what the
   * baseline window is measured back from — without it `config.baselineMonths`
   * could only be honoured by whoever assembled `history`, and one caller that
   * forgot would silently average years of readings into the band.
   */
  capturedAt: string;
  /**
   * The meter's prior reads, oldest-first. May extend beyond the baseline
   * window: `derive` trims it, so callers need not agree about the window.
   */
  history: PriorRead[];
  config: ValidationConfig;
  /** Present only when this read lands on an already-completed stop. */
  duplicate?: DuplicateContext | null;
}

/** Computed once, shared by every rule module. */
export interface Derived {
  input: ValidationInput;
  priorValue: number | null;
  /** Signed value − priorValue (null when no prior read). */
  rawDelta: number | null;
  isIncrease: boolean;
  isZero: boolean;
  isDecrease: boolean;
  /** Wrap-implied consumption on a decrease: (registerMax+1 − prior) + value. */
  rolloverConsumption: number | null;
  /** Mean of prior positive consumptions over the window (null if too few). */
  baseline: number | null;
  hasBaseline: boolean;
  /**
   * Recent consumptions oldest-first incl. the current effective value.
   * Positional: `null` marks a gap (a read with no computable consumption) and
   * is kept in place so streak rules see the break instead of a closed-up run.
   */
  recentConsumptions: (number | null)[];
}

/** A rule fires with an exception, an annotation-only (billable) outcome, or not. */
export type RuleOutcome =
  | { code: ExceptionCode; annotations?: Record<string, unknown> }
  | { code: null; annotations: Record<string, unknown> };

export interface RuleModule {
  code: ExceptionCode;
  /** 'consumption' rules are mutually exclusive (first match wins); 'independent'
   *  rules always run and can stack (e.g. location_absent). */
  category: 'consumption' | 'independent';
  /** Lower runs first within the consumption category. */
  priority: number;
  evaluate(d: Derived): RuleOutcome | null;
}

export interface ValidationResult {
  billable: boolean;
  /** Consumption to store on the read (rollover in-band → true usage). */
  effectiveConsumption: number | null;
  annotations: Record<string, unknown>;
  exceptions: ExceptionCode[];
}
