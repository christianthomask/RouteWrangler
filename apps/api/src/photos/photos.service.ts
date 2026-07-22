import { Inject, Injectable } from '@nestjs/common';
import type { PresignRequest, PresignResponse } from '@routewrangler/contracts';
import { STORAGE, type StoragePort } from '../storage/storage.port';

const EXPIRES_SECONDS = 900;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/**
 * Presigned upload for a read's photo (BUILD_SPEC §7.1). The key is derived
 * deterministically from the immutable event id — the row is never mutated, so
 * immutability (ADR-002) holds even though the binary attaches async (ADR-013).
 * Storage is a port (ADR-015): S3/MinIO or Azure Blob, chosen by config; this
 * service is provider-agnostic.
 */
@Injectable()
export class PhotosService {
  constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

  async presign(req: PresignRequest): Promise<PresignResponse> {
    const ext = EXT_BY_TYPE[req.contentType] ?? 'bin';
    // Skip photos are keyed by the stop, reads by the event. Both are immutable
    // ids, so both keys stay pure functions of what they describe (ADR-013).
    const photoKey = req.readEventId
      ? `photos/${req.readEventId}.${ext}`
      : `photos/skip/${req.runStopId}.${ext}`;

    // NullStorage throws a labeled 503 here when nothing is configured.
    const upload = await this.storage.presignUpload(photoKey, req.contentType, EXPIRES_SECONDS);

    return {
      method: upload.method,
      uploadUrl: upload.uploadUrl,
      photoKey,
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
    };
  }
}
