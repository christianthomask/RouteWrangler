import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { loadEnv } from '../src/config/env';
import { users } from '../src/db/schema';
import { SEED_USERS, localOnlySub } from './seed-data';
import { seedTaxonomy } from './taxonomy';
import { seedWorld } from './world';

/**
 * Sprint 1 seed (BUILD_SPEC §5 determinism, §6 both-halves, §7.6). One seed
 * builds the entire world: users, taxonomy lookups, clients, meters, routes, 12
 * months of seasonal history, and today's demo run shaped so the simulator trips
 * every validation rule. Idempotent — deterministic ids + upserts, so rerunning
 * changes nothing.
 *
 * Seeded users always carry `local-only:` subjects. There is no "provision the
 * IdP too" mode any more, and its absence is the point: under Neon Auth an
 * identity is created by a person signing in with Google, which a seed script
 * cannot do on their behalf. Seeding a deployed environment means seeding the
 * world and inviting the staff through Admin (ADR-027).
 */
async function main() {
  const env = loadEnv();

  console.log(
    env.authDevBypass
      ? 'Seeding users with local-only subjects (dev-auth shim is on — they can sign in)'
      : 'Seeding users with local-only subjects — NOTE: no IdP identity is attached,\n' +
          '  so nobody can sign in as them. Invite real staff through Admin → Staff.',
  );

  const { db, sql } = createDb(env.DATABASE_URL);
  try {
    // 1) Users.
    const subs = new Map<string, string>();
    for (const user of SEED_USERS) {
      const sub = localOnlySub(user.username);
      subs.set(user.username, sub);
      await db
        .insert(users)
        .values({
          authSub: sub,
          email: user.email.toLowerCase(),
          displayName: user.displayName,
          role: user.role,
        })
        .onConflictDoUpdate({
          target: users.authSub,
          set: {
            email: user.email.toLowerCase(),
            displayName: user.displayName,
            role: user.role,
            updatedAt: new Date(),
          },
        });
      console.log(`  ✓ ${user.role.padEnd(10)} ${user.displayName} (${sub})`);
    }

    // Resolve the reader's local id (owner of runs + historical reads).
    const readerSub = subs.get('reader1')!;
    const [reader] = await db.select().from(users).where(eq(users.authSub, readerSub)).limit(1);
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
