import { z } from 'zod';
import { ExceptionCodeSchema } from './validation';

/**
 * Billing export (BUILD_SPEC §7.4, W4). Per client + cycle, the billable reads
 * are rendered to the client's export format and handed to their billing system.
 * A read is billable when it passed validation, or when its blocking exception
 * was resolved/overridden with a certified read (ADR-002 — certification is
 * recorded, the read is never mutated). Reads with an unresolved blocking
 * exception are *held* out of the file until a supervisor clears them; stops with
 * no read are *missing*.
 */
export const ExportFormatSchema = z.enum(['csv']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/** Why a meter is not in the billable file. */
export const HoldReasonSchema = z.enum(['blocking_exception', 'not_read']);
export type HoldReason = z.infer<typeof HoldReasonSchema>;

export const ExportHoldSchema = z.object({
  meterId: z.string().uuid(),
  meterSerial: z.string(),
  serviceAddress: z.string(),
  reason: HoldReasonSchema,
  /** The blocking exception's code, when the hold is an exception. */
  exceptionCode: ExceptionCodeSchema.nullable(),
});
export type ExportHold = z.infer<typeof ExportHoldSchema>;

export const ExportCountsSchema = z.object({
  billable: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
});
export type ExportCounts = z.infer<typeof ExportCountsSchema>;

/** Dry run: what would export now, and what's holding billing back. */
export const ExportPreviewSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string(),
  cycleId: z.string(),
  totalStops: z.number().int().nonnegative(),
  counts: ExportCountsSchema,
  holds: z.array(ExportHoldSchema),
  /** The current (non-superseded) export for this client+cycle, if one exists. */
  lastExportId: z.string().uuid().nullable(),
  lastExportAt: z.string().nullable(),
});
export type ExportPreview = z.infer<typeof ExportPreviewSchema>;

export const ExportRunViewSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  clientName: z.string(),
  cycleId: z.string(),
  format: ExportFormatSchema,
  filename: z.string(),
  ranByName: z.string(),
  ranAt: z.string(),
  counts: ExportCountsSchema,
  /** True once a later export for the same client+cycle supersedes this one. */
  superseded: z.boolean(),
});
export type ExportRunView = z.infer<typeof ExportRunViewSchema>;

export const ExportListResponseSchema = z.object({ exports: z.array(ExportRunViewSchema) });
export type ExportListResponse = z.infer<typeof ExportListResponseSchema>;

export const ExportCyclesResponseSchema = z.object({ cycles: z.array(z.string()) });
export type ExportCyclesResponse = z.infer<typeof ExportCyclesResponseSchema>;

/** Materialize the export for a client + cycle. */
export const RunExportRequestSchema = z.object({
  clientId: z.string().uuid(),
  cycleId: z.string().min(1),
});
export type RunExportRequest = z.infer<typeof RunExportRequestSchema>;
