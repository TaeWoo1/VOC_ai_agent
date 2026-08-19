/**
 * Offline manual check (NO live NAVER): hand a local review .xlsx straight to the
 * SellerOps upload path the live collector will use, and record a status. This
 * exercises login → channel resolve → upload → dedup/item-analysis end to end
 * against a local backend, without any browser automation.
 *
 *   node --env-file=.env src/cli/upload-file.ts <path-to-review.xlsx>
 *   # or: npm run upload -- <path-to-review.xlsx>
 */
import { loadConfig } from "../config";
import { log } from "../log";
import { decideState, writeStatus, type RunSignals } from "../status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../upload";
import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("usage: tsx src/cli/upload-file.ts <path-to-review.xlsx>");
    process.exit(2);
    return;
  }

  const cfg = loadConfig();
  // The CLI stands in for a successful in-session capture: paired + logged in +
  // a file already in hand. Only the upload outcome varies.
  const base: RunSignals = { paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED" };

  try {
    const token = await login(cfg.baseUrl, cfg.email, cfg.password);
    const channelId = await resolveChannelId(cfg.baseUrl, token, cfg.naverChannelCode);
    const result = await uploadReviewFile(cfg.baseUrl, token, channelId, filePath);
    const now = new Date().toISOString();
    const state = decideState({ ...base, uploadOutcome: "OK" });
    writeStatus(cfg.statusFile, {
      state,
      detail: `inserted ${result.successRows}, skipped ${result.skippedRows}, failed ${result.failedRows}`,
      lastCollectedAt: now,
      updatedAt: now,
    });
    log("run.done", { state, successRows: result.successRows, skippedRows: result.skippedRows });
  } catch (error) {
    const stage = error instanceof UploadError ? error.stage : "unknown";
    const state = decideState({ ...base, uploadOutcome: "FAILED" });
    writeStatus(cfg.statusFile, {
      state,
      detail: `failed at ${stage}`,
      updatedAt: new Date().toISOString(),
    });
    log("run.failed", { state, stage }, "error");
    process.exit(1);
  }
}

// Run only when executed directly, NEVER on import — importing must have no side effects.
// Before R2 this called `main()` at module top level, so merely importing the file (a test, a tooling
// script, an editor's auto-import) ran the whole entrypoint, argv parse and all.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}