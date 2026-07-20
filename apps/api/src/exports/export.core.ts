import type { ExportCounts, ExportFormat, ExportHold, HoldReason } from '@routewrangler/contracts';

/**
 * Pure export core (BUILD_SPEC §7.4) — classification and rendering with no I/O,
 * so the billability rules are exhaustively unit-testable. The service supplies
 * rows already joined from the DB; this decides what's billable and renders the
 * file.
 */

/** One cycle stop as seen by the export, flattened from the join. */
export interface StopRow {
  meterId: string;
  meterSerial: string;
  serviceAddress: string;
  /** null when the stop has no completed read (pending/skipped). */
  readValue: number | null;
  consumption: number | null;
  readAt: string | null; // ISO
  /** The exception on the effective read, if any. */
  exceptionCode: string | null;
  exceptionStatus: string | null;
  exceptionBlocksBilling: boolean;
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
    const blocked =
      r.exceptionCode != null &&
      r.exceptionBlocksBilling &&
      !(r.exceptionStatus != null && CLEARED.has(r.exceptionStatus));
    if (blocked) {
      holds.push(hold(r, 'blocking_exception', r.exceptionCode));
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
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${cycleId}.${format}`;
}
