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
 * Each client carries its own IANA zone (`clients.timezone`); `APP_TIMEZONE` is
 * the default for new rows and the fallback where no client is in scope. A
 * server-wide zone is not sufficient: "today" belongs to the utility whose work
 * it is, so an operator spanning zones would otherwise mis-date half its runs.
 */

/**
 * The calendar date an instant falls on, in the given zone. `en-CA` is the
 * locale whose short date format is exactly `YYYY-MM-DD`.
 *
 * Use this for *any* instant rendered or compared as a date — not just "now".
 * A read captured at 17:51 Pacific is `.toISOString().slice(0, 10)` = tomorrow,
 * and shipping that to a billing file dates the work a day late.
 */
export function dateIn(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return dateIn(timeZone, now);
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
