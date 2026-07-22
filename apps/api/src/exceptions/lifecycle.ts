import type { ExceptionStatus } from '@routewrangler/contracts';

/**
 * Pure exception state-machine rules (BUILD_SPEC §7.3, W4) — extracted so they
 * can be unit-tested without a database. Two-reread cap; terminal states admit
 * no further action.
 */
export const MAX_REREADS = 2;

export const TERMINAL_STATUSES: ExceptionStatus[] = ['resolved', 'overridden', 'escalated'];

export type ActionKind = 'reread' | 'override' | 'resolve' | 'escalate';

export function isTerminal(status: ExceptionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Share of a reader's reads that raised at least one exception, as a 0–1 ratio.
 *
 * Takes *flagged reads*, not exception rows: one reading can raise several
 * exceptions, so dividing rows by reads is unbounded above 1 and rendered as
 * "138%". Rounded to four places rather than two because the web layer
 * multiplies by 100 — rounding the fraction to 2dp quantised the display to
 * whole percentage points and collapsed anything under 0.5% to "0%".
 */
export function rateOf(flaggedReads: number, reads: number): number {
  if (!reads) return 0;
  return Math.round((flaggedReads / reads) * 10_000) / 10_000;
}

/** Actions available from a given state (drives the console action bar). */
export function allowedActions(status: ExceptionStatus, rereadCount: number): ActionKind[] {
  if (isTerminal(status)) return [];
  const actions: ActionKind[] = [];
  if (rereadCount < MAX_REREADS) actions.push('reread');
  actions.push('override', 'resolve', 'escalate');
  return actions;
}
