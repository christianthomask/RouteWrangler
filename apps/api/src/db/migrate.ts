import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';
import { loadEnv } from '../config/env';

/**
 * Applies checked-in Drizzle migrations. Run via `pnpm db:migrate` locally and
 * in CI's migration-check step. Migrations are plain-SQL-readable and committed
 * (BUILD_SPEC §4).
 */
async function main() {
  const env = loadEnv();
  const { db, sql } = createDb(env.DATABASE_URL);
  try {
    await migrate(db, { migrationsFolder: `${__dirname}/../../drizzle` });
    console.log('migrations applied');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
