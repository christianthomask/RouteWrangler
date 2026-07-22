import { z } from 'zod';

/**
 * Photos flow separately from the read (BUILD_SPEC §7.1): the event lands first,
 * then the client requests a presigned URL, uploads, and `photo_key` attaches on
 * completion. An event is never blocked by its photo.
 */
/**
 * A photo belongs either to a read event or to a skipped stop. Both keys are
 * derived from an immutable id (ADR-013), so exactly one of the two identifies
 * the upload — a request naming both, or neither, is ambiguous and rejected.
 */
export const PresignRequestSchema = z
  .object({
    readEventId: z.string().uuid().optional(),
    runStopId: z.string().uuid().optional(),
    contentType: z.string().min(1),
  })
  .refine((r) => Boolean(r.readEventId) !== Boolean(r.runStopId), {
    message: 'supply exactly one of readEventId or runStopId',
  });
export type PresignRequest = z.infer<typeof PresignRequestSchema>;

export const PresignResponseSchema = z.object({
  method: z.literal('PUT'),
  uploadUrl: z.string().url(),
  photoKey: z.string(),
  /** Headers the client must echo on the upload PUT. */
  headers: z.record(z.string()),
  expiresInSeconds: z.number().int().positive(),
});
export type PresignResponse = z.infer<typeof PresignResponseSchema>;
