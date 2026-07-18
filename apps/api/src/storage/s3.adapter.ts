import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignedUpload, StoragePort } from './storage.port';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Override endpoint for S3-compatible stores (MinIO, R2). Undefined = AWS S3. */
  endpoint?: string;
  /** MinIO and friends need path-style addressing. */
  forcePathStyle?: boolean;
  /** Explicit creds for local/MinIO; omit to use the default AWS provider chain. */
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * S3 adapter (ADR-015). Works against AWS S3 in prod and any S3-compatible
 * endpoint locally — notably MinIO — with zero code change, just config. The
 * presign flow is identical in both, preserving production shape in local dev.
 */
export class S3StorageAdapter implements StoragePort {
  readonly configured = true;
  readonly kind = 's3';
  private readonly client: S3Client;

  constructor(private readonly cfg: S3StorageConfig) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
          : undefined,
    });
  }

  async presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const command = new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
    return { method: 'PUT', uploadUrl, headers: { 'Content-Type': contentType }, expiresInSeconds };
  }

  async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
