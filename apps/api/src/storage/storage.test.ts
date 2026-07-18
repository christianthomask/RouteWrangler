import { describe, it, expect } from 'vitest';
import { S3StorageAdapter } from './s3.adapter';
import { AzureBlobStorageAdapter } from './azure-blob.adapter';
import { NullStorageAdapter } from './null.adapter';

/**
 * Presigned-URL generation is local crypto (no server round-trip), so both
 * adapters are fully testable here. This proves the storage port (ADR-015)
 * produces correct, provider-shaped URLs — the API's actual responsibility.
 */
describe('S3StorageAdapter (S3-compatible, incl. MinIO)', () => {
  const s3 = new S3StorageAdapter({
    bucket: 'routewrangler-photos',
    region: 'us-east-1',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  });

  it('presigns a PUT upload against the configured endpoint (path-style)', async () => {
    const up = await s3.presignUpload('photos/abc.jpg', 'image/jpeg', 900);
    expect(up.method).toBe('PUT');
    expect(up.uploadUrl).toContain('http://localhost:9000/routewrangler-photos/photos/abc.jpg');
    expect(up.uploadUrl).toContain('X-Amz-Signature=');
    expect(up.headers['Content-Type']).toBe('image/jpeg');
  });

  it('presigns a GET download', async () => {
    const url = await s3.presignDownload('photos/abc.jpg', 900);
    expect(url).toContain('http://localhost:9000/routewrangler-photos/photos/abc.jpg');
    expect(url).toContain('X-Amz-Signature=');
  });
});

describe('AzureBlobStorageAdapter', () => {
  const azure = new AzureBlobStorageAdapter({
    account: 'testacct',
    container: 'photos',
    accountKey: Buffer.from('test-signing-key').toString('base64'),
  });

  it('presigns a SAS PUT with the BlockBlob header', async () => {
    const up = await azure.presignUpload('photos/abc.jpg', 'image/jpeg', 900);
    expect(up.method).toBe('PUT');
    expect(up.uploadUrl).toContain('https://testacct.blob.core.windows.net/photos/');
    expect(up.uploadUrl).toContain('sig=');
    expect(up.headers['x-ms-blob-type']).toBe('BlockBlob');
  });

  it('presigns a SAS GET download', async () => {
    const url = await azure.presignDownload('photos/abc.jpg', 900);
    expect(url).toContain('sig=');
  });
});

describe('NullStorageAdapter', () => {
  it('is unconfigured and throws on use', async () => {
    const n = new NullStorageAdapter();
    expect(n.configured).toBe(false);
    await expect(n.presignUpload('k', 'image/jpeg', 900)).rejects.toThrow(/not configured/);
  });
});
