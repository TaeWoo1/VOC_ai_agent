/**
 * **Headed synthetic Action Window QA harness (R1) — DIAGNOSTIC ONLY, NOT product UX.**
 *
 * Opens the LOCAL synthetic fixture in a real headed browser, shows the overlay, and waits for the
 * OPERATOR to click the target (the Runtime never clicks). After the observed click it re-checks,
 * verifies, runs the dummy downstream step, and prints the sanitized view + events.
 *
 * No marketplace, no credentials, no persistent profile, no downloads, no status/DB writes.
 * Run: `npx tsx src/cli/action-window-fixture.ts [normal|unchanged|no-candidate|multi-candidate|replaced|session-required]`
 */
import { chromium } from "playwright";
import { ActionWindowEngine } from "../action-window/engine";
import { runSyntheticLoop } from "../action-window/harness";
import type { FixtureMode } from "../action-window/fixture";

const MODES: readonly FixtureMode[] = ["normal", "unchanged", "no-candidate", "multi-candidate", "replaced", "session-required"];

async function main(): Promise<void> {
  const arg = process.argv[2] ?? "normal";
  const mode = (MODES as readonly string[]).includes(arg) ? (arg as FixtureMode) : "normal";
  // eslint-disable-next-line no-console
  console.log(`[action-window-fixture] DIAGNOSTIC ONLY — local synthetic fixture (mode=${mode}). Not product UX. Click the highlighted target when it appears.`);

  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    const engine = new ActionWindowEngine({ runId: "qa_run", channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
    const result = await runSyntheticLoop(page, engine, { mode, observeTimeoutMs: 120_000, guidanceEnabled: true });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ finalStage: result.finalStage, observed: result.observed, downstream: result.downstream, view: result.view, events: result.events }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
