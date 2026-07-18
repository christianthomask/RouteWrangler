import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignRequest, PresignResponse } from '@routewrangler/contracts';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';

const EXPIRES_SECONDS = 900;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/**
 * Presigned S3 upload for a read's photo (BUILD_SPEC §7.1). The key is derived
 * deterministically from the immutable event id — the row is never mutated, so
 * immutability (ADR-002) holds even though the binary attaches async (ADR-013).
 * Real presigning via the S3 SDK; a labeled 503 until the bucket is provisioned.
 */
@Injectable()
export class PhotosService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async presign(req: PresignRequest): Promise<PresignResponse> {
    if (!this.env.S3_BUCKET) {
      throw new ServiceUnavailableException(
        'S3 not configured — provision the photos bucket (see docs/runbook.md)',
      );
    }

    const ext = EXT_BY_TYPE[req.contentType] ?? 'bin';
    const photoKey = `photos/${req.readEventId}.${ext}`;

    const client = new S3Client({ region: this.env.AWS_REGION });
    const command = new PutObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: photoKey,
      ContentType: req.contentType,
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: EXPIRES_SECONDS });

    return {
      method: 'PUT',
      uploadUrl,
      photoKey,
      headers: { 'Content-Type': req.contentType },
      expiresInSeconds: EXPIRES_SECONDS,
    };
  }
}
