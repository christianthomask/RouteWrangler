import { Global, Logger, Module } from '@nestjs/common';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { STORAGE, type StoragePort } from './storage.port';
import { S3StorageAdapter } from './s3.adapter';
import { NullStorageAdapter } from './null.adapter';

/**
 * Selects the object-storage adapter by config (ADR-015). Global so PhotosService
 * (and later exports) inject `@Inject(STORAGE)` without re-importing. Unconfigured
 * → NullStorage (labeled 503), so the app always boots.
 *
 * One adapter covers every target we actually run: MinIO locally, R2 in
 * production, S3 anywhere else — they differ by endpoint, not by code. The Azure
 * Blob adapter that used to sit here was written to the documented SAS contract
 * and never run against a live account; it was removed rather than kept as a
 * second, unexercised path (ADR-026).
 */
function buildStorage(env: Env): StoragePort {
  const log = new Logger('StorageModule');
  if (env.S3_BUCKET) {
    log.log(`storage: s3 (bucket=${env.S3_BUCKET}${env.S3_ENDPOINT ? `, endpoint=${env.S3_ENDPOINT}` : ''})`);
    return new S3StorageAdapter({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  log.warn('storage: none configured — /photos/presign returns 503 (see docs/runbook.md)');
  return new NullStorageAdapter();
}

@Global()
@Module({
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: (env: Env) => buildStorage(env) }],
  exports: [STORAGE],
})
export class StorageModule {}
