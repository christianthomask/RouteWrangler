/**
 * Object-storage port (ADR-015 — cloud portability via ports & adapters). One of
 * the two genuinely vendor-specific seams. Adapters: S3 (AWS S3 or any
 * S3-compatible endpoint incl. MinIO / R2) and Azure Blob. The rest of the app
 * depends only on this interface, never on a cloud SDK.
 */
export interface PresignedUpload {
  method: 'PUT';
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface StoragePort {
  /** False when no backing store is configured (the labeled pre-provision state). */
  readonly configured: boolean;
  /** A short human label for logs/health (e.g. "s3", "azure_blob", "none"). */
  readonly kind: string;
  presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;
  presignDownload(key: string, expiresInSeconds: number): Promise<string>;
}

/** DI token for the active StoragePort. */
export const STORAGE = Symbol('STORAGE');
