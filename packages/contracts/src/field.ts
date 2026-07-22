import { z } from 'zod';
import { ExceptionCodeSchema, SkipReasonCodeSchema, type SkipReasonCode } from './validation';
import { SourceTypeSchema } from './ingestion';

export const RereadTaskStatusSchema = z.enum(['issued', 'delivered', 'done']);
export type RereadTaskStatus = z.infer<typeof RereadTaskStatusSchema>;

/** A reader's reread task (BUILD_SPEC §7.2) — delivered on device sync. */
export const RereadTaskViewSchema = z.object({
  id: z.string().uuid(),
  exceptionId: z.string().uuid(),
  status: RereadTaskStatusSchema,
  meterId: z.string().uuid(),
  meterSerial: z.string(),
  serviceAddress: z.string(),
  typeCode: ExceptionCodeSchema,
  typeLabel: z.string(),
  /** The flagged value the reread should re-check against. */
  flaggedValue: z.number(),
  /**
   * The stop the flagged read was taken at, so the task can open the capture
   * screen directly. Null when the original read had no stop (a backfill or an
   * ad-hoc read), in which case the task is informational only.
   */
  runId: z.string().uuid().nullable(),
  runStopId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type RereadTaskView = z.infer<typeof RereadTaskViewSchema>;

export const RereadTasksResponseSchema = z.object({ tasks: z.array(RereadTaskViewSchema) });
export type RereadTasksResponse = z.infer<typeof RereadTasksResponseSchema>;

/** Skip a stop with a seeded reason (BUILD_SPEC §7.2, W5). */
export const SkipStopRequestSchema = z.object({
  skipReasonCode: SkipReasonCodeSchema,
  /**
   * Photograph of the reason — the locked gate, the obstruction. Required for
   * every reason except `unsafe_conditions`, where lingering to take a picture
   * is the wrong thing to ask of a reader. Keyed by the stop (ADR-013).
   */
  photoKey: z.string().optional(),
});

/** The one reason a skip may be recorded without photographic evidence. */
export const SKIP_REASON_WITHOUT_PHOTO: SkipReasonCode = 'unsafe_conditions';

export function skipRequiresPhoto(code: SkipReasonCode): boolean {
  return code !== SKIP_REASON_WITHOUT_PHOTO;
}
export type SkipStopRequest = z.infer<typeof SkipStopRequestSchema>;

/** A prior read shown to the reader in the field, most-recent first. */
export const FieldReadSchema = z.object({
  id: z.string().uuid(),
  value: z.number(),
  consumption: z.number().nullable(),
  capturedAt: z.string(),
  sourceType: SourceTypeSchema,
  readerName: z.string(),
  note: z.string().nullable(),
});
export type FieldRead = z.infer<typeof FieldReadSchema>;

/** Meter context for the field stop screen: standing access notes + read history. */
export const FieldMeterReadsResponseSchema = z.object({
  accessNotes: z.string().nullable(),
  reads: z.array(FieldReadSchema),
});
export type FieldMeterReadsResponse = z.infer<typeof FieldMeterReadsResponseSchema>;
