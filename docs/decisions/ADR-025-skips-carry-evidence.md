# ADR-025 — A skip carries evidence, and an exception may hang off a stop

Status: Accepted (post-UAT). **Extends ADR-003; constrained by ADR-002.**

## Context

A skip removes a meter from the billing cycle on the reader's word alone. Until
now it recorded a taxonomy reason and nothing else, and it raised no exception —
so nobody reviewed it. The `skipped_unresolved` exception type existed in the
taxonomy and had never once fired, which UAT surfaced as an empty filter.

The client's actual field workflow is stricter than what was built: an ordinary
read needs no photograph, but a *deviating* read must be photographed, and the
same standard should apply to a skip. A photo of the locked gate is the evidence
that the meter genuinely could not be read.

Making a skip reviewable ran into a schema fact: `exceptions.read_event_id` was
`NOT NULL`. Every exception hung off a reading, and a skip has none.

## Decision

**Skips require a reason and a photograph of that reason**, with one exception:
`unsafe_conditions`. A reader who has just reported that it is not safe to be
somewhere should not be instructed to stay and photograph it. Every other reason
— no access, obstructed, not found, reschedule — has something visible to record.

The photo uploads *before* the skip is posted, because the API refuses a skip
without one. A skip needing evidence therefore cannot be recorded offline; it
stays in the device queue until there is a connection. That is deliberate: a
skip that landed without its evidence is precisely the gap this closes.

**An exception hangs off either a read event or a run stop**, never both.
`read_event_id` is nullable, `run_stop_id` is new, and a database `CHECK`
enforces `(read_event_id IS NULL) <> (run_stop_id IS NULL)`. A skip raises
`skipped_unresolved` against the stop, so it lands in the queue supervisors
already work, carrying the reason, the photograph and the reader.

Reading a skipped stop later resolves the exception automatically — the question
has been answered, and the meter should not stay held out of billing.

### The alternative that was rejected

The obvious way to avoid schema change is to record a synthetic zero-valued read
and hang the exception off that. It was rejected for three reasons:

1. **It corrupts the baseline.** Read values feed the validation engine's
   trailing window (ADR-010). A placeholder becomes a data point, and the *next*
   real read differences against it — producing nonsense consumption and
   spurious `negative_consumption` or `leak_spike` findings. This is the exact
   failure mode two rounds of UAT were spent eliminating.
2. **It lies in the audit trail.** ADR-002 defines a read event as a reading
   actually taken. Recording a fictional one undermines the very evidence
   standard the photograph exists to raise.
3. **It puts the nullability in the wrong table.** Making it safe would require
   a nullable `value` plus a kind discriminator on `read_events` — the same
   polymorphism, relocated into the table that billing, baselines and consumption
   all derive from, rather than into a review artifact.

## Consequences

- Every read path that joined exceptions to reads had to accept a null one: the
  queue list (`value` and `consumption` are nullable, `skipReasonCode` carries
  the meaning instead), the detail screen (no chart, no GPS compare, no flagged
  read, and **reread is not offered** — there is no reading to re-take), the
  per-reader counts on dashboard and roster, and the export's exception mapping.
- A skip counts toward a reader's exception *total* but never toward the flagged
  ratio, which is the share of their **reads** that tripped a rule. Counting
  skips there would push the rate above 100%, which was a real defect once.
- A skipped stop is already held out of billing by its skip reason, so the new
  exception changes review, not money.
- Skip photos are keyed `photos/skip/<runStopId>` — derived from an immutable id
  exactly as read photos are (ADR-013), so nothing is ever mutated to attach one.
- `skipped_unresolved` is now a real part of the taxonomy rather than a dead
  entry, which is what ADR-003 intends taxonomy rows to be.
