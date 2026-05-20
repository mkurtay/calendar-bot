// CLI entry for the auto-updater. Invoked by the GitHub Actions cron
// workflow: `tsx packages/server/src/auto-update/cli.ts`.
//
// Reads tokens from env (GH_TOKEN, FOOTBALL_DATA_TOKEN, optional
// GITHUB_OWNER/REPO/BRANCH overrides), runs the update across all
// tracked calendars, prints a summary, and exits non-zero only if
// EVERY calendar errored (partial success is still success — one bad
// competition shouldn't fail the whole run).

import { depsFromEnv, runAutoUpdate } from "./run.js";

async function main(): Promise<void> {
  const deps = depsFromEnv();
  const summaries = await runAutoUpdate(deps);

  let totalUpdated = 0;
  let errors = 0;
  for (const s of summaries) {
    if (s.skipped) {
      errors++;
      console.error(`✗ ${s.calendarId}: ${s.skipped}`);
    } else if (s.updated > 0) {
      totalUpdated += s.updated;
      console.log(`✓ ${s.calendarId}: ${s.updated} result(s) committed${s.commitUrl ? ` → ${s.commitUrl}` : ""}`);
    } else {
      console.log(`· ${s.calendarId}: no new results`);
    }
  }
  console.log(`\nDone. ${totalUpdated} result(s) across ${summaries.length} calendar(s), ${errors} error(s).`);

  // Only fail the workflow if everything errored — partial success is OK.
  if (errors > 0 && errors === summaries.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("auto-update fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
