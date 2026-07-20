import { z } from 'zod';
import { ExceptionCodeSchema, SeverityCodeSchema } from './validation';
import { ReadEventViewSchema, ConsumptionPointSchema, ExceptionStatusSchema } from './exceptions';

/** Meter history view (BUILD_SPEC §7.3): consumption chart, all events, prior exceptions. */
export const MeterHistoryResponseSchema = z.object({
  meter: z.object({
    id: z.string().uuid(),
    serial: z.string(),
    serviceAddress: z.string(),
    clientName: z.string(),
    registerDials: z.number().int(),
    accessNotes: z.string().nullable(),
  }),
  consumptionSeries: z.array(ConsumptionPointSchema),
  events: z.array(ReadEventViewSchema),
  exceptions: z.array(
    z.object({
      id: z.string().uuid(),
      typeCode: ExceptionCodeSchema,
      severityCode: SeverityCodeSchema,
      status: ExceptionStatusSchema,
      createdAt: z.string(),
    }),
  ),
});
export type MeterHistoryResponse = z.infer<typeof MeterHistoryResponseSchema>;
