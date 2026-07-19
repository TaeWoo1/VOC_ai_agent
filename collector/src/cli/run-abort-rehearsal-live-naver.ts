/**
 * Live, GATED, human-attended NAVER **same-session ABORT REHEARSAL** (ISOLATED, v2 — MUTATING-scope, but
 * NON-MUTATING BY CONSTRUCTION: the operator never submits, so the only terminal is SUBMISSION_ABORTED).
 *
 *   set -a && . ./.env && set +a
 *   npx tsx src/cli/run-abort-rehearsal-live-naver.ts -- --i-understand-this-posts-a-live-naver-reply
 *
 * The robust, same-session alternative to the persisted-mapping reply run: in ONE browser process the operator
 * filters the list and clicks the target review body once; the runtime retains THAT exact live element as an
 * in-memory handle, mints a fresh one-shot submissionRef, immediately highlights the same connected element
 * read-only, asks the operator to confirm, and aborts. There is NO persisted mapping artifact, NO whole-page
 * signature, and NO reload/restart — so a dynamic SPA cannot drift the target between capture and highlight. If
 * the element detaches / the DOM re-renders it away, the run fails closed (TARGET_NOT_FOUND) and the operator
 * re-runs to re-calibrate in the same browser session.
 *
 * The Runtime NEVER clicks/types/submits a NAVER control and NEVER navigates: it captures the operator's own
 * click (preventDefault), outlines the retained element, observes, and reports. Refuses without the reply
 * approval flag, refuses any export flag, and refuses under NODE_ENV=production. Building/verifying is hermetic.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { createLoopbackChannel } from "../../../contracts/action-window/v2/transport";
import { login, startReplySubmissionRun, submitReplyOutcome } from "../upload";
import { loadRequestBundle } from "../action-window/reply-submission/reply-target-bundle";
import type { RecencyBucket } from "../action-window/reply-submission/reply-surface";
import { HandleReplyRowDriver, type AbortRowHandle } from "../action-window/reply-submission/handle-reply-row-driver";
import {
  assembleReplyRun,
  defaultReplyRunDirFor,
  makeReplyRunMarker,
  mintReplyRunId,
  recoverReplyRuns,
} from "../action-window/reply-submission/reply-dispatch";
import type { ReplySubmitSession } from "../action-window/reply-submission/reply-session";
import { ReplyRunOperatorClient, replyLiveRunRefusal, watchForAbort } from "./run-reply-submission-live-naver";

const REPLY_CHANNEL_CODE = "naver";
const REQUEST_BUNDLE_REL_PATH = ".reply-target/request.json";
const CONFIRM_TIMEOUT_MS = 15 * 60_000;
const PICK_TIMEOUT_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 15 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;
const ROW_OPEN_TIMEOUT_MS = 15 * 60_000;

const TERMINAL_STATUSES = new Set(["OPERATOR_REPORTED", "FAILED", "CANCELLED"]);

/** Arm a capture-phase listener: the operator's next click is intercepted (no NAVER action), and the EXACT
 *  clicked element is marked as the retained ANCHOR (the driver resolves the review row from it for the highlight). */
const ARM_ABORT_CAPTURE = `(() => {
  window.__awAbortPicked = false;
  var prev = document.querySelector('[data-aw-abort-anchor]');
  if (prev) { prev.removeAttribute('data-aw-abort-anchor'); }
  var banner = document.getElementById('__aw_abort_banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '__aw_abort_banner';
    banner.setAttribute('aria-hidden', 'true');
    banner.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483600;pointer-events:none;background:#111;color:#fff;font:14px system-ui;padding:8px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
    banner.textContent = 'SellerOps abort 리허설 — 대상 리뷰 본문을 한 번 클릭하세요';
    document.body.appendChild(banner);
  }
  var handler = function (ev) {
    if (!ev.target || (ev.target.id === '__aw_abort_banner')) { return; }
    ev.preventDefault(); ev.stopImmediatePropagation();
    ev.target.setAttribute('data-aw-abort-anchor', '1');
    window.__awAbortPicked = true;
    banner.textContent = 'SellerOps abort 리허설 — 대상 지정됨. 하이라이트된 리뷰 행 확인 후 abort 하세요';
    document.removeEventListener('click', handler, true);
  };
  window.__awAbortHandler = handler;
  document.addEventListener('click', handler, true);
  return true;
})()`;

const ABORT_PICKED = `(() => window.__awAbortPicked === true)()`;
const ABORT_TEARDOWN = `(() => {
  var b = document.getElementById('__aw_abort_banner');
  if (b && b.parentNode) { b.parentNode.removeChild(b); }
  if (window.__awAbortHandler) { document.removeEventListener('click', window.__awAbortHandler, true); }
  var a = document.querySelector('[data-aw-abort-anchor]');
  if (a) { a.removeAttribute('data-aw-abort-anchor'); }
  var h = document.querySelector('[data-aw-abort-highlight]');
  if (h) { h.removeAttribute('data-aw-abort-highlight'); if (h.style) { h.style.outline = ''; h.style.outlineOffset = ''; } }
  try { delete window.__awAbortPicked; delete window.__awAbortHandler; } catch (e) { window.__awAbortPicked = undefined; }
  return true;
})()`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  for (let i = 0; i < Math.max(1, Math.ceil(timeoutMs / SENTINEL_POLL_INTERVAL_MS)); i += 1) {
    if (existsSync(path)) return true;
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return false;
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" SAME-SESSION ABORT REHEARSAL — one browser, no reload, no persisted mapping. The operator picks");
  console.error(" the target review by clicking it once (intercepted — nothing fires on NAVER); the runtime retains");
  console.error(" that exact element, mints a one-shot submissionRef, highlights it read-only, and the operator");
  console.error(" ABORTS. The ONLY terminal is SUBMISSION_ABORTED (UNVERIFIED). No submit, no navigation.");
  console.error(line);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  const refusal = replyLiveRunRefusal(args, process.env);
  if (refusal) {
    console.error(refusal.reason);
    process.exit(refusal.exitCode);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management page URL first.");
    process.exit(2);
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const requestPath = resolve(collectorRoot, REQUEST_BUNDLE_REL_PATH);
  const request = loadRequestBundle(requestPath, { existsSync, statSync, readFileSync });
  if (!request) {
    console.error(`No request bundle at ${requestPath} — create it {accountId, actionRef} (0600) first.`);
    process.exit(2);
    return;
  }

  const persistDir = defaultReplyRunDirFor(collectorRoot);
  const { parked } = recoverReplyRuns(persistDir, makeReplyRunMarker());
  if (parked.length > 0) log("aw.reply.parked", { count: parked.length });

  const statusDir = dirname(cfg.statusFile);
  const readySentinel = resolve(statusDir, "reply-ready.ready");
  const abortedSentinel = resolve(statusDir, "reply-aborted.ready");
  mkdirSync(statusDir, { recursive: true });
  removeSentinel(readySentinel);
  removeSentinel(abortedSentinel);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  const bindEval = (p: Page) => (p as unknown as { evaluate<R>(script: string): Promise<R> }).evaluate.bind(p);
  let session: ReplySubmitSession | undefined;
  let activePage: Page = page; // re-pointed to the operator's active tab after readiness; used by teardown too
  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // 1) Operator readiness: reproduce the filtered review list (target visible), staying on the LIST.
    console.error(
      [
        "",
        "In the open browser: reach the review list and FILTER so the target review row is visible.",
        "Stay ON THE LIST — do NOT click into the review yet.",
        `When the target is visible, create:  ${readySentinel}`,
        "",
      ].join("\n"),
    );
    if (!(await waitForFile(readySentinel, READY_TIMEOUT_MS))) {
      console.error("No readiness signal; ending without a run.");
      process.exitCode = 2;
      return;
    }
    removeSentinel(readySentinel);
    const openPages = ctx.pages();
    if (openPages.length === 0) {
      console.error("The browser page was closed — retry with the window open.");
      process.exitCode = 2;
      return;
    }
    activePage = openPages[openPages.length - 1] as Page;
    const evalStr = bindEval(activePage);

    // 2) Same-session calibration: capture the operator's clicked target row as a retained element handle.
    await evalStr<boolean>(ARM_ABORT_CAPTURE);
    console.error("Now CLICK the target review's body ONCE (intercepted — nothing fires on NAVER)…");
    let picked = false;
    for (let i = 0; i < Math.ceil(PICK_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
      if (await evalStr<boolean>(ABORT_PICKED)) { picked = true; break; }
      await sleep(SENTINEL_POLL_INTERVAL_MS);
    }
    if (!picked) {
      console.error("No target picked within the window; ending without a run.");
      process.exitCode = 2;
      return;
    }
    const handle = (await activePage.$("[data-aw-abort-anchor]")) as unknown as AbortRowHandle | null;
    if (!handle) {
      console.error("Could not retain the picked element — it may have detached; re-run to re-calibrate.");
      process.exitCode = 2;
      return;
    }
    const connected = await handle.evaluate((el) => !!(el && (el as { isConnected?: boolean }).isConnected));
    if (!connected) {
      console.error("The picked element is not connected (DOM re-rendered); re-run to re-calibrate.");
      process.exitCode = 2;
      return;
    }

    // 3) Mint a fresh one-shot bundle AFTER calibration (in memory — no persisted result bundle).
    const token = await login(cfg.baseUrl, cfg.email, cfg.password);
    const run = await startReplySubmissionRun(cfg.baseUrl, token, request.accountId, request.actionRef, { requireTargetHint: true });
    if (!run.targetHint) {
      console.error("Backend returned no target hint for this review; cannot rehearse.");
      process.exitCode = 2;
      return;
    }
    log("aw.reply.abort.minted", {});

    // 4) Drive the engine over the retained-element handle: locate (still connected) → highlight → row barrier.
    const runId = mintReplyRunId();
    const channel = createLoopbackChannel();
    // The operator aborts at the barrier, so this only needs to keep waiting; unref the timer so a terminated
    // run lets the process exit immediately instead of lingering until the timeout fires.
    const waitRowOpen = () =>
      new Promise<boolean>((r) => {
        const t = setTimeout(() => r(false), ROW_OPEN_TIMEOUT_MS);
        if (typeof t.unref === "function") t.unref();
      });
    const assembly = assembleReplyRun(channel.server, {
      runId,
      channelCode: REPLY_CHANNEL_CODE,
      submissionRef: run.submissionRef,
      targetHint: {
        rating: run.targetHint.rating,
        recencyBucket: run.targetHint.recencyBucket as RecencyBucket,
        bodyFingerprint: run.targetHint.bodyFingerprint,
      },
      mode: "ABORT_REHEARSAL",
      createDriver: () => new HandleReplyRowDriver(handle, waitRowOpen),
      persistDir,
    });
    session = assembly.session;
    session.attach();
    const client = new ReplyRunOperatorClient(channel.client, runId);
    const isTerminal = () => TERMINAL_STATUSES.has(client.view?.status ?? "");

    const abortWatch = watchForAbort(
      abortedSentinel,
      CONFIRM_TIMEOUT_MS,
      SENTINEL_POLL_INTERVAL_MS,
      () => client.send("SWITCH_TO_MANUAL"),
      isTerminal,
    );
    client.send("START_RUN", { channelCode: REPLY_CHANNEL_CODE, intent: "REPLY_SUBMISSION", submissionRef: run.submissionRef });
    await assembly.session.whenSettled();

    if (!isTerminal()) {
      console.error(
        [
          "",
          "The target row is now HIGHLIGHTED read-only (blue outline). CONFIRM it is the approved review.",
          "If correct, ABORT (do NOT click the body / checkbox / toolbar, do NOT open the composer):",
          `  - aborted → ${abortedSentinel}`,
          "This mode can ONLY end as SUBMISSION_ABORTED. (Ctrl-C also aborts.)",
          "",
        ].join("\n"),
      );
    }
    const outcome = await abortWatch;
    if (outcome === "aborted") {
      await assembly.session.whenSettled();
    } else if (outcome === null) {
      console.error("No abort within the window; ending without recording an outcome.");
      log("aw.reply.abort.window-lapsed", {});
    }

    const view = client.view;
    const reported = assembly.engine.events().find((e) => e.type === "SUBMISSION_REPORTED");
    const operatorOutcome = (reported?.payload as { operatorOutcome?: string } | undefined)?.operatorOutcome;
    console.log(
      JSON.stringify(
        {
          status: view?.status,
          operatorOutcome,
          verification: (reported?.payload as { verification?: string } | undefined)?.verification,
          progress: view?.progress,
          channelCode: view?.channelCode,
          runId,
        },
        null,
        2,
      ),
    );
    log("aw.reply.abort.run", { status: view?.status });

    // Record the operator-reported outcome on the backend (LOCAL, UNVERIFIED fact) — idempotent by commandId.
    if (operatorOutcome) {
      try {
        const rec = await submitReplyOutcome(cfg.baseUrl, token, request.accountId, request.actionRef, {
          commandId: `outcome-${runId}`,
          submissionRef: run.submissionRef,
          operatorOutcome,
          awRunRef: runId,
        });
        console.error(`Backend outcome recorded (recorded=${rec.recorded}, replayed=${rec.replayed}).`);
      } catch (e) {
        console.error(`Could not record the outcome on the backend: ${e instanceof Error ? e.message : String(e)}.`);
      }
    }
  } finally {
    await bindEval(activePage)(ABORT_TEARDOWN).catch(() => undefined);
    void session;
    removeSentinel(readySentinel);
    removeSentinel(abortedSentinel);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
