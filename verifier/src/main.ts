import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { Api, runScenarios, type Outcome } from './harness';
import { SCENARIOS, setApiBaseUrl } from './scenarios';

/**
 * Automated UAT.
 *
 * Creates a scratch database, migrates it, seeds it, boots the **compiled** API
 * against it, drives the whole system over HTTP — including the simulator, which
 * is just another API client (ADR-014) — and prints a pass/fail report. Then it
 * puts everything back.
 *
 * It is versioned in the repo because a UAT that is a person following notes is
 * a UAT that reports whatever the person remembered to check that day. This one
 * reports the same things every time, and it is the pre-flight before a
 * stakeholder session: if it is red, do not run the demo.
 *
 * Deliberately not part of `pnpm test`. It boots a server and takes tens of
 * seconds; unit runs stay hermetic and fast.
 */

const ROOT = path.resolve(__dirname, '../..');
const API_PORT = Number(process.env.UAT_PORT ?? 3999);
const API_BASE = `http://127.0.0.1:${API_PORT}`;

/**
 * The scratch database is derived from DATABASE_URL rather than configured
 * separately, so the UAT cannot be pointed at the dev database by a stale
 * environment variable. It is dropped and recreated on every run: a UAT that
 * inherits yesterday's rows is not testing the thing it claims to.
 */
function scratchName(base: string): string {
  const name = new URL(base).pathname.replace(/^\//, '') || 'routewrangler';
  return `${name}_uat`;
}

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

async function recreateScratch(base: string, scratch: string): Promise<void> {
  // Connected to the maintenance database, because you cannot drop the one you
  // are connected to.
  // onnotice: DROP DATABASE IF EXISTS emits a NOTICE on the happy path, and the
  // default handler prints the whole server payload as if something went wrong.
  const sql = postgres(urlFor(base, 'postgres'), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE "${scratch}"`);
  } finally {
    await sql.end();
  }
}

async function dropScratch(base: string, scratch: string): Promise<void> {
  // onnotice: DROP DATABASE IF EXISTS emits a NOTICE on the happy path, and the
  // default handler prints the whole server payload as if something went wrong.
  const sql = postgres(urlFor(base, 'postgres'), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
  } catch {
    /* leaving a scratch database behind is untidy, not a failure */
  } finally {
    await sql.end();
  }
}

/**
 * Runs a Node script and fails loudly. No shell: on Windows the interpreter path
 * contains a space, and a shell splits it at "C:\Program".
 */
function runNode(label: string, script: string, env: NodeJS.ProcessEnv): void {
  const res = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    process.stdout.write(res.stdout ?? '');
    process.stderr.write(res.stderr ?? '');
    throw new Error(`${label} failed (exit ${res.status})`);
  }
}

/** Boots the built API and resolves once it answers, or rejects with its output. */
async function bootApi(databaseUrl: string): Promise<() => void> {
  const entry = path.join(ROOT, 'apps/api/dist/main.js');
  if (!existsSync(entry)) {
    throw new Error(`apps/api/dist/main.js is missing — run \`pnpm -r build\` first`);
  }

  const child = spawn(process.execPath, [entry], {
    cwd: path.join(ROOT, 'apps/api'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL: databaseUrl,
      // No IdP in a scratch environment: the dev shim (ADR-012) is how the UAT
      // signs in as each seeded role. It is hard-disabled in production, which
      // is exactly why the UAT cannot verify the real sign-in path — see the
      // note this run prints at the end.
      AUTH_DEV_BYPASS: 'true',
      AUTH_PROVIDER: 'neon',
      NEON_AUTH_BASE_URL: '',
      // Photo presign is exercised only where storage is configured; without it
      // the endpoint answers a labeled 503 rather than pretending.
      S3_BUCKET: process.env.S3_BUCKET ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (d: Buffer) => (log += d.toString()));
  child.stderr.on('data', (d: Buffer) => (log += d.toString()));

  const stop = () => {
    child.kill();
  };

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the API exited on boot:\n${log}`);
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) return stop;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error(`the API did not answer within 30s:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function report(outcomes: Outcome[]): boolean {
  const failed = outcomes.filter((o) => !o.ok);
  const ms = outcomes.reduce((a, o) => a + o.ms, 0);

  process.stdout.write(`\n${'─'.repeat(72)}\n`);
  process.stdout.write(
    `${outcomes.length - failed.length}/${outcomes.length} scenarios passed in ${(ms / 1000).toFixed(1)}s\n`,
  );

  if (failed.length) {
    process.stdout.write(`\nFailed:\n`);
    for (const f of failed) {
      process.stdout.write(`  • ${f.name}${f.cites ? ` (${f.cites})` : ''}\n    ${f.error}\n`);
    }
    process.stdout.write(`\nDo not run the stakeholder session against this build.\n`);
    return false;
  }

  process.stdout.write(`\nWhat this run did NOT prove, and cannot:\n`);
  process.stdout.write(
    `  • Real sign-in. The scratch environment has no identity provider, so the\n` +
      `    dev shim stood in for it (ADR-012). Google sign-in through Neon Auth is\n` +
      `    verified by signing in, not by this harness.\n`,
  );
  process.stdout.write(
    `  • Object storage. Photo presigning is only exercised when S3_BUCKET is set;\n` +
      `    otherwise the endpoint answers a labeled 503.\n`,
  );
  process.stdout.write(`  • Anything about the deployed environment. This ran locally.\n`);
  return true;
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is required (the scratch database is derived from it)');

  const scratch = scratchName(base);
  const scratchUrl = urlFor(base, scratch);
  const keep = process.env.UAT_KEEP === 'true';

  process.stdout.write(`RouteWrangler automated UAT\n`);
  process.stdout.write(`  scratch database: ${scratch}\n`);

  await recreateScratch(base, scratch);
  let stopApi: (() => void) | null = null;

  try {
    // The compiled migrator, not tsx — the same artifact the deploy runs.
    runNode('migrations', path.join(ROOT, 'apps/api/dist/db/migrate.js'), {
      DATABASE_URL: scratchUrl,
    });
    process.stdout.write(`  migrations applied\n`);

    // In-process, with the scratch URL passed explicitly. Shelling out to the
    // package manager would mean the seed reads DATABASE_URL from whatever the
    // environment happened to hold, which is one stale shell away from
    // rebuilding the developer's own database.
    const { seed } = await import('../../apps/api/seed/seed');
    const world = await seed(scratchUrl, () => {});
    process.stdout.write(`  world seeded (${world.meterCount} meters, ${world.readCount} reads)\n`);

    stopApi = await bootApi(scratchUrl);
    process.stdout.write(`  API listening on ${API_BASE}\n\n`);

    setApiBaseUrl(API_BASE);
    const outcomes = await runScenarios(new Api(API_BASE, null), SCENARIOS);
    const ok = report(outcomes);
    process.exitCode = ok ? 0 : 1;
  } finally {
    stopApi?.();
    if (keep) {
      process.stdout.write(`\n  kept ${scratch} (UAT_KEEP=true)\n`);
    } else {
      await dropScratch(base, scratch);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`\n${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
