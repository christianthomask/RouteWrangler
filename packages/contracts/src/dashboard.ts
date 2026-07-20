import { z } from 'zod';
import { SeverityCodeSchema } from './validation';

/**
 * Supervisor dashboard (BUILD_SPEC §7.3): today's runs completion, exceptions by
 * severity, reader progress, aging open runs.
 */
export const RunProgressSchema = z.object({
  runId: z.string().uuid(),
  routeName: z.string(),
  clientName: z.string(),
  readerName: z.string().nullable(),
  runDate: z.string(),
  status: z.enum(['open', 'closed']),
  totalStops: z.number().int(),
  readStops: z.number().int(),
  skippedStops: z.number().int(),
  pendingStops: z.number().int(),
  completionPct: z.number(),
});
export type RunProgress = z.infer<typeof RunProgressSchema>;

export const ReaderProgressSchema = z.object({
  readerId: z.string().uuid(),
  readerName: z.string(),
  reads: z.number().int(),
  exceptions: z.number().int(),
  exceptionRate: z.number(),
});
export type ReaderProgress = z.infer<typeof ReaderProgressSchema>;

export const DashboardSchema = z.object({
  runs: z.array(RunProgressSchema),
  exceptionsBySeverity: z.array(
    z.object({ severity: SeverityCodeSchema, open: z.number().int() }),
  ),
  openExceptions: z.number().int(),
  readers: z.array(ReaderProgressSchema),
  /** Open runs older than today (aging). */
  agingRuns: z.array(RunProgressSchema),
});
export type Dashboard = z.infer<typeof DashboardSchema>;
