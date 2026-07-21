import type { ExportCounts, ExportFormat, ExportHold, HoldReason } from '@routewrangler/contracts';

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
   * Every exception on the effective read (a single read routinely has ≥2 —
   * one consumption finding plus independent findings). Billability is decided
   * over the whole set here, never by fanning the stop into one row per
   * exception (C1) — that double-counted and mis-billed held meters.
   */
  exceptions: StopException[];
}

export interface BillableLine {
  meterSerial: string;
  serviceAddress: string;
  readAt: string;
  readValue: number;
  consumption: number | null;
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
      holds.push(hold(r, 'not_read', null));
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
    billable.push({
      meterSerial: r.meterSerial,
      serviceAddress: r.serviceAddress,
      readAt: r.readAt,
      readValue: r.readValue,
      consumption: r.consumption,
    });
  }

  const missing = holds.filter((h) => h.reason === 'not_read').length;
  return {
    billable,
    holds,
    counts: { billable: billable.length, held: holds.length - missing, missing },
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
  };
}

const CSV_HEADER = ['meter_serial', 'service_address', 'read_date', 'read_value', 'consumption'];

/** RFC-4180-ish CSV escaping: quote when the field has a comma, quote, or newline. */
function csvCell(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function render(format: ExportFormat, lines: BillableLine[]): string {
  // csv is the only format today; the enum keeps the seam explicit for others.
  void format;
  const rows = lines.map((l) => [
    l.meterSerial,
    l.serviceAddress,
    l.readAt.slice(0, 10),
    l.readValue,
    l.consumption ?? '',
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
