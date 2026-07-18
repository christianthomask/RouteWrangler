import { z } from 'zod';

/**
 * Photos flow separately from the read (BUILD_SPEC §7.1): the event lands first,
 * then the client requests a presigned URL, uploads, and `photo_key` attaches on
 * completion. An event is never blocked by its photo.
 */
export const PresignRequestSchema = z.object({
  readEventId: z.string().uuid(),
  contentType: z.string().min(1),
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
