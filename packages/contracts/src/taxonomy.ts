import { z } from 'zod';
import { ExceptionCodeSchema, SeverityCodeSchema, SkipReasonCodeSchema } from './validation';

/**
 * GET /taxonomy — the seeded lookup tables the UI reads for labels (ADR-003).
 * Rules are code; these are data.
 */
export const SeveritySchema = z.object({
  code: SeverityCodeSchema,
  label: z.string(),
  rank: z.number().int(),
});
export type Severity = z.infer<typeof SeveritySchema>;

export const ExceptionTypeSchema = z.object({
  code: ExceptionCodeSchema,
  label: z.string(),
  defaultSeverity: SeverityCodeSchema,
  /** Whether an open exception of this type blocks the read from billing. */
  blocksBilling: z.boolean(),
});
export type ExceptionType = z.infer<typeof ExceptionTypeSchema>;

export const SkipReasonSchema = z.object({
  code: SkipReasonCodeSchema,
  label: z.string(),
});
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const TaxonomyResponseSchema = z.object({
  severities: z.array(SeveritySchema),
  exceptionTypes: z.array(ExceptionTypeSchema),
  skipReasons: z.array(SkipReasonSchema),
});
export type TaxonomyResponse = z.infer<typeof TaxonomyResponseSchema>;
