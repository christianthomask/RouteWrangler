import { z } from 'zod';

/**
 * A billing cycle id: `YYYY-MM`.
 *
 * Cycle derivation is one function returning a calendar month (see
 * `docs/STATUS.md` — whether real clients bill on calendar months or on anchored
 * cycles is still CTK's call, and `clients.cycle_length_days` /
 * `cycle_anchor_day` exist in the schema against that day). Until that is
 * settled, the *shape* is at least enforced in one place.
 *
 * It matters because a cycle id is not merely a label: it keys the partial
 * unique index behind billing exports (ADR-023) and decides which run counts as
 * already-assigned this cycle. An unvalidated free-form string let a typo like
 * `2026-7` or `July` open a second parallel cycle that no other query would ever
 * find, and no error would be raised at any point.
 */
export const CycleIdSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a calendar month, YYYY-MM');

/**
 * The cycle a calendar date belongs to.
 *
 * Takes the date as a `YYYY-MM-DD` string rather than a `Date` on purpose. The
 * previous version accepted a `Date` and read `getUTCFullYear`/`getUTCMonth`
 * off it, so calling it with no argument answered in UTC while every other date
 * in the system goes through the client's timezone — from 5pm Pacific on the
 * last day of a month, the two disagreed and work was filed against the wrong
 * cycle. A string that has already been resolved in the right zone cannot have
 * that bug, and callers are forced to say which zone they meant by producing it.
 */
export function cycleIdForDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}
