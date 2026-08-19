/**
 * Live, GATED, human-attended NAVER **reply-submission** entrypoint (ISOLATED, v2 — MUTATING).
 *
 *   set -a && . ./.env && set +a   # NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npx tsx instruments/live-runs/run-reply-submission-live-naver.ts -- --i-understand-this-posts-a-live-naver-reply
 *
 * The submissionRef and guided hint are NOT passed on argv: they are read from the owner-only, one-shot
 * reply-target bundle that `prepare-reply-target` wrote (`.reply-target/hint.json`), so no secret ever lands
 * in shell history or a process listing. The bundle is single-use and expires at the KST date boundary.
 *
 * The reply-side analogue of `run-action-window-live-naver.ts`, and the ONLY entrypoint that would
 * drive the reply engine over a REAL NAVER page via the read-only `NaverReplySubmitProbeDriver`. It
 * reuses the shared dispatch service (`reply-submission/reply-dispatch.ts`) over an in-process loopback
 * plus a minimal automated operator client — no product FE, no Bridge WS. It issues only run commands
 * (START_RUN → the seller pastes + submits themselves → REQUEST_STEP_RECHECK / SWITCH_TO_MANUAL); it
 * NEVER types into the composer, NEVER clicks submit, and imports no download/ingest path (a reply
 * produces no artifact).
 *
 * MUTATING + LIVE-ONLY — refuses without the reply-specific approval flag, refuses ANY export approval
 * flag (`exportFlagMisuseMessage`), and additionally refuses under `NODE_ENV=production`. Standing
 * state: NAVER live work is PAUSED and a live reply run is gate-locked (D-032: a fresh scope-matched G3
 * + single-use G6 in the dispatching turn). **This program NEVER affirms the flag — building/verifying
 * is offline and hermetic; the gate keeps `main()` from launching anything on a refusal.**
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { currentKstDate } from "../../src/cli/kst-date";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import {
  createLoopbackChannel,
  type AwClientTransport,
} from "../../../contracts/action-window/v2/transport";
import type {
  ActionWindowRunView,
  CommandEnvelope,
  CommandType,
} from "../../../contracts/action-window/v2/index";
import { NaverReplySubmitProbeDriver } from "../../src/action-window/reply-submission/naver-reply-driver";
import type { ReplyRunMode } from "../../src/action-window/reply-submission/reply-stages";
import {
  hintFrom,
  loadResultBundle,
  ReplyTargetBundleError,
  resultBundleRefusalMessage,
  type ReplyTargetResultBundle,
} from "../../src/action-window/reply-submission/reply-target-bundle";
import {
  loadRowMapping,
  ReplyRowMappingError,
  rowMappingRefusalMessage,
  type ReplyRowMapping,
} from "../../src/action-window/reply-submission/reply-row-mapping-artifact";
import { inPagePageSignature, inPageRowFingerprintAt } from "../../src/action-window/reply-submission/reply-row-inpage";
import { compareCrossSource, crossSourceRefusalMessage } from "../../src/action-window/reply-submission/reply-cross-source";
import {
  assembleReplyRun,
  defaultReplyRunDirFor,
  makeReplyRunMarker,
  mintReplyRunId,
  recoverReplyRuns,
} from "../../src/action-window/reply-submission/reply-dispatch";
import type { ReplySubmitSession } from "../../src/action-window/reply-submission/reply-session";
import {
  exportFlagMisuseMessage,
  hasLiveRunApproval,
  hasReplyRunApproval,
  replyApprovalRequiredMessage,
} from "../../src/cli/live-run-approval";

const REPLY_CHANNEL_CODE = "naver";
const ABORT_REHEARSAL_FLAG = "--abort-rehearsal";
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;
const SUBMIT_TIMEOUT_MS = 10 * 60_000;

/** Gitignored, permission-restricted local file the reply-target bundle is read from — NEVER argv. */
const TARGET_HINT_REL_PATH = ".reply-target/hint.json";
/** Gitignored, permission-restricted local file the calibration row-mapping artifact is read from — NEVER argv. */
const ROW_MAPPING_REL_PATH = ".reply-target/row-mapping.json";
/** Exit code: the reply-target bundle is present but invalid / mis-permissioned / expired. */
export const HINT_FILE_REFUSAL_EXIT_CODE = 5;
/** Exit code: the calibration row-mapping artifact is present but invalid / mis-permissioned / drifted / expired. */
export const ROW_MAPPING_REFUSAL_EXIT_CODE = 7;
/** Exit code: the cross-source equality preflight failed (missing live fingerprint / mismatch) — no run started. */
export const CROSS_SOURCE_REFUSAL_EXIT_CODE = 8;

/** Refusal reason for a reply run attempted in a hosted/production environment (defense-in-depth). */
export const REPLY_PRODUCTION_REFUSAL =
  "Refusing to post a live NAVER reply under NODE_ENV=production — this is a dev/operator CLI, never a hosted surface.";

/** Exit code for passing the EXPORT approval flag to the reply CLI (a corrected-model refusal). */
export const EXPORT_FLAG_MISUSE_EXIT_CODE = 6;

/* ────────────────────────────── Gate (pure) ────────────────────────────── */

/**
 * Decide whether a live reply run is refused, and why. Pure: no browser, no config, no I/O — so the
 * gate is unit-testable and `main()` never launches anything on a refusal. `null` = permitted.
 *
 * The export flag is refused FIRST: carrying it at all signals a confused invocation, and it must never
 * be read as reply authorization. Then the reply-approval gate dominates (missing → refused). Both are
 * checked before the production defense-in-depth refusal.
 */
export function replyLiveRunRefusal(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { reason: string; exitCode: number } | null {
  if (hasLiveRunApproval([...args])) return { reason: exportFlagMisuseMessage(), exitCode: EXPORT_FLAG_MISUSE_EXIT_CODE };
  if (!hasReplyRunApproval([...args])) return { reason: replyApprovalRequiredMessage(), exitCode: 3 };
  if (env.NODE_ENV === "production") return { reason: REPLY_PRODUCTION_REFUSAL, exitCode: 4 };
  return null;
}

/** The run mode selected by argv. `--abort-rehearsal` → ABORT_REHEARSAL; otherwise FULL_SUBMIT. */
export function replyRunModeFrom(args: readonly string[]): ReplyRunMode {
  return args.includes(ABORT_REHEARSAL_FLAG) ? "ABORT_REHEARSAL" : "FULL_SUBMIT";
}

/* ─────────────── Reply-target bundle intake (permission-restricted file, never argv) ─────────────── */

/**
 * Today's KST calendar date (`YYYY-MM-DD`) — the ONE wall-clock read in the flow, permitted here at the CLI
 * boundary and never in library code. It is what the result bundle's `asOfDate` is checked against, so a
 * bundle minted on a prior KST day is rejected as EXPIRED.
 *
 * Re-exported from {@link ./kst-date} so another CLI can take the date without importing this whole module.
 */
export { currentKstDate };

/* ─────────────────── Automated operator client (v2) ─────────────────── */

/**
 * Minimal automated operator client on the FE end of the loopback. It stands in for the operator's run
 * controls (START / report / abort) and tracks the latest sanitized View Model. It is NOT the product
 * FE: it never reports a page action (the seller's real submit is observed by the driver) and never
 * touches the page. Command ids carry a `randomUUID()` suffix so no idempotent replay fires.
 */
export class ReplyRunOperatorClient {
  view: ActionWindowRunView | undefined;
  private cmdSeq = 0;

  constructor(
    private readonly transport: AwClientTransport,
    private readonly runId: string,
  ) {
    transport.subscribe((frame) => {
      if (frame.kind === "aw_view") this.view = frame.view;
    });
  }

  send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    this.transport.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: `${this.runId}-c${++this.cmdSeq}-${randomUUID().slice(0, 8)}`,
        runId: this.runId,
        expectedRevision: this.view?.revision ?? 0,
        type,
        ...(payload ? { payload } : {}),
      },
    });
  }
}

/* ────────────────────────────── CLI (live) ────────────────────────────── */

function banner(mode: ReplyRunMode): void {
  const line = "─".repeat(64);
  console.error(line);
  if (mode === "ABORT_REHEARSAL") {
    console.error(" ABORT REHEARSAL — the Runtime CANNOT record a submitted reply in this mode. The submit");
    console.error(" path is disabled end-to-end: no submitted sentinel exists, and the engine rejects any");
    console.error(" 'I posted it' report, so the ONLY terminal is SUBMISSION_ABORTED (UNVERIFIED). It");
    console.error(" highlights read-only and OBSERVES. Requires a bound guided target hint file.");
  } else {
    console.error(" LIVE NAVER reply submission — explicit per-run approval required (MUTATING).");
    console.error(" A human pastes and POSTS an approved reply themselves; the Runtime only foregrounds,");
    console.error(" highlights the composer read-only, and OBSERVES. No typing, no submit-click, no");
    console.error(" download, no ingest. The outcome is operator-reported and UNVERIFIED — never 완료.");
  }
  console.error(line);
}

function replyPrompt(mode: ReplyRunMode, submittedSentinel: string | null, abortedSentinel: string): string {
  if (mode === "ABORT_REHEARSAL") {
    return [
      "",
      "ABORT REHEARSAL — a browser window is open on NAVER. In that SAME window:",
      "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
      "  2) Reach the target; the collector highlights it read-only. DO NOT post anything.",
      "",
      "This mode can ONLY end as SUBMISSION_ABORTED. Report you are done by creating:",
      `  - aborted → ${abortedSentinel}`,
      "There is NO submitted sentinel — posting cannot be reported and is not authorized here.",
      "(Ctrl-C also aborts.)",
      "",
    ].join("\n");
  }
  return [
    "",
    "A browser window is open on NAVER. In that SAME window:",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "  2) Reach the review whose reply you approved; the collector highlights the reply composer.",
    "  3) PASTE the approved reply yourself and POST it. The Runtime never types or submits.",
    "",
    "Then report the outcome by creating ONE sentinel file:",
    `  - posted it   → ${submittedSentinel}`,
    `  - did NOT post → ${abortedSentinel}`,
    "",
    "SellerOps does NOT verify the reply landed (no read-back). The result is recorded as",
    "operator-reported + UNVERIFIED. A retry needs a freshly minted submissionRef.",
    "(Ctrl-C to abort.)",
    "",
  ].join("\n");
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** Consume the single-use guided hint file (best-effort) so a hint can never be reused across runs. */
function consumeTargetHintFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll for either report sentinel. Returns which the operator created, or null on timeout. */
async function waitForReport(
  submitted: string,
  aborted: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<"submitted" | "aborted" | null> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(submitted)) return "submitted";
    if (existsSync(aborted)) return "aborted";
    await sleep(intervalMs);
  }
  return null;
}

/** Injectable probes so the abort watcher is unit-testable offline without disk or real timers. */
export interface AbortWatchDeps {
  existsSync: (p: string) => boolean;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_ABORT_WATCH_DEPS: AbortWatchDeps = { existsSync, sleep };

/**
 * ABORT_REHEARSAL abort watcher — armed from process start. Polls ONLY the aborted sentinel (the submitted
 * one is never even created in this mode) and, on appearance while the run is still non-terminal, sends the
 * abort. Returns once it fired an abort, the run reached a terminal on its own, or the window lapsed.
 *
 * <p>Terminal is checked BEFORE the sentinel each iteration: a run that already terminated on its own
 * (e.g. fail-closed) is never handed a late abort — there is nothing left to abort.
 */
export async function watchForAbort(
  aborted: string,
  timeoutMs: number,
  intervalMs: number,
  sendAbort: () => void,
  isTerminal: () => boolean,
  deps: AbortWatchDeps = DEFAULT_ABORT_WATCH_DEPS,
): Promise<"aborted" | "terminal" | null> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (isTerminal()) return "terminal";
    if (deps.existsSync(aborted)) {
      sendAbort();
      return "aborted";
    }
    await deps.sleep(intervalMs);
  }
  return null;
}

const TERMINAL_STATUSES = new Set(["OPERATOR_REPORTED", "FAILED", "CANCELLED"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = replyRunModeFrom(args);
  banner(mode);
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

  // The reply-target bundle is the ONLY source of the submissionRef and guided hint — read ONCE from a
  // permission-restricted gitignored file (never argv/stdout), rejected as EXPIRED once its KST as-of date is
  // no longer today, then CONSUMED (single-use). Absent → refuse (run prepare-reply-target first). Because a
  // valid bundle always carries a hint, every run here is GUIDED (both FULL_SUBMIT and ABORT_REHEARSAL).
  const bundlePath = resolve(collectorRoot, TARGET_HINT_REL_PATH);
  let bundle: ReplyTargetResultBundle | null;
  try {
    bundle = loadResultBundle(bundlePath, { existsSync, statSync, readFileSync }, currentKstDate());
  } catch (e) {
    if (e instanceof ReplyTargetBundleError) {
      console.error(resultBundleRefusalMessage(e.code, bundlePath));
      consumeTargetHintFile(bundlePath);
      process.exit(HINT_FILE_REFUSAL_EXIT_CODE);
      return;
    }
    throw e;
  }
  if (!bundle) {
    console.error(
      `No reply-target bundle at ${bundlePath}. Run prepare-reply-target first to mint a submissionRef and write it.`,
    );
    process.exit(2);
    return;
  }
  consumeTargetHintFile(bundlePath); // single-use: never reusable across runs
  const submissionRef = bundle.submissionRef;
  const targetHint = hintFrom(bundle);

  const persistDir = defaultReplyRunDirFor(collectorRoot);
  // Park any interrupted prior reply run before starting a fresh one — never resume/re-drive a submit.
  const { parked } = recoverReplyRuns(persistDir, makeReplyRunMarker());
  if (parked.length > 0) log("aw.reply.parked", { count: parked.length });
  const statusDir = dirname(cfg.statusFile);
  // ABORT_REHEARSAL never even computes/creates/removes/polls the submitted sentinel — it stays null.
  const submittedSentinel = mode === "FULL_SUBMIT" ? resolve(statusDir, "reply-submitted.ready") : null;
  const abortedSentinel = resolve(statusDir, "reply-aborted.ready");
  mkdirSync(statusDir, { recursive: true });
  if (submittedSentinel) removeSentinel(submittedSentinel);
  removeSentinel(abortedSentinel);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  let session: ReplySubmitSession | undefined;
  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    // ── Operator readiness (read-only; no run assembled yet) ──────────────────────────────────────────
    // Reproduce the SAME filtered review-list view the calibration was captured against (same date range /
    // rating filter / sort so the target review is visible), staying on the LIST, then signal ready — so the
    // page-signature + mapping + cross-source checks below run against the matching view, not the raw landing.
    const replyReadySentinel = resolve(statusDir, "reply-ready.ready");
    removeSentinel(replyReadySentinel);
    console.error(
      [
        "",
        "Reproduce the SAME review-list view the calibration used (same filters / date range / sort so the",
        "target review row is visible), staying ON THE LIST. Do NOT click into the review.",
        `Then create this file to continue:  ${replyReadySentinel}`,
        "",
      ].join("\n"),
    );
    let ready = false;
    for (let i = 0; i < Math.ceil(CONFIRM_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
      if (existsSync(replyReadySentinel)) { ready = true; break; }
      await sleep(SENTINEL_POLL_INTERVAL_MS);
    }
    removeSentinel(replyReadySentinel);
    if (!ready) {
      console.error("No readiness signal within the window; ending without a run.");
      process.exitCode = 2;
      return;
    }
    // Re-acquire the ACTIVE page (the operator may have navigated / opened a tab while filtering).
    const openPages = ctx.pages();
    if (openPages.length === 0) {
      console.error("The browser page was closed before the run could start — retry with the window open.");
      process.exitCode = 2;
      return;
    }
    const activePage = openPages[openPages.length - 1] as Page;

    // Playwright's Page.evaluate accepts a string at runtime; the sanitized in-page snippets are strings, so
    // cast to the string-evaluate surface the reply driver already relies on (mirrors discover-reply-target).
    const evalStr = (activePage as unknown as { evaluate<R>(script: string): Promise<R> }).evaluate.bind(activePage);

    // ── Escalation checkpoint (3): cross-source preflight, BEFORE any run is assembled ──────────────
    // The operator calibrated the target row (relative-DOM paths) in the read-only Phase A; that artifact is
    // page-bound (structural signature) + short-lived (expiry). Load + validate it against the LIVE page, then
    // fingerprint the calibrated row in-page and require equality with the bundle's backend fingerprint. Any
    // failure refuses here — the mutating rehearsal never starts against an unconfirmed/ drifted target.
    const mappingPath = resolve(collectorRoot, ROW_MAPPING_REL_PATH);
    const livePageSignature = await evalStr<string>(inPagePageSignature());
    let mapping: ReplyRowMapping | null;
    try {
      mapping = loadRowMapping(mappingPath, { existsSync, statSync, readFileSync }, Date.now(), livePageSignature);
    } catch (e) {
      if (e instanceof ReplyRowMappingError) {
        console.error(rowMappingRefusalMessage(e.code, mappingPath));
        consumeTargetHintFile(mappingPath);
        process.exitCode = ROW_MAPPING_REFUSAL_EXIT_CODE;
        return;
      }
      throw e;
    }
    if (!mapping) {
      console.error(
        `No calibration artifact at ${mappingPath}. Run calibrate-reply-target on the live review list first (Phase A).`,
      );
      process.exitCode = 2;
      return;
    }
    consumeTargetHintFile(mappingPath); // single-use: never reusable across runs (defense atop page-binding + expiry)

    const liveRowFingerprint = await evalStr<string | null>(
      inPageRowFingerprintAt({ parentPath: mapping.parentPath, rowTag: mapping.rowTag, rowIndex: mapping.rowIndex, bodyPath: mapping.bodyPath }),
    );
    const crossSource = compareCrossSource(liveRowFingerprint, bundle.bodyFingerprint);
    if (mode === "ABORT_REHEARSAL") {
      // Row-match abort rehearsal: the operator designated + visually confirms the row and never submits, so
      // cross-source is recorded as EVIDENCE only (NAVER body-to-stored-body reconciliation, B1, is still open) —
      // it NEVER blocks a non-mutating abort. A live post (FULL_SUBMIT) keeps the hard gate in the else branch.
      log("aw.reply.crossSource.evidence", { confirmed: crossSource.ok, code: crossSource.ok ? "MATCH" : crossSource.code });
      console.error(
        crossSource.ok
          ? "Cross-source EVIDENCE: the live body fingerprint MATCHES the backend for this target."
          : `Cross-source EVIDENCE: NOT confirmed (${crossSource.code}) — recorded; the non-mutating abort proceeds anyway.`,
      );
    } else {
      if (!crossSource.ok) {
        console.error(crossSourceRefusalMessage(crossSource.code));
        log("aw.reply.crossSource.refused", { code: crossSource.code });
        process.exitCode = CROSS_SOURCE_REFUSAL_EXIT_CODE;
        return;
      }
      log("aw.reply.crossSource.confirmed", {});
    }

    const runId = mintReplyRunId();
    const channel = createLoopbackChannel();
    const assembly = assembleReplyRun(channel.server, {
      runId,
      channelCode: REPLY_CHANNEL_CODE,
      submissionRef,
      ...(targetHint ? { targetHint } : {}),
      mode,
      createDriver: (hint) =>
        new NaverReplySubmitProbeDriver(activePage, {
          submitTimeoutMs: SUBMIT_TIMEOUT_MS,
          rowOpenTimeoutMs: SUBMIT_TIMEOUT_MS,
          ...(hint ? { hint } : {}),
          mapping: mapping!,
          asOfDate: bundle.asOfDate,
          // Abort rehearsal trusts the operator-designated row (B1 open); a live post matches on the hint.
          locateMode: mode === "ABORT_REHEARSAL" ? "calibrated" : "match",
        }),
      persistDir,
    });
    session = assembly.session;
    session.attach();
    const client = new ReplyRunOperatorClient(channel.client, runId);
    const isTerminal = () => TERMINAL_STATUSES.has(client.view?.status ?? "");

    if (mode === "ABORT_REHEARSAL") {
      // Abort is monitored from PROCESS START — arm the watcher concurrently with the auto-drive, so an
      // operator abort at ANY non-terminal stage yields SUBMISSION_ABORTED rather than racing into FAILED.
      const abortWatch = watchForAbort(
        abortedSentinel,
        CONFIRM_TIMEOUT_MS,
        SENTINEL_POLL_INTERVAL_MS,
        () => client.send("SWITCH_TO_MANUAL"),
        isTerminal,
      );
      client.send("START_RUN", { channelCode: REPLY_CHANNEL_CODE, intent: "REPLY_SUBMISSION", submissionRef });
      await assembly.session.whenSettled();
      if (!isTerminal()) console.error(replyPrompt(mode, null, abortedSentinel));
      const outcome = await abortWatch;
      if (outcome === "aborted") {
        await assembly.session.whenSettled();
      } else if (outcome === null) {
        console.error("No abort within the window; ending without recording an outcome.");
        log("aw.reply.aborted", { reason: "abort-window-lapsed" });
      }
    } else {
      client.send("START_RUN", { channelCode: REPLY_CHANNEL_CODE, intent: "REPLY_SUBMISSION", submissionRef });
      await assembly.session.whenSettled();

      console.error(replyPrompt(mode, submittedSentinel, abortedSentinel));
      const report = await waitForReport(submittedSentinel!, abortedSentinel, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
      if (!report) {
        console.error("No operator report within the timeout; aborting without recording an outcome.");
        log("aw.reply.aborted", { reason: "report-timeout" });
        return;
      }
      // REQUEST_STEP_RECHECK = "I posted it" → OPERATOR_REPORTED_SUBMITTED; SWITCH_TO_MANUAL = "I did not".
      client.send(report === "submitted" ? "REQUEST_STEP_RECHECK" : "SWITCH_TO_MANUAL");
      await assembly.session.whenSettled();
    }

    const view = client.view;
    console.log(JSON.stringify({ status: view?.status, progress: view?.progress, channelCode: view?.channelCode }, null, 2));
    log("aw.reply.run", { status: view?.status });
  } finally {
    // The session drives the driver's read-only teardown on a terminal outcome; closing the context
    // disposes any still-armed observer/annotation if the run never reached terminal (report timeout).
    void session;
    if (submittedSentinel) removeSentinel(submittedSentinel);
    removeSentinel(abortedSentinel);
    await ctx.close();
  }
}

// Run ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
