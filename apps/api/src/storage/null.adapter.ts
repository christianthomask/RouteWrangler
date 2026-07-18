import { ServiceUnavailableException } from '@nestjs/common';
import type { PresignedUpload, StoragePort } from './storage.port';

/**
 * The labeled pre-provision state: no object store configured. Presign calls
 * fail loudly with a 503 rather than faking a URL (quality bar — never fake a
 * load-bearing thing).
 */
export class NullStorageAdapter implements StoragePort {
  readonly configured = false;
  readonly kind = 'none';

  private unavailable(): never {
    throw new ServiceUnavailableException(
      'object storage not configured — set STORAGE_PROVIDER + bucket/container (see docs/runbook.md)',
    );
  }

  async presignUpload(
    _key: string,
    _contentType: string,
    _expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    this.unavailable();
  }

  async presignDownload(_key: string, _expiresInSeconds: number): Promise<string> {
    this.unavailable();
  }
}
