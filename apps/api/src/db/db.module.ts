import { Global, Module } from '@nestjs/common';
import { createDb, type Database } from './client';
import { loadEnv } from '../config/env';

/** DI token for the Drizzle database handle. */
export const DB = Symbol('DB');

/**
 * A single shared Drizzle instance for the app's lifetime. Global so any module
 * can inject `@Inject(DB)` without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Database => {
        const env = loadEnv();
        const { db } = createDb(env.DATABASE_URL);
        return db;
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
