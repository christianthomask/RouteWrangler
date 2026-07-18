import { z } from 'zod';

/**
 * Minimal run views for Sprint 1 — enough for the simulator's playback client to
 * fetch its worklist through the public API (no privileged DB access). The full
 * run lifecycle (materialization, splits, close-out) lands in Sprint 3.
 */
export const RunStatusSchema = z.enum(['open', 'closed']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunStopStatusSchema = z.enum(['pending', 'read', 'skipped']);
export type RunStopStatus = z.infer<typeof RunStopStatusSchema>;

export const RunStopViewSchema = z.object({
  id: z.string().uuid(),
  meterId: z.string().uuid(),
  sequence: z.number().int(),
  status: RunStopStatusSchema,
  meterSerial: z.string(),
  registerDials: z.number().int().positive(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** The meter's most recent read value, if any (drives realistic simulation). */
  lastValue: z.number().nullable(),
});
export type RunStopView = z.infer<typeof RunStopViewSchema>;

export const RunSummarySchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  routeId: z.string().uuid(),
  readerId: z.string().uuid(),
  runDate: z.string(),
  cycleId: z.string(),
  status: RunStatusSchema,
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunDetailSchema = RunSummarySchema.extend({
  stops: z.array(RunStopViewSchema),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const RunListResponseSchema = z.object({
  runs: z.array(RunSummarySchema),
});
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
