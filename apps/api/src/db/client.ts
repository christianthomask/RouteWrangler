import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>['db'];

/**
 * Creates a Drizzle client over a postgres.js pool. Callers own the returned
 * `sql` handle so it can be closed cleanly (scripts, tests). The Nest app holds
 * one instance for its lifetime via the DB provider.
 */
export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}
