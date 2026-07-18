import { runPlayback, type PlaybackConfig } from './playback';

/**
 * Playback CLI (BUILD_SPEC §7.6 demo). Env:
 *   API_BASE_URL       default http://localhost:3001
 *   SIM_READER_SUB     dev-bypass sub (default local-only:reader1)
 *   SIM_BEARER_TOKEN   real Cognito token (prod alternative)
 *   SIM_RUN_ID         specific run (default: first open run)
 */
async function main() {
  const cfg: PlaybackConfig = {
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3001',
    readerSub: process.env.SIM_BEARER_TOKEN ? undefined : process.env.SIM_READER_SUB ?? 'local-only:reader1',
    bearerToken: process.env.SIM_BEARER_TOKEN,
    runId: process.env.SIM_RUN_ID,
  };

  console.log(`▶ playback against ${cfg.apiBaseUrl}`);
  const summary = await runPlayback(cfg);

  console.log(`\nRun ${summary.runId}`);
  console.log(
    `Batch: ${summary.batch.accepted} accepted, ${summary.batch.duplicates} duplicate, ${summary.batch.rejected} rejected`,
  );
  const withExceptions = summary.batch.results.filter((r) => (r.exceptions?.length ?? 0) > 0);
  for (const r of withExceptions) {
    console.log(`  • ${r.id.slice(0, 8)} → ${r.exceptions!.join(', ')} (billable=${r.billable})`);
  }
  if (summary.duplicate) {
    const d = summary.duplicate.results[0];
    console.log(`Duplicate re-read: ${d?.exceptions?.join(', ') ?? 'none'}`);
  }
  console.log('\n✓ pipeline exercised end to end — no UI.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
