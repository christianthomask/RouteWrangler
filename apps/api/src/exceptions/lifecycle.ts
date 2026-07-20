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

/** Actions available from a given state (drives the console action bar). */
export function allowedActions(status: ExceptionStatus, rereadCount: number): ActionKind[] {
  if (isTerminal(status)) return [];
  const actions: ActionKind[] = [];
  if (rereadCount < MAX_REREADS) actions.push('reread');
  actions.push('override', 'resolve', 'escalate');
  return actions;
}
