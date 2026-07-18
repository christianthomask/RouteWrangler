import { blocksBilling, type ExceptionCode } from '@routewrangler/contracts';
import type { ValidationInput, ValidationResult } from './types';
import { derive, effectiveConsumption } from './baseline';
import { CONSUMPTION_RULES, INDEPENDENT_RULES } from './rules';

/**
 * Runs validation for one read (BUILD_SPEC §7.1). Exactly one consumption
 * finding at most (first match in priority order — leak beats high beats low;
 * rollover-in-band annotates and stops negative_consumption), plus any number of
 * independent findings (location_absent, duplicate_mismatch). A read is billable
 * iff it has no open exception whose type blocks billing (ADR-009).
 */
export function runValidation(input: ValidationInput): ValidationResult {
  const d = derive(input);
  const exceptions: ExceptionCode[] = [];
  let annotations: Record<string, unknown> = {};

  // Consumption category: first non-null outcome wins.
  for (const rule of CONSUMPTION_RULES) {
    const outcome = rule.evaluate(d);
    if (!outcome) continue;
    if (outcome.annotations) annotations = { ...annotations, ...outcome.annotations };
    if (outcome.code) exceptions.push(outcome.code);
    break;
  }

  // Independent rules stack.
  for (const rule of INDEPENDENT_RULES) {
    const outcome = rule.evaluate(d);
    if (!outcome) continue;
    if (outcome.annotations) annotations = { ...annotations, ...outcome.annotations };
    if (outcome.code) exceptions.push(outcome.code);
  }

  const billable = !exceptions.some((code) => blocksBilling(code));

  return {
    billable,
    effectiveConsumption: effectiveConsumption(d),
    annotations,
    exceptions,
  };
}

export * from './types';
export { RULES } from './rules';
