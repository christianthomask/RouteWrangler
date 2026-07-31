import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createDb, type Database } from '../db/client';
import { users } from '../db/schema';

/**
 * The invitation claim (ADR-027) is the one place a request can *grant itself*
 * an identity, and its safety rests entirely on the database: a conditional
 * UPDATE plus a unique index, not on application-level checking. So it is tested
 * against a real Postgres — a mocked builder chain would prove only that the
 * code calls `.where()`.
 *
 * DB-backed — runs when DATABASE_URL is set (CI + local Postgres), skipped
 * otherwise so unit runs stay hermetic.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

/** The guard's claim, verbatim (see jwt-auth.guard.ts `resolveUser`). */
function claim(db: Database, sub: string, email: string) {
  return db
    .update(users)
    .set({ authSub: sub, updatedAt: new Date() })
    .where(and(isNull(users.authSub), sql`lower(${users.email}) = ${email}`))
    .returning();
}

suite('invitation claim', () => {
  let db: Database;
  let close: () => Promise<void>;
  const created: string[] = [];

  beforeAll(() => {
    const c = createDb(url as string);
    db = c.db;
    close = () => c.sql.end();
  });

  afterAll(async () => {
    if (created.length) await db.delete(users).where(inArray(users.id, created));
    await close();
  });

  async function invite(email: string) {
    const [row] = await db
      .insert(users)
      .values({ email, displayName: `Invitee ${email}`, role: 'reader' })
      .returning();
    if (!row) throw new Error('insert returned no row');
    created.push(row.id);
    return row;
  }

  it('links the row on first sign-in and leaves it linked', async () => {
    const email = `dana-${randomUUID()}@example.com`;
    const invited = await invite(email);
    expect(invited.authSub).toBeNull();

    const [claimed] = await claim(db, 'neon|first', email);
    expect(claimed?.id).toBe(invited.id);
    expect(claimed?.authSub).toBe('neon|first');
    expect(claimed?.role).toBe('reader');
  });

  it('a second identity cannot take an invitation that is already claimed', async () => {
    const email = `taken-${randomUUID()}@example.com`;
    await invite(email);

    const first = await claim(db, 'neon|winner', email);
    const second = await claim(db, 'neon|loser', email);

    expect(first).toHaveLength(1);
    // Zero rows, not an error and not a silent overwrite: the loser is then
    // rejected exactly like a stranger, which is what the guard does with it.
    expect(second).toHaveLength(0);
  });

  it('exactly one of two concurrent first requests wins', async () => {
    const email = `race-${randomUUID()}@example.com`;
    await invite(email);

    const [a, b] = await Promise.all([
      claim(db, 'neon|racer-a', email),
      claim(db, 'neon|racer-b', email),
    ]);

    expect(a.length + b.length).toBe(1);
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(['neon|racer-a', 'neon|racer-b']).toContain(row?.authSub);
  });

  it('matches case-insensitively, because an admin typed the address by hand', async () => {
    const local = `mixed-${randomUUID()}`;
    const row = await invite(`${local}@example.com`);

    // The guard lowercases the token claim; the predicate lowercases the column.
    const [claimed] = await claim(db, 'neon|mixed', `${local}@example.com`);
    expect(claimed?.id).toBe(row.id);
  });

  it('refuses two invitations for the same address in different cases', async () => {
    const local = `dupe-${randomUUID()}`;
    await invite(`${local}@example.com`);

    // Without the unique index on lower(email), the claim above would have two
    // candidate rows and would pick one arbitrarily.
    await expect(
      db
        .insert(users)
        .values({ email: `${local.toUpperCase()}@EXAMPLE.com`, displayName: 'Second', role: 'admin' })
        .returning(),
    ).rejects.toThrow();
  });

  it('refuses a row with neither an identity nor an address', async () => {
    // Nobody could ever sign in as it and no invitation could ever land on it.
    await expect(
      db.insert(users).values({ displayName: 'Unreachable', role: 'admin' }).returning(),
    ).rejects.toThrow();
  });
});
