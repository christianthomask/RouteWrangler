import { z } from 'zod';
import { ExceptionCodeSchema, SeverityCodeSchema } from './validation';
import { SourceTypeSchema } from './ingestion';

/**
 * Supervisor console — exception triage (BUILD_SPEC §7.3, W4). The exception
 * queue and the exception-detail "hero" screen (flagged value vs 12-month
 * consumption, GPS pin vs registered location, photo).
 */
export const ExceptionStatusSchema = z.enum([
  'open',
  'reread_ordered',
  'reread_received',
  'resolved',
  'overridden',
  'escalated',
]);
export type ExceptionStatus = z.infer<typeof ExceptionStatusSchema>;

/** One row in the exception queue. */
export const ExceptionListItemSchema = z.object({
  id: z.string().uuid(),
  typeCode: ExceptionCodeSchema,
  typeLabel: z.string(),
  severityCode: SeverityCodeSchema,
  status: ExceptionStatusSchema,
  clientId: z.string().uuid(),
  clientName: z.string(),
  meterId: z.string().uuid(),
  meterSerial: z.string(),
  serviceAddress: z.string(),
  value: z.number(),
  consumption: z.number().nullable(),
  rereadCount: z.number().int(),
  createdAt: z.string(),
});
export type ExceptionListItem = z.infer<typeof ExceptionListItemSchema>;

export const ExceptionListResponseSchema = z.object({
  exceptions: z.array(ExceptionListItemSchema),
  total: z.number().int(),
});
export type ExceptionListResponse = z.infer<typeof ExceptionListResponseSchema>;

/** Query filters (BUILD_SPEC §7.3 — type / severity / route / client / status). */
export const ExceptionFiltersSchema = z.object({
  type: ExceptionCodeSchema.optional(),
  severity: SeverityCodeSchema.optional(),
  status: ExceptionStatusSchema.optional(),
  clientId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
});
export type ExceptionFilters = z.infer<typeof ExceptionFiltersSchema>;

/** A read event as shown in the detail / side-by-side comparison. */
export const ReadEventViewSchema = z.object({
  id: z.string().uuid(),
  value: z.number(),
  consumption: z.number().nullable(),
  capturedAt: z.string(),
  receivedAt: z.string(),
  sourceType: SourceTypeSchema,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  billable: z.boolean(),
  annotations: z.record(z.unknown()),
  /** Presigned GET URL for the photo, when one is attached and storage is up. */
  photoUrl: z.string().nullable(),
});
export type ReadEventView = z.infer<typeof ReadEventViewSchema>;

/** A point on the meter's 12-month consumption chart. */
export const ConsumptionPointSchema = z.object({
  capturedAt: z.string(),
  value: z.number(),
  consumption: z.number().nullable(),
  /** True for the read that triggered this exception. */
  flagged: z.boolean(),
});
export type ConsumptionPoint = z.infer<typeof ConsumptionPointSchema>;

/** The exception-detail payload — the certified-read moment. */
export const ExceptionDetailSchema = z.object({
  id: z.string().uuid(),
  typeCode: ExceptionCodeSchema,
  typeLabel: z.string(),
  severityCode: SeverityCodeSchema,
  status: ExceptionStatusSchema,
  rereadCount: z.number().int(),
  resolutionNote: z.string().nullable(),
  certifiedReadEventId: z.string().uuid().nullable(),
  createdAt: z.string(),

  client: z.object({ id: z.string().uuid(), name: z.string() }),
  meter: z.object({
    id: z.string().uuid(),
    serial: z.string(),
    serviceAddress: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    registerDials: z.number().int(),
    accessNotes: z.string().nullable(),
  }),

  /** The flagged read. */
  flaggedRead: ReadEventViewSchema,
  /** Reread events linked to this exception (for side-by-side). */
  rereads: z.array(ReadEventViewSchema),
  /** The meter's trailing consumption series, flagged point marked. */
  consumptionSeries: z.array(ConsumptionPointSchema),
  /** Which actions are currently allowed (drives the action bar). */
  allowedActions: z.array(z.enum(['reread', 'override', 'resolve', 'escalate'])),
});
export type ExceptionDetail = z.infer<typeof ExceptionDetailSchema>;

// ── action requests ─────────────────────────────────────────────────────────
export const OrderRereadRequestSchema = z.object({
  note: z.string().optional(),
});
export type OrderRereadRequest = z.infer<typeof OrderRereadRequestSchema>;

/** Override/accept, resolve, and escalate all require a note (BUILD_SPEC §7.3). */
export const ResolveRequestSchema = z.object({
  note: z.string().min(1),
  /** The read certified as billable (defaults to the flagged read). */
  certifiedReadEventId: z.string().uuid().optional(),
});
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

export const NoteRequestSchema = z.object({ note: z.string().min(1) });
export type NoteRequest = z.infer<typeof NoteRequestSchema>;
