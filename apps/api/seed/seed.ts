import { createDb } from '../src/db/client';
import { loadEnv } from '../src/config/env';
import { users } from '../src/db/schema';
import { SEED_USERS, localOnlySub } from './seed-data';
import { ensurePoolUser } from './cognito';

/**
 * Sprint 0 seed (BUILD_SPEC §5 determinism, §6 both-halves). Idempotent by
 * design: rerunning upserts on `cognito_sub`, never duplicating.
 *
 * Two modes, both real, the stubbed one labeled:
 *  - full:       AWS creds + pool id present → provisions Cognito users AND
 *                links local rows to their real subs.
 *  - local-only: no AWS creds → local rows only, with a `local-only:` sub. The
 *                API's JWT guard will not accept these until the pool exists;
 *                this is the pre-provisioning skeleton state, clearly labeled.
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
    for (const user of SEED_USERS) {
      const sub = fullMode ? await ensurePoolUser(env, user) : localOnlySub(user.username);

      await db
        .insert(users)
        .values({ cognitoSub: sub, displayName: user.displayName, role: user.role })
        .onConflictDoUpdate({
          target: users.cognitoSub,
          set: { displayName: user.displayName, role: user.role, updatedAt: new Date() },
        });

      console.log(`  ✓ ${user.role.padEnd(10)} ${user.displayName} (${sub})`);
    }
    console.log(`Seed complete: ${SEED_USERS.length} users.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
