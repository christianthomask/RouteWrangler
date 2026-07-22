/**
 * Operational "today".
 *
 * Run dates and cycle ids are calendar dates in the utility's own working day,
 * not instants. Deriving them from `new Date().toISOString()` uses UTC, which
 * for a US operator rolls over mid-afternoon: from 5pm Pacific onward every run
 * dated today falls outside "today" and is reported as overdue, and any run
 * created after that point is stamped with tomorrow's date. Every date-scoped
 * query must therefore go through here.
 *
 * The zone is a single operational setting (`APP_TIMEZONE`). Per-client zones
 * would be the fuller model — clients already carry a state — but every client
 * today is Pacific, and one wrong shared zone is a far smaller error than a
 * guaranteed daily inversion.
 */

/** `en-CA` is the locale whose short date format is exactly `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * True when the IANA zone is one this runtime actually knows. A typo in
 * `APP_TIMEZONE` must fail at boot with the other env validation rather than
 * throw on the first dashboard request.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}
