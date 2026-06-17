/**
 * Live NAVER review-export discovery — one human-attended run (NO scheduler loop).
 *
 *   node --env-file=.env src/cli/discover-export.ts --login    --i-understand-this-opens-live-naver
 *   node --env-file=.env src/cli/discover-export.ts --discover --classify-only --i-understand-this-opens-live-naver
 *
 * Milestone-1 uses --classify-only (alias --no-upload): it classifies the export
 * mechanism without uploading to SellerOps (no backend needed, LAST_SUCCESS
 * impossible). Bare --discover (without --classify-only) runs the full
 * capture→upload path and requires the local backend.
 *
 * LIVE RUN — requires explicit, per-run operator approval. The CLI refuses every
 * live action unless the approval flag is present. It launches a real browser
 * against NAVER seller-center. A human performs the login and any 2FA/CAPTCHA;
 * the collector never types credentials, never bypasses auth, and never writes
 * to NAVER. Do NOT run during planning/implementation.
 */
import { loadConfig } from "../config";
import { log } from "../log";
import { checkLiveSession } from "../naver/session-check";
import { runExport } from "../naver/review-export";
import { launchNaverContext, type PwPage } from "../profile";
import { decideState, writeStatus, type RunSignals, type SessionState } from "../status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../upload";
import { approvalRequiredMessage, hasLiveRunApproval, isClassifyOnly } from "./live-run-approval";

// PLACEHOLDER landing URL; the human navigates/logs in from here.
const NAVER_LANDING_URL = "https://sell.smartstore.naver.com/";

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER discovery — requires explicit per-run operator approval.");
  console.error(" A human logs in; the collector never types NAVER credentials,");
  console.error(" never bypasses auth, and never writes to NAVER. Ctrl-C to abort.");
  console.error(line);
}

async function doLogin(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as unknown as PwPage;
  await page.goto(NAVER_LANDING_URL, { waitUntil: "domcontentloaded" });
  log("login.prompt", { note: "human-login-required" });
  console.error("Log in (and clear any 2FA/CAPTCHA) in the opened window, then close it.");
  // Intentionally left open: the human finishes; the session persists to the
  // profile dir automatically. The collector stores nothing itself.
}

async function doDiscover(classifyOnly: boolean): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management/export page URL first.");
    process.exit(2);
    return;
  }
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as unknown as PwPage;
  const base: RunSignals = { paired: true, session: "LOGGED_OUT" };
  const now = (): string => new Date().toISOString();

  // 1) Session check — never proceed on an ambiguous/invalid session.
  await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
  const session: SessionState = await checkLiveSession(page);
  if (session !== "LOGGED_IN") {
    const state = decideState({ ...base, session });
    writeStatus(cfg.statusFile, { state, detail: "session not usable; reconnect required", updatedAt: now() });
    await ctx.close();
    log("run.halted", { state });
    return;
  }

  // 2) Export discovery — classify sync/async/blocked and capture only if sync.
  const { outcome, filePath } = await runExport(page, cfg.downloadDir, { classifyOnly });

  // Classify-only (milestone-1 discovery): record the mechanism and STOP. No
  // SellerOps login, no channel resolve, no upload — so LAST_SUCCESS is
  // impossible (a CAPTURED sync export maps to COLLECTING, never success). No
  // real file was persisted (runExport skipped saveAs).
  if (classifyOnly) {
    const state = decideState({ ...base, session, exportOutcome: outcome });
    const detail =
      outcome === "CAPTURED"
        ? "classify-only: sync export detected; not captured to disk, not uploaded"
        : `classify-only: export outcome ${outcome}`;
    writeStatus(cfg.statusFile, { state, detail, updatedAt: now() });
    await ctx.close();
    log("run.done", { state, outcome, classifyOnly: true });
    return;
  }

  if (outcome !== "CAPTURED" || !filePath) {
    const state = decideState({ ...base, session, exportOutcome: outcome });
    writeStatus(cfg.statusFile, { state, detail: `export outcome: ${outcome}`, updatedAt: now() });
    await ctx.close();
    log("run.done", { state, outcome });
    return;
  }

  // 3) Sync capture → upload through the existing offline-core client (no new path).
  let uploadOutcome: "OK" | "FAILED" = "OK";
  let detail = "";
  try {
    const token = await login(cfg.baseUrl, cfg.email, cfg.password);
    const channelId = await resolveChannelId(cfg.baseUrl, token, cfg.naverChannelCode);
    const result = await uploadReviewFile(cfg.baseUrl, token, channelId, filePath);
    detail = `inserted ${result.successRows}, skipped ${result.skippedRows}, failed ${result.failedRows}`;
  } catch (error) {
    uploadOutcome = "FAILED";
    detail = `upload failed at ${error instanceof UploadError ? error.stage : "unknown"}`;
  }
  const state = decideState({ ...base, session, exportOutcome: "CAPTURED", uploadOutcome });
  writeStatus(cfg.statusFile, {
    state,
    detail,
    lastCollectedAt: uploadOutcome === "OK" ? now() : undefined,
    updatedAt: now(),
  });
  await ctx.close();
  log("run.done", { state });
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  const mode = args[0];
  if (mode !== "--login" && mode !== "--discover") {
    console.error("usage: discover-export.ts (--login | --discover) --i-understand-this-opens-live-naver");
    process.exit(2);
    return;
  }
  // Hard gate: never take a live action without the explicit per-run approval flag.
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exit(3);
    return;
  }
  if (mode === "--login") return doLogin();
  return doDiscover(isClassifyOnly(args));
}

void main();
