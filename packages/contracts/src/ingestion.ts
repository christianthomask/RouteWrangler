import { z } from 'zod';

/**
 * Source-agnostic read event (BUILD_SPEC §2.1). Every read — manual, touch,
 * radio, or simulated — enters through this one shape. The pipeline never cares
 * how it was captured; the simulator is provably just another API client.
 */
export const SourceTypeSchema = z.enum(['manual', 'touch', 'radio', 'simulated']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/**
 * A single read event as submitted by a client. `id` is a client-generated
 * UUIDv4 and IS the idempotency key (ADR-002, ADR-008). `capturedAt` is
 * client-asserted business truth; the server stamps `received_at` on arrival.
 */
export const ReadEventInputSchema = z.object({
  id: z.string().uuid(),
  meterId: z.string().uuid(),
  runStopId: z.string().uuid().nullable().optional(),
  /**
   * Server-authoritative — the reader is the authenticated principal, not this
   * field (H2). Kept optional for older clients/the simulator; the server
   * ignores any supplied value and stamps the caller's id.
   */
  readerId: z.string().uuid().nullable().optional(),
  // `.finite()` rejects Infinity/NaN (JSON `1e309` parses to Infinity and would
  // otherwise pass `nonnegative()` and poison the meter's baseline — M1). The
  // per-meter register-capacity ceiling is enforced in the service.
  value: z.number().finite().nonnegative(),
  capturedAt: z.string().datetime(),
  sourceType: SourceTypeSchema,
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  photoKey: z.string().nullable().optional(),
  /** Reader's free-text note captured with the read — immutable once ingested. */
  note: z.string().max(1000).nullable().optional(),
  /** For a reread: the exception this event answers (W4). */
  exceptionId: z.string().uuid().nullable().optional(),
});
export type ReadEventInput = z.infer<typeof ReadEventInputSchema>;

/** Single or batch — a synced offline queue posts a batch (BUILD_SPEC §7.1). */
export const IngestRequestSchema = z.object({
  events: z.array(ReadEventInputSchema).min(1).max(500),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

/** Per-event outcome — the caller reconciles its offline queue against this. */
export const IngestEventStatusSchema = z.enum(['accepted', 'duplicate', 'rejected']);
export type IngestEventStatus = z.infer<typeof IngestEventStatusSchema>;

export const IngestEventResultSchema = z.object({
  id: z.string().uuid(),
  status: IngestEventStatusSchema,
  /** True when the read passed validation with no exception. */
  billable: z.boolean().optional(),
  /** Exception codes opened for this event, if any. */
  exceptions: z.array(z.string()).optional(),
  /** Annotations applied (e.g. rollover in-band), if any. */
  annotations: z.record(z.unknown()).optional(),
  /** Populated when status is `rejected`. */
  message: z.string().optional(),
});
export type IngestEventResult = z.infer<typeof IngestEventResultSchema>;

export const IngestResponseSchema = z.object({
  results: z.array(IngestEventResultSchema),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
