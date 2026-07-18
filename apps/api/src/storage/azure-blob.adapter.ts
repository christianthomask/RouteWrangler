import {
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import type { PresignedUpload, StoragePort } from './storage.port';

export interface AzureBlobConfig {
  account: string;
  container: string;
  accountKey: string;
}

/**
 * Azure Blob adapter (ADR-015) — the other cloud target. Mirrors the S3 adapter:
 * a SAS-signed PUT for uploads, a SAS-signed GET for downloads. Uploads must
 * carry `x-ms-blob-type: BlockBlob`, surfaced in the returned headers so the
 * client sends it.
 *
 * NOTE: implemented to the documented SAS contract but NOT yet verified against
 * a live Azure account (no account provisioned — see docs/questions.md). The
 * port design means switching to Azure is config + this adapter, no app change.
 */
export class AzureBlobStorageAdapter implements StoragePort {
  readonly configured = true;
  readonly kind = 'azure_blob';
  private readonly cred: StorageSharedKeyCredential;

  constructor(private readonly cfg: AzureBlobConfig) {
    this.cred = new StorageSharedKeyCredential(cfg.account, cfg.accountKey);
  }

  private sas(key: string, permissions: string, expiresInSeconds: number): string {
    const now = new Date();
    const params = generateBlobSASQueryParameters(
      {
        containerName: this.cfg.container,
        blobName: key,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn: new Date(now.valueOf() - 60_000),
        expiresOn: new Date(now.valueOf() + expiresInSeconds * 1000),
        protocol: SASProtocol.Https,
      },
      this.cred,
    ).toString();
    return `https://${this.cfg.account}.blob.core.windows.net/${this.cfg.container}/${encodeURIComponent(
      key,
    )}?${params}`;
  }

  async presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    return {
      method: 'PUT',
      uploadUrl: this.sas(key, 'cw', expiresInSeconds),
      headers: { 'Content-Type': contentType, 'x-ms-blob-type': 'BlockBlob' },
      expiresInSeconds,
    };
  }

  async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return this.sas(key, 'r', expiresInSeconds);
  }
}
