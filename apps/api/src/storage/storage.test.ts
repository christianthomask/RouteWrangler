import { describe, it, expect } from 'vitest';
import { S3StorageAdapter } from './s3.adapter';
import { NullStorageAdapter } from './null.adapter';

/**
 * Presigned-URL generation is local crypto (no server round-trip), so the
 * adapter is fully testable here. This proves the storage port (ADR-015)
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

describe('S3StorageAdapter (R2 — same adapter, endpoint only)', () => {
  // R2 is the production target (ADR-019) and reaches it through exactly this
  // path: no code branch, just a different endpoint and `auto` as the region.
  const r2 = new S3StorageAdapter({
    bucket: 'verameter-photos',
    region: 'auto',
    endpoint: 'https://acct123.r2.cloudflarestorage.com',
    forcePathStyle: true,
    accessKeyId: 'r2-key',
    secretAccessKey: 'r2-secret',
  });

  it('presigns against the R2 endpoint with no provider-specific code', async () => {
    const up = await r2.presignUpload('photos/abc.jpg', 'image/jpeg', 900);
    expect(up.method).toBe('PUT');
    expect(up.uploadUrl).toContain(
      'https://acct123.r2.cloudflarestorage.com/verameter-photos/photos/abc.jpg',
    );
    expect(up.uploadUrl).toContain('X-Amz-Signature=');
  });
});

describe('NullStorageAdapter', () => {
  it('is unconfigured and throws on use', async () => {
    const n = new NullStorageAdapter();
    expect(n.configured).toBe(false);
    await expect(n.presignUpload('k', 'image/jpeg', 900)).rejects.toThrow(/not configured/);
  });
});
