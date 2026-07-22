import type { ExportCounts, ExportFormat, ExportHold, HoldReason } from '@routewrangler/contracts';
import { dateIn } from '../config/clock';

/**
 * Pure export core (BUILD_SPEC §7.4) — classification and rendering with no I/O,
 * so the billability rules are exhaustively unit-testable. The service supplies
 * rows already joined from the DB; this decides what's billable and renders the
 * file.
 */

/** One exception on a read, as the export sees it. */
export interface StopException {
  code: string;
  status: string;
  blocksBilling: boolean;
}

/** One cycle stop as seen by the export, one row per stop (never per exception). */
export interface StopRow {
  meterId: string;
  meterSerial: string;
  serviceAddress: string;
  /** null when the stop has no completed read (pending/skipped). */
  readValue: number | null;
  consumption: number | null;
  readAt: string | null; // ISO
  /**
   * The reader's skip reason, when they deliberately skipped this stop. Null
   * for a stop that was simply never worked — the two are reported separately
   * so the client can tell "we tried, here's why" from "nobody got to it".
   */
  skipReasonCode: string | null;
  /**
   * Every exception on the effective read (a single read routinely has ≥2 —
   * one consumption finding plus independent findings). Billability is decided
   * over the whole set here, never by fanning the stop into one row per
   * exception (C1) — that double-counted and mis-billed held meters.
   */
  exceptions: StopException[];
  /**
   * Whether the reader photographed the meter. A read outside the meter's normal
   * range must be photographed in the field; the photo is the evidence for that
   * read being charged differently, so billing needs to see both facts.
   */
  hasPhoto: boolean;
}

export interface BillableLine {
  meterSerial: string;
  serviceAddress: string;
  readAt: string;
  readValue: number;
  consumption: number | null;
  /**
   * The read deviated from the meter's normal range and was reviewed — an
   * exception was raised and then resolved or overridden, so it bills, but not
   * as an ordinary read.
   */
  abnormal: boolean;
  /** Whether the deviating read carries the photograph that evidences it. */
  photoDocumented: boolean;
}

export interface Classification {
  billable: BillableLine[];
  holds: ExportHold[];
  counts: ExportCounts;
}

/** An exception no longer blocks billing once it's been resolved or overridden. */
const CLEARED = new Set(['resolved', 'overridden']);

export function classify(rows: StopRow[]): Classification {
  const billable: BillableLine[] = [];
  const holds: ExportHold[] = [];

  for (const r of rows) {
    if (r.readValue == null || r.readAt == null) {
      // A deliberate skip carries its reason through to the client; an unworked
      // stop stays `not_read`. Same billing outcome, different follow-up.
      holds.push(
        r.skipReasonCode ? hold(r, 'skipped', null) : hold(r, 'not_read', null),
      );
      continue;
    }
    // A read is held iff ANY of its exceptions still blocks billing (not yet
    // resolved/overridden). Fold across all of them — one blocking exception is
    // enough, and non-blocking siblings never make a held read billable.
    const blocking = r.exceptions.find((e) => e.blocksBilling && !CLEARED.has(e.status));
    if (blocking) {
      holds.push(hold(r, 'blocking_exception', blocking.code));
      continue;
    }
    // Reaching here with any exception at all means it was raised and then
    // cleared by a supervisor, or never blocked billing — either way the read
    // deviated and is not an ordinary one.
    const abnormal = r.exceptions.length > 0;
    billable.push({
      meterSerial: r.meterSerial,
      serviceAddress: r.serviceAddress,
      readAt: r.readAt,
      readValue: r.readValue,
      consumption: r.consumption,
      abnormal,
      photoDocumented: abnormal && r.hasPhoto,
    });
  }

  const missing = holds.filter((h) => h.reason === 'not_read').length;
  const skipped = holds.filter((h) => h.reason === 'skipped').length;
  return {
    billable,
    holds,
    // `held` is exception-blocked only — the other two reasons are counted
    // separately, so the three always partition `holds`.
    counts: { billable: billable.length, held: holds.length - missing - skipped, missing, skipped },
  };
}

function hold(r: StopRow, reason: HoldReason, exceptionCode: string | null): ExportHold {
  return {
    meterId: r.meterId,
    meterSerial: r.meterSerial,
    serviceAddress: r.serviceAddress,
    reason,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exceptionCode: exceptionCode as any,
    skipReasonCode: reason === 'skipped' ? r.skipReasonCode : null,
  };
}

const CSV_HEADER = [
  'meter_serial',
  'service_address',
  'read_date',
  'read_value',
  'consumption',
  // Billing charges a deviating read differently, and the photo is its evidence.
  // An abnormal read with no photo is worth the client's attention.
  'abnormal_read',
  'photo_documented',
];

/** RFC-4180-ish CSV escaping: quote when the field has a comma, quote, or newline. */
function csvCell(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * `timeZone` is the client's, and it is not optional: `readAt` is an instant, and
 * slicing its UTC ISO string dated a 17:51 Pacific read as the following day —
 * shipping tomorrow's date to billing for every read taken after 5pm.
 */
export function render(format: ExportFormat, lines: BillableLine[], timeZone: string): string {
  // csv is the only format today; the enum keeps the seam explicit for others.
  void format;
  const rows = lines.map((l) => [
    l.meterSerial,
    l.serviceAddress,
    dateIn(timeZone, new Date(l.readAt)),
    l.readValue,
    l.consumption ?? '',
    l.abnormal ? 'yes' : 'no',
    l.abnormal ? (l.photoDocumented ? 'yes' : 'no') : '',
  ]);
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportFilename(clientName: string, cycleId: string, format: ExportFormat): string {
  const slug = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}-${cycleId}.${format}`;
}
