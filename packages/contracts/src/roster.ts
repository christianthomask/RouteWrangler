import { z } from 'zod';

/** Roster — every reader as an entity (BUILD_SPEC §7.3). */
export const RosterReaderSchema = z.object({
  readerId: z.string().uuid(),
  name: z.string(),
  todaysRuns: z.number().int(),
  openRuns: z.number().int(),
  completionRate: z.number(), // 0–100, avg across today's runs
  reads: z.number().int(),
  exceptions: z.number().int(),
  exceptionRate: z.number(), // exceptions / reads
});
export type RosterReader = z.infer<typeof RosterReaderSchema>;

export const RosterResponseSchema = z.object({ readers: z.array(RosterReaderSchema) });
export type RosterResponse = z.infer<typeof RosterResponseSchema>;
