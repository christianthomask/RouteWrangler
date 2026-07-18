import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { loadEnv } from '../src/config/env';
import { users } from '../src/db/schema';
import { SEED_USERS, localOnlySub } from './seed-data';
import { ensurePoolUser } from './cognito';
import { seedTaxonomy } from './taxonomy';
import { seedWorld } from './world';

/**
 * Sprint 1 seed (BUILD_SPEC §5 determinism, §6 both-halves, §7.6). One seed
 * builds the entire world: users (pool + local), taxonomy lookups, clients,
 * meters, routes, 12 months of seasonal history, and today's demo run shaped so
 * the simulator trips every validation rule. Idempotent — deterministic ids +
 * upserts, so rerunning changes nothing.
 */
async function main() {
  const env = loadEnv();
  const hasAwsCreds = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const fullMode = env.authConfigured && hasAwsCreds;

  console.log(
    fullMode
      ? `Seeding in FULL mode (Cognito pool ${env.COGNITO_USER_POOL_ID} + local rows)`
      : 'Seeding in LOCAL-ONLY mode (Postgres rows only — no Cognito pool configured)',
  );

  const { db, sql } = createDb(env.DATABASE_URL);
  try {
    // 1) Users — both halves in full mode, local rows in local-only mode.
    const subs = new Map<string, string>();
    for (const user of SEED_USERS) {
      const sub = fullMode ? await ensurePoolUser(env, user) : localOnlySub(user.username);
      subs.set(user.username, sub);
      await db
        .insert(users)
        .values({ cognitoSub: sub, displayName: user.displayName, role: user.role })
        .onConflictDoUpdate({
          target: users.cognitoSub,
          set: { displayName: user.displayName, role: user.role, updatedAt: new Date() },
        });
      console.log(`  ✓ ${user.role.padEnd(10)} ${user.displayName} (${sub})`);
    }

    // Resolve the reader's local id (owner of runs + historical reads).
    const readerSub = subs.get('reader1')!;
    const [reader] = await db.select().from(users).where(eq(users.cognitoSub, readerSub)).limit(1);
    if (!reader) throw new Error('reader1 not found after seeding users');

    // 2) Taxonomy lookups (labels are data; rules are code — ADR-003).
    await seedTaxonomy(db);
    console.log('  ✓ taxonomy (severities, exception types, skip reasons)');

    // 3) The world + 12-month history + today's demo run.
    const world = await seedWorld(db, reader.id, new Date());
    console.log(
      `  ✓ world: ${world.meterCount} meters, ${world.readCount} historical reads across 3 clients`,
    );
    console.log(`  ✓ demo run ${world.demoRunId} (open, assigned to ${reader.displayName})`);

    console.log('\nSeed complete. Run the pipeline with:');
    console.log(`  SIM_READER_SUB='${readerSub}' pnpm --filter @routewrangler/simulator playback`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
