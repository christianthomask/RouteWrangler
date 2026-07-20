/**
 * The split invariant (ADR-005, BUILD_SPEC §7.3), as a pure function so it can be
 * unit-tested without a database. A split re-parents only a **contiguous range
 * of `pending` stops**; `read`/`skipped` stops never move.
 */
export interface StopLite {
  id: string;
  sequence: number;
  status: 'pending' | 'read' | 'skipped';
}

export type SplitCheck =
  | { ok: true; moving: StopLite[] }
  | { ok: false; error: string };

export function validateSplit(runStops: StopLite[], selectedIds: string[]): SplitCheck {
  if (selectedIds.length === 0) return { ok: false, error: 'select at least one stop' };

  const byId = new Map(runStops.map((s) => [s.id, s]));
  const selected: StopLite[] = [];
  for (const id of selectedIds) {
    const stop = byId.get(id);
    if (!stop) return { ok: false, error: 'a selected stop is not in this run' };
    selected.push(stop);
  }

  if (selected.some((s) => s.status !== 'pending')) {
    return { ok: false, error: 'only pending stops can be split — read/skipped stops never move' };
  }

  // Contiguity: every run stop whose sequence falls within the selected range
  // must itself be selected (no gaps carved out of the middle).
  const seqs = selected.map((s) => s.sequence);
  const lo = Math.min(...seqs);
  const hi = Math.max(...seqs);
  const selectedSet = new Set(selectedIds);
  const inRange = runStops.filter((s) => s.sequence >= lo && s.sequence <= hi);
  if (inRange.some((s) => !selectedSet.has(s.id))) {
    return { ok: false, error: 'selected stops must be a contiguous range' };
  }

  return { ok: true, moving: selected };
}
