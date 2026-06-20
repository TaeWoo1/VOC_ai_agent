/**
 * Live NAVER review-export discovery — one human-attended run (NO scheduler loop).
 *
 *   node --env-file=.env src/cli/discover-export.ts --login    --i-understand-this-opens-live-naver
 *   node --env-file=.env src/cli/discover-export.ts --discover --classify-only --i-understand-this-opens-live-naver
 *
 * Milestone-1 uses --classify-only (alias --no-upload): it classifies the export
 * mechanism without uploading to SellerOps (no backend needed, LAST_SUCCESS
 * impossible). That branch is strictly NO-CLICK — it decides the export layout
 * from the rendered structure via the pure `planExportAction`, never clicking the
 * control, never waiting for a download, capturing nothing. Bare --discover
 * (without --classify-only) runs the full capture→upload path (the only path that
 * triggers/captures the export, via `runExport`) and requires the local backend.
 *
 * LIVE RUN — requires explicit, per-run operator approval. The CLI refuses every
 * live action unless the approval flag is present. It launches a real browser
 * against NAVER seller-center. A human performs the login and any 2FA/CAPTCHA;
 * the collector never types credentials, never bypasses auth, and never writes
 * to NAVER. Do NOT run during planning/implementation.
 */
import type { BrowserContext } from "playwright";
import { loadConfig, type CollectorConfig } from "../config";
import { log } from "../log";
import { planExportAction } from "../naver/export-classify";
import { haltForVerdict } from "../naver/session-halt";
import { checkLiveSessionVerdict } from "../naver/session-check";
import { waitForSpaHydration } from "../naver/hydration";
import { runExport } from "../naver/review-export";
import type { SessionVerdict } from "../naver/session-verdict";
import { launchNaverContext, type PwPage } from "../profile";
import { decideState, writeStatus, type RunSignals } from "../status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../upload";
import { approvalRequiredMessage, hasLiveRunApproval, isClassifyOnly } from "./live-run-approval";
import { classifyOnlyStatusFromPlan } from "./same-session";

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
  const now = (): string => new Date().toISOString();

  // 1) Session check — the five-state verdict is the authority. Never proceed on
  //    anything but LOGGED_IN; each other verdict halts with an honest state + detail
  //    (RECONNECT_REQUIRED / ACCOUNT_LOGIN_REQUIRED / 2FA action / conservative expiry).
  //    The review route is an SPA, so give it a bounded chance to hydrate before reading
  //    the verdict — a cold programmatic navigation otherwise reads UNKNOWN before the
  //    logged-in signals render. The wait is READ-ONLY and never changes the verdict.
  await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
  const hydration = await waitForSpaHydration(page);
  log("session.hydration", { result: hydration });
  const verdict = await checkLiveSessionVerdict(page);
  const halt = haltForVerdict(verdict);
  if (!halt.proceed) {
    writeStatus(cfg.statusFile, { state: halt.state, detail: halt.detail, updatedAt: now() });
    await ctx.close();
    log("run.halted", { state: halt.state });
    return;
  }

  // 2) LOGGED_IN — branch by mode. Classify-only is strictly NO-CLICK (it never
  //    calls runExport); the full path is the ONLY one that triggers/captures.
  if (classifyOnly) return doDiscoverClassifyOnly(page, verdict, ctx, cfg, now);
  return doDiscoverFullCapture(page, ctx, cfg, now);
}

/**
 * Classify-only (milestone-1 discovery) — STRICT NO-CLICK. Decide the export layout
 * from the rendered structure via the pure `planExportAction` and record it; never
 * call `runExport`, never click the control, never wait for a download, capture or
 * persist nothing, no SellerOps login/channel/upload. A recognized sync layout reads
 * EXPORT_SYNC_DETECTED (mechanism detected, NOT triggered) — never COLLECTING/
 * LAST_SUCCESS. Reached only after a LOGGED_IN verdict, so `verdict` is LOGGED_IN.
 */
async function doDiscoverClassifyOnly(
  page: PwPage,
  verdict: SessionVerdict,
  ctx: BrowserContext,
  cfg: CollectorConfig,
  now: () => string,
): Promise<void> {
  const html = await page.content();
  const plan = planExportAction(html);
  const { state, detail } = classifyOnlyStatusFromPlan(verdict, plan);
  writeStatus(cfg.statusFile, { state, detail, updatedAt: now() });
  await ctx.close();
  log("run.done", {
    state,
    layout: plan.layout,
    hasActionableExportCandidate: plan.hasActionableExportCandidate,
    asyncMarkerPresent: plan.asyncMarkerPresent,
    classifyOnly: true,
    noClick: true,
  });
}

/**
 * Full capture → upload path (bare --discover). This is the ONLY path that triggers
 * and captures the export: `runExport` clicks the control, waits for the download,
 * and persists the file (saveAs), then uploads it through the existing offline-core
 * client. Requires the local backend. Reached only when !classifyOnly.
 */
async function doDiscoverFullCapture(
  page: PwPage,
  ctx: BrowserContext,
  cfg: CollectorConfig,
  now: () => string,
): Promise<void> {
  const base: RunSignals = { paired: true, session: "LOGGED_IN" };

  // 2) Export discovery — classify sync/async/blocked and capture only if sync.
  const { outcome, filePath } = await runExport(page, cfg.downloadDir, { classifyOnly: false });

  if (outcome !== "CAPTURED" || !filePath) {
    const state = decideState({ ...base, exportOutcome: outcome });
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
  const state = decideState({ ...base, exportOutcome: "CAPTURED", uploadOutcome });
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
