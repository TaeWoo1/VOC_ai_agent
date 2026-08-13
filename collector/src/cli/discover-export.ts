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
import type { BrowserContext, Page } from "playwright";
import { loadConfig, type CollectorConfig } from "../config";
import { log } from "../log";
import { planExportAction } from "../naver/export-classify";
import { haltForVerdict } from "../naver/session-halt";
import { checkLiveSessionVerdict } from "../naver/session-check";
import { waitForSpaHydration } from "../naver/hydration";
import { runExport } from "../naver/review-export";
import type { SessionVerdict } from "../naver/session-verdict";
import { launchNaverContext, type PwPage } from "../profile";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import { actionBarrierRefusedMessage, barrierRefusedRecord, confirmActionBarrier } from "./operator-action-barrier";
import { collectSanitizedStorage } from "../naver/storage-collect";
import { decideState, writeStatus, type RunSignals } from "../status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../upload";
import { approvalRequiredMessage, hasLiveRunApproval, isClassifyOnly } from "./live-run-approval";
import { classifyOnlyStatusFromPlan } from "./same-session";

/** Optional cold STORAGE diagnostic (State B); valid ONLY with --classify-only. */
const DIAGNOSE_STORAGE_FLAG = "--diagnose-storage";

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

/**
 * Optional cold STORAGE diagnostic (State B) — emit a NO-CLICK sanitized storage
 * snapshot of the current cold context, on ANY verdict: the LOGGED_IN classify-only
 * path OR a halt verdict (e.g. RECONNECT_REQUIRED / ACCOUNT_LOGIN_REQUIRED). Storage
 * exists on the cold page regardless of the session verdict, so this lets State B be
 * diffed against State A even when the cold run halts before classify.
 *
 * No-op unless requested; requires `cfg.storageProbeSalt` (validated earlier in
 * `doDiscover`, re-checked defensively here). It only READS storage metadata via the
 * pure sanitizer — never clicks, never writes status, never uploads, never captures.
 * On a collection error it logs ONLY a coarse sanitized reason — never a raw stack,
 * URL, key, value, host, token, or HTML.
 */
async function emitColdStorageDiagnosticIfRequested(
  page: Page,
  ctx: BrowserContext,
  cfg: CollectorConfig,
  diagnoseStorage: boolean,
): Promise<void> {
  if (!diagnoseStorage || !cfg.storageProbeSalt) return;
  try {
    const signals = await collectSanitizedStorage(page, ctx, {
      contextLabel: "B_cold",
      salt: cfg.storageProbeSalt,
    });
    console.log(JSON.stringify(signals, null, 2));
    log("diagnose.storage.no-click", { contextLabel: signals.contextLabel, groupCount: signals.groups.length });
  } catch {
    // Coarse + sanitized — the underlying error could embed a URL/selector, so never echo it.
    log("diagnose.storage.failed", { reason: "storage-read-error" });
  }
}

async function doDiscover(classifyOnly: boolean, diagnoseStorage: boolean): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management/export page URL first.");
    process.exit(2);
    return;
  }
  // The cold STORAGE diagnostic is a NO-CLICK read; it is allowed only on the
  // classify-only path and never during full capture, and it fails closed without
  // the shared salt (so its hashes line up with the same-session State A leg).
  if (diagnoseStorage) {
    if (!classifyOnly) {
      console.error(`${DIAGNOSE_STORAGE_FLAG} is only valid with --classify-only (never during capture).`);
      process.exit(2);
      return;
    }
    if (!cfg.storageProbeSalt) {
      console.error(
        "Refusing to run the storage diagnostic without STORAGE_PROBE_SALT.\n" +
          "  - Set the SAME STORAGE_PROBE_SALT as the same-session (State A) leg.\n" +
          "  - It is used only for one-way hashing and is never printed or stored.",
      );
      process.exit(2);
      return;
    }
  }
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation surface, opened before anything is read so the operator's own page stays the entry page.
  // Nothing waits on it unless this run reaches an ACT — the classify-only leg never does.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, { aborted: () => false });
  const page = confirmHost.entryPage as unknown as PwPage;
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
    // Cold STORAGE diagnostic (State B) on a NON-LOGGED_IN verdict (e.g.
    // RECONNECT_REQUIRED): storage exists on the cold page regardless of the verdict,
    // so emit the sanitized snapshot BEFORE closing — this is precisely the cold state
    // we want to diff against State A. No-op unless --diagnose-storage was requested.
    // The halt status itself stays honest and unchanged (never LAST_SUCCESS).
    await emitColdStorageDiagnosticIfRequested(page as unknown as Page, ctx, cfg, diagnoseStorage);
    writeStatus(cfg.statusFile, { state: halt.state, detail: halt.detail, updatedAt: now() });
    await ctx.close();
    log("run.halted", { state: halt.state, diagnoseStorage });
    return;
  }

  // 2) LOGGED_IN — branch by mode. Classify-only is strictly NO-CLICK (it never
  //    calls runExport); the full path is the ONLY one that triggers/captures.
  if (classifyOnly) return doDiscoverClassifyOnly(page, verdict, ctx, cfg, now, diagnoseStorage);
  // **THE ACTION BARRIER.** Everything above is reading — a navigation this run performed itself and a
  // sanitized verdict. What follows triggers the marketplace's own export, puts a file on this machine and
  // ingests it into a database, and the flag that selected this leg says what the operator INTENDED when they
  // typed the command, not that a person looked at the page it is now about to act on.
  const allowed = await confirmActionBarrier(confirmHost, {
    kind: "EXPORT_TRIGGER",
    title: "리뷰 내보내기 (전체 캡처)",
    headline: "지금 화면의 내보내기 컨트롤을 SellerOps가 한 번 눌러도 될까요?",
    allows: [
      "화면에서 하나로 확인된 내보내기 컨트롤을 정확히 한 번 누릅니다.",
      "그 결과로 내려받아진 파일 하나를 이 컴퓨터에 저장합니다.",
      "저장된 파일을 SellerOps 백엔드로 업로드합니다 (리뷰 데이터가 DB에 적재됩니다).",
      "그 결과를 수집 상태 기록에 남깁니다.",
    ],
    stillWillNot: "다른 컨트롤을 누르거나, 화면의 값을 읽거나, 다른 곳으로 무엇도 보내지 않습니다.",
  });
  if (!allowed) {
    // NO status is written, deliberately. Every `CollectorState` describes something that happened to a
    // collection attempt, and nothing happened here — the run stopped before it acted. Reaching for the
    // nearest-looking state would put a claim in the status file that no run supports.
    console.error(actionBarrierRefusedMessage("EXPORT_TRIGGER"));
    console.log(barrierRefusedRecord("EXPORT_TRIGGER"));
    await ctx.close();
    log("run.halted", { reason: "no-operator-confirmation" });
    process.exitCode = 7;
    return;
  }
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
  diagnoseStorage: boolean,
): Promise<void> {
  const html = await page.content();
  const plan = planExportAction(html);
  const { state, detail } = classifyOnlyStatusFromPlan(verdict, plan);
  writeStatus(cfg.statusFile, { state, detail, updatedAt: now() });

  // Optional cold STORAGE diagnostic (State B) on the LOGGED_IN classify-only path —
  // same no-click sanitized read, printed alongside the verdict. Default behaviour
  // (flag absent) is byte-for-byte unchanged.
  await emitColdStorageDiagnosticIfRequested(page as unknown as Page, ctx, cfg, diagnoseStorage);

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
    // This file is a seller-center export the collector captured itself, not a human upload.
    const result = await uploadReviewFile(cfg.baseUrl, token, channelId, filePath, fetch,
      "SELLER_CENTER_EXPORT");
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
  return doDiscover(isClassifyOnly(args), args.includes(DIAGNOSE_STORAGE_FLAG));
}

void main();
