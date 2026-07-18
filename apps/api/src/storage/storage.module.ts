import { Global, Logger, Module } from '@nestjs/common';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { STORAGE, type StoragePort } from './storage.port';
import { S3StorageAdapter } from './s3.adapter';
import { AzureBlobStorageAdapter } from './azure-blob.adapter';
import { NullStorageAdapter } from './null.adapter';

/**
 * Selects the object-storage adapter by config (ADR-015). Global so PhotosService
 * (and later exports) inject `@Inject(STORAGE)` without re-importing. Unconfigured
 * → NullStorage (labeled 503), so the app always boots.
 */
function buildStorage(env: Env): StoragePort {
  const log = new Logger('StorageModule');
  if (env.STORAGE_PROVIDER === 's3' && env.S3_BUCKET) {
    log.log(`storage: s3 (bucket=${env.S3_BUCKET}${env.S3_ENDPOINT ? `, endpoint=${env.S3_ENDPOINT}` : ''})`);
    return new S3StorageAdapter({
      bucket: env.S3_BUCKET,
      region: env.AWS_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  if (
    env.STORAGE_PROVIDER === 'azure_blob' &&
    env.AZURE_STORAGE_ACCOUNT &&
    env.AZURE_STORAGE_CONTAINER &&
    env.AZURE_STORAGE_ACCOUNT_KEY
  ) {
    log.log(`storage: azure_blob (account=${env.AZURE_STORAGE_ACCOUNT})`);
    return new AzureBlobStorageAdapter({
      account: env.AZURE_STORAGE_ACCOUNT,
      container: env.AZURE_STORAGE_CONTAINER,
      accountKey: env.AZURE_STORAGE_ACCOUNT_KEY,
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
