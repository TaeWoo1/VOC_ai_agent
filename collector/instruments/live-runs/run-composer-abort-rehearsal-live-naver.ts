/**
 * Live, GATED, human-attended NAVER **same-session COMPOSER ABORT REHEARSAL** (ISOLATED, v2 — MUTATING-scope,
 * but NON-MUTATING BY CONSTRUCTION: the operator never submits, so the only terminal is SUBMISSION_ABORTED).
 *
 *   set -a && . ./.env && set +a
 *   npx tsx instruments/live-runs/run-composer-abort-rehearsal-live-naver.ts -- --i-understand-this-posts-a-live-naver-reply
 *
 * The composer extension of the row abort rehearsal. In ONE browser process the operator:
 *   1. filters the review list so the target is visible (stays on the list),
 *   2. clicks the target review body once — intercepted (nothing fires on NAVER); the runtime retains THAT
 *      exact element and highlights the review row read-only,
 *   3. performs their OWN entry into the composer — either clicking the review-body link (→ a detail page,
 *      a navigation) OR checking the row + clicking the toolbar reply action (→ an inline composer). The
 *      runtime OBSERVES the resulting transition (new tab / same-tab navigation / inline composer appearing)
 *      and re-acquires the active page,
 *   4. clicks the reply composer once — intercepted; the runtime retains THAT element, highlights it read-only,
 *      and shows the seller's OWN approved draft in a separate SellerOps read-only overlay,
 *   5. visually confirms and ABORTS — before any text is entered or submitted.
 *
 * The Runtime NEVER clicks/types/pastes/submits a NAVER control and NEVER navigates: it captures the operator's
 * own clicks (preventDefault), outlines the retained elements read-only, shows the approved draft read-only, and
 * observes. There is no persisted mapping, no whole-page signature, and no reload — a dynamic SPA cannot drift
 * a retained element between capture and highlight; if one detaches, the run fails closed and the operator
 * re-calibrates in the same session. Refuses without the reply approval flag, refuses any export flag, and
 * refuses under NODE_ENV=production.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import { createLoopbackChannel } from "../../../contracts/action-window/v2/transport";
import { login, startReplySubmissionRun, submitReplyOutcome, fetchApprovedReplyDraft } from "../../src/upload";
import { loadRequestBundle } from "../../src/action-window/reply-submission/reply-target-bundle";
import type { RecencyBucket } from "../../src/action-window/reply-submission/reply-surface";
import { HandleReplyComposerDriver } from "../../src/action-window/reply-submission/handle-reply-composer-driver";
import type { AbortRowHandle } from "../../src/action-window/reply-submission/handle-reply-row-driver";
import {
  ARM_COMPOSER_CAPTURE,
  COMPOSER_CENSUS,
  COMPOSER_PICKED,
  COMPOSER_TEARDOWN,
  renderDraftOverlay,
} from "../../src/action-window/reply-submission/reply-composer-inpage";
import {
  assembleReplyRun,
  defaultReplyRunDirFor,
  makeReplyRunMarker,
  mintReplyRunId,
  recoverReplyRuns,
} from "../../src/action-window/reply-submission/reply-dispatch";
import type { ReplySubmitSession } from "../../src/action-window/reply-submission/reply-session";
import type { ReplyStage } from "../../src/action-window/reply-submission/reply-stages";
import { ReplyRunOperatorClient, replyLiveRunRefusal, watchForAbort } from "./run-reply-submission-live-naver";

const REPLY_CHANNEL_CODE = "naver";
const REQUEST_BUNDLE_REL_PATH = ".reply-target/request.json";
const CONFIRM_TIMEOUT_MS = 15 * 60_000;
const PICK_TIMEOUT_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 15 * 60_000;
const ENTRY_TIMEOUT_MS = 15 * 60_000;
const SUBMIT_WAIT_TIMEOUT_MS = 15 * 60_000;
const BARRIER_TIMEOUT_MS = 45 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

const TERMINAL_STATUSES = new Set(["OPERATOR_REPORTED", "FAILED", "CANCELLED"]);

/** Row-anchor capture: the operator's next click marks (but does not activate) the target review row. */
const ARM_ROW_CAPTURE = `(() => {
  window.__awAbortPicked = false;
  var prev = document.querySelector('[data-aw-abort-anchor]');
  if (prev) { prev.removeAttribute('data-aw-abort-anchor'); }
  var banner = document.getElementById('__aw_abort_banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '__aw_abort_banner';
    banner.setAttribute('aria-hidden', 'true');
    banner.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483600;pointer-events:none;background:#111;color:#fff;font:14px system-ui;padding:8px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
    banner.textContent = 'SellerOps composer abort 리허설 — 대상 리뷰 본문을 한 번 클릭하세요';
    document.body.appendChild(banner);
  }
  var handler = function (ev) {
    if (!ev.target || (ev.target.id === '__aw_abort_banner')) { return; }
    ev.preventDefault(); ev.stopImmediatePropagation();
    ev.target.setAttribute('data-aw-abort-anchor', '1');
    window.__awAbortPicked = true;
    banner.textContent = 'SellerOps composer abort 리허설 — 리뷰 행 지정됨. 하이라이트 확인 후 입력창으로 진입하세요';
    document.removeEventListener('click', handler, true);
  };
  window.__awAbortHandler = handler;
  document.addEventListener('click', handler, true);
  return true;
})()`;

const ROW_PICKED = `(() => window.__awAbortPicked === true)()`;
const ROW_TEARDOWN = `(() => {
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

export type TransitionKind = "NAV_NEW_TAB" | "NAV_SAME_TAB" | "INLINE_COMPOSER";

function sleep(ms: number): Promise<void> {
  // unref'd: a lingering poll loop (e.g. the composer-acquire loop still running when the operator aborts at
  // the row barrier) must never keep the process alive after the run has settled and the context has closed.
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    if (typeof t.unref === "function") t.unref();
  });
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
function evalOn<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

/**
 * Observe the operator's own entry transition into the composer, without ever navigating or clicking:
 *  - a new tab appears (body-link opened in a new page),
 *  - the active tab's URL changes (body-link same-tab navigation), or
 *  - a generic composer candidate appears inline (checkbox + toolbar reply — count rises over the baseline).
 * Returns the observed kind, or null on timeout.
 */
export async function waitForEntryTransition(
  ctx: BrowserContext,
  listUrl: string,
  baselinePages: number,
  baselineCensus: number,
  timeoutMs: number,
  pollIntervalMs: number = SENTINEL_POLL_INTERVAL_MS,
): Promise<TransitionKind | null> {
  for (let i = 0; i < Math.ceil(timeoutMs / pollIntervalMs); i += 1) {
    const pages = ctx.pages();
    if (pages.length > baselinePages) return "NAV_NEW_TAB";
    const ap = pages[pages.length - 1] as Page | undefined;
    if (ap) {
      let url = "";
      try {
        url = ap.url();
      } catch {
        /* page transitioning */
      }
      if (url && url !== listUrl && url !== "about:blank") return "NAV_SAME_TAB";
      let census = baselineCensus;
      try {
        census = await evalOn<number>(ap, COMPOSER_CENSUS);
      } catch {
        /* page mid-navigation — retry next tick */
      }
      if (census > baselineCensus) return "INLINE_COMPOSER";
    }
    await sleep(pollIntervalMs);
  }
  return null;
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" SAME-SESSION COMPOSER ABORT REHEARSAL — one browser, no reload, no persisted mapping. The");
  console.error(" operator picks the target row, performs their OWN entry (body-link nav OR checkbox+toolbar),");
  console.error(" then picks the composer; the runtime observes the transition, highlights the composer read-only,");
  console.error(" shows the approved draft read-only, and the operator ABORTS. The ONLY terminal is");
  console.error(" SUBMISSION_ABORTED (UNVERIFIED). No submit, no type, no paste, no navigation by the runtime.");
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
  let session: ReplySubmitSession | undefined;
  let activePage: Page = page; // re-pointed to the operator's active tab after readiness and after entry
  let observedTransition: TransitionKind | null = null;
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

    // 2) Row calibration: capture the operator's clicked target row as a retained element handle.
    await evalOn<boolean>(activePage, ARM_ROW_CAPTURE);
    console.error("Now CLICK the target review's body ONCE (intercepted — nothing fires on NAVER)…");
    let picked = false;
    for (let i = 0; i < Math.ceil(PICK_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
      if (await evalOn<boolean>(activePage, ROW_PICKED)) {
        picked = true;
        break;
      }
      await sleep(SENTINEL_POLL_INTERVAL_MS);
    }
    if (!picked) {
      console.error("No target row picked within the window; ending without a run.");
      process.exitCode = 2;
      return;
    }
    const rowHandle = (await activePage.$("[data-aw-abort-anchor]")) as unknown as AbortRowHandle | null;
    if (!rowHandle) {
      console.error("Could not retain the picked row — it may have detached; re-run to re-calibrate.");
      process.exitCode = 2;
      return;
    }
    if (!(await rowHandle.evaluate((el) => !!(el && (el as { isConnected?: boolean }).isConnected)))) {
      console.error("The picked row is not connected (DOM re-rendered); re-run to re-calibrate.");
      process.exitCode = 2;
      return;
    }

    // 3) Mint a fresh one-shot bundle AFTER calibration (in memory — no persisted result bundle).
    const token = await login(cfg.baseUrl, cfg.email, cfg.password);
    const run = await startReplySubmissionRun(cfg.baseUrl, token, request.accountId, request.actionRef, {
      requireTargetHint: true,
    });
    if (!run.targetHint) {
      console.error("Backend returned no target hint for this review; cannot rehearse.");
      process.exitCode = 2;
      return;
    }
    log("aw.reply.composer-abort.minted", {});

    // 4) The composer acquisition the driver runs at the row-open barrier: observe the operator's entry,
    //    re-acquire the active page, arm the composer capture, and retain the operator's clicked composer.
    const acquireComposer = async (): Promise<AbortRowHandle | null> => {
      console.error(
        [
          "",
          "The target review ROW is highlighted read-only (blue). Now perform your OWN entry into the composer:",
          "  • click the review body/link (opens the detail page), OR",
          "  • check the row's checkbox and click the toolbar reply action (opens an inline composer).",
          "(The runtime does NOT click or navigate — you do. It only observes the transition.)",
          "",
        ].join("\n"),
      );
      const listUrl = activePage.url();
      const baselinePages = ctx.pages().length;
      let baselineCensus = 0;
      try {
        baselineCensus = await evalOn<number>(activePage, COMPOSER_CENSUS);
      } catch {
        /* ignore */
      }
      const transition = await waitForEntryTransition(ctx, listUrl, baselinePages, baselineCensus, ENTRY_TIMEOUT_MS);
      if (!transition) {
        console.error("No entry transition observed within the window; the composer barrier will not open.");
        return null;
      }
      observedTransition = transition;
      const pages = ctx.pages();
      if (pages.length === 0) return null;
      activePage = pages[pages.length - 1] as Page;
      try {
        await activePage.waitForLoadState("domcontentloaded");
      } catch {
        /* best-effort settle */
      }
      console.error(`Entry observed (${transition}). Now CLICK the reply composer ONCE (intercepted — no input)…`);
      await evalOn<boolean>(activePage, ARM_COMPOSER_CAPTURE);
      let composerPicked = false;
      for (let i = 0; i < Math.ceil(PICK_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
        if (await evalOn<boolean>(activePage, COMPOSER_PICKED)) {
          composerPicked = true;
          break;
        }
        await sleep(SENTINEL_POLL_INTERVAL_MS);
      }
      if (!composerPicked) {
        console.error("No composer picked within the window; the composer barrier will not open.");
        return null;
      }
      const handle = (await activePage.$("[data-aw-composer-anchor]")) as unknown as AbortRowHandle | null;
      if (!handle) {
        console.error("Could not retain the picked composer — it may have detached; abort and re-run.");
        return null;
      }
      return handle;
    };

    // The operator aborts at the composer barrier, so this only needs to keep waiting; unref the timer so a
    // terminated run lets the process exit immediately instead of lingering until the timeout fires.
    const waitSubmit = () =>
      new Promise<boolean>((r) => {
        const t = setTimeout(() => r(false), SUBMIT_WAIT_TIMEOUT_MS);
        if (typeof t.unref === "function") t.unref();
      });

    // 5) Drive the engine: locate row → highlight row → (operator entry + composer capture) → locate composer
    //    → highlight composer → composer submit barrier, where the operator ABORTS.
    const runId = mintReplyRunId();
    const channel = createLoopbackChannel();
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
      createDriver: () => new HandleReplyComposerDriver(rowHandle, acquireComposer, waitSubmit),
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

    // Wait until the composer barrier is reached (composer highlighted) or the run terminates (e.g. the
    // operator aborted at the row barrier). Polling the engine stage — the row-open barrier resolves the
    // first whenSettled long before the composer is located.
    const stageReached = async (target: ReplyStage): Promise<void> => {
      for (let i = 0; i < Math.ceil(BARRIER_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
        if (isTerminal() || assembly.engine.currentStage() === target) return;
        await sleep(SENTINEL_POLL_INTERVAL_MS);
      }
    };
    await stageReached("WAIT_FOR_SUBMIT");

    if (!isTerminal() && assembly.engine.currentStage() === "WAIT_FOR_SUBMIT") {
      // The composer is highlighted read-only (green). Show the operator's OWN approved draft, read-only.
      try {
        const draft = await fetchApprovedReplyDraft(cfg.baseUrl, token, request.accountId, request.actionRef);
        if (draft.approved && draft.draftBody) {
          await evalOn<boolean>(activePage, renderDraftOverlay(draft.draftBody));
          console.error("Approved draft is shown read-only (bottom-right SellerOps panel). Do NOT paste it.");
        } else {
          console.error("No approved draft body to display; proceeding to abort confirmation.");
        }
      } catch (e) {
        console.error(`Could not load the approved draft for display: ${e instanceof Error ? e.message : String(e)}.`);
      }
      console.error(
        [
          "",
          "The reply COMPOSER is HIGHLIGHTED read-only (green outline). CONFIRM it is where your approved reply",
          "would go. Do NOT type, paste, or submit anything. To ABORT:",
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
      log("aw.reply.composer-abort.window-lapsed", {});
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
          entryTransition: observedTransition,
          reachedComposerBarrier: assembly.engine.currentStage() === "WAIT_FOR_SUBMIT" || operatorOutcome != null,
          progress: view?.progress,
          channelCode: view?.channelCode,
          runId,
        },
        null,
        2,
      ),
    );
    log("aw.reply.composer-abort.run", { status: view?.status, entry: observedTransition ?? "none" });

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
    // Entry may have opened a new tab, so the row banner/outline can live on a different page than the
    // composer's — tear both down on every open page (best-effort; the context close removes them anyway).
    for (const p of ctx.pages()) {
      await evalOn<boolean>(p as Page, ROW_TEARDOWN).catch(() => undefined);
      await evalOn<boolean>(p as Page, COMPOSER_TEARDOWN).catch(() => undefined);
    }
    void session;
    removeSentinel(readySentinel);
    removeSentinel(abortedSentinel);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
