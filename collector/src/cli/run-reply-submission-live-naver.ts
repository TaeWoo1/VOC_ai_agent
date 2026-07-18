/**
 * Live, GATED, human-attended NAVER **reply-submission** entrypoint (ISOLATED, v2 — MUTATING).
 *
 *   set -a && . ./.env && set +a   # NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npx tsx src/cli/run-reply-submission-live-naver.ts -- \
 *     --submission-ref <16hex> --i-understand-this-posts-a-live-naver-reply
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
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  createLoopbackChannel,
  type AwClientTransport,
} from "../../../contracts/action-window/v2/transport";
import type {
  ActionWindowRunView,
  CommandEnvelope,
  CommandType,
} from "../../../contracts/action-window/v2/index";
import { NaverReplySubmitProbeDriver } from "../action-window/reply-submission/naver-reply-driver";
import type { RecencyBucket, ReplyTargetHint } from "../action-window/reply-submission/reply-surface";
import type { ReplyRunMode } from "../action-window/reply-submission/reply-stages";
import {
  assembleReplyRun,
  defaultReplyRunDirFor,
  makeReplyRunMarker,
  mintReplyRunId,
  recoverReplyRuns,
} from "../action-window/reply-submission/reply-dispatch";
import type { ReplySubmitSession } from "../action-window/reply-submission/reply-session";
import {
  exportFlagMisuseMessage,
  hasLiveRunApproval,
  hasReplyRunApproval,
  replyApprovalRequiredMessage,
} from "./live-run-approval";

const REPLY_CHANNEL_CODE = "naver";
const SUBMISSION_REF_FLAG = "--submission-ref";
const ABORT_REHEARSAL_FLAG = "--abort-rehearsal";
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;
const SUBMIT_TIMEOUT_MS = 10 * 60_000;

/** Gitignored, permission-restricted local file the guided target hint is read from — NEVER argv. */
const TARGET_HINT_REL_PATH = ".reply-target/hint.json";
/** Exit code: the guided hint file is present but invalid / mis-permissioned / not bound to this run. */
export const HINT_FILE_REFUSAL_EXIT_CODE = 5;
/** Exit code: ABORT_REHEARSAL was requested without a valid guided hint (no legacy fallback). */
export const ABORT_REHEARSAL_REQUIRES_HINT_EXIT_CODE = 7;

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

/** Extract + validate the `--submission-ref <16hex>` binding. Returns null if absent/malformed. */
export function submissionRefFrom(args: readonly string[]): string | null {
  const i = args.indexOf(SUBMISSION_REF_FLAG);
  const raw = i >= 0 ? args[i + 1] : undefined;
  return raw && /^[0-9a-f]{16}$/.test(raw) ? raw : null;
}

/** The run mode selected by argv. `--abort-rehearsal` → ABORT_REHEARSAL; otherwise FULL_SUBMIT. */
export function replyRunModeFrom(args: readonly string[]): ReplyRunMode {
  return args.includes(ABORT_REHEARSAL_FLAG) ? "ABORT_REHEARSAL" : "FULL_SUBMIT";
}

/* ─────────────── Guided target hint intake (permission-restricted file, never argv) ─────────────── */

export type TargetHintErrorCode = "PERMS" | "MALFORMED" | "SCHEMA" | "BIND_MISMATCH";

export class TargetHintError extends Error {
  constructor(readonly code: TargetHintErrorCode) {
    super(code);
    this.name = "TargetHintError";
  }
}

/** Injectable fs surface so the loader is unit-testable offline without touching disk. */
export interface HintFileDeps {
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { mode: number };
  readFileSync: (p: string, enc: "utf8") => string;
}

const RECENCY_BUCKETS: readonly RecencyBucket[] = ["TODAY", "THIS_WEEK", "OLDER"];

/**
 * Read the guided target hint from a permission-restricted, gitignored local FILE — never argv/env, so it
 * never lands in shell history or a process listing. Fails closed (throws {@link TargetHintError}) if the
 * file is group/world-readable, malformed, fails schema validation, or its `submissionRef` binding does not
 * equal this run's. Returns `null` when the file is absent (a legacy composer-only run in FULL_SUBMIT). The
 * returned hint carries ONLY the three privacy-safe match fields — the binding `submissionRef` never
 * reaches the engine or driver.
 */
export function loadTargetHint(
  path: string,
  expectedSubmissionRef: string,
  deps: HintFileDeps,
): ReplyTargetHint | null {
  if (!deps.existsSync(path)) return null;
  // Owner-only perms: refuse if any group/world bit is set. Defense against a hint another local process
  // could have planted or read.
  if ((deps.statSync(path).mode & 0o077) !== 0) throw new TargetHintError("PERMS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFileSync(path, "utf8"));
  } catch {
    throw new TargetHintError("MALFORMED");
  }
  if (typeof parsed !== "object" || parsed === null) throw new TargetHintError("MALFORMED");
  const r = parsed as Record<string, unknown>;
  // Bound to THIS run's submissionRef — a stale/foreign hint is refused, not silently used.
  if (typeof r.submissionRef !== "string" || r.submissionRef !== expectedSubmissionRef) {
    throw new TargetHintError("BIND_MISMATCH");
  }
  const rating = r.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new TargetHintError("SCHEMA");
  }
  if (typeof r.recencyBucket !== "string" || !RECENCY_BUCKETS.includes(r.recencyBucket as RecencyBucket)) {
    throw new TargetHintError("SCHEMA");
  }
  if (typeof r.bodyFingerprint !== "string" || r.bodyFingerprint.length === 0 || r.bodyFingerprint.length > 128) {
    throw new TargetHintError("SCHEMA");
  }
  return { rating, recencyBucket: r.recencyBucket as RecencyBucket, bodyFingerprint: r.bodyFingerprint };
}

/** Operator-facing refusal for a present-but-unusable guided hint file (no field VALUE is ever printed). */
export function targetHintRefusalMessage(code: TargetHintErrorCode, path: string): string {
  const why: Record<TargetHintErrorCode, string> = {
    PERMS: "the file is group/world-readable — re-create it owner-only (chmod 600)",
    MALFORMED: "the file is not valid JSON",
    SCHEMA: "the file fails schema validation (rating 1..5, recencyBucket, bodyFingerprint)",
    BIND_MISMATCH: "the file's submissionRef does not match this run's --submission-ref",
  };
  return [
    `Refusing: the guided target hint at ${path} is unusable — ${why[code]}.`,
    "  - Target metadata is read ONLY from this permission-restricted, gitignored file — never argv/env.",
    "  - Re-mint a fresh submissionRef and re-create a bound, owner-only hint file, then retry.",
  ].join("\n");
}

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

  const submissionRef = submissionRefFrom(args);
  if (!submissionRef) {
    console.error(`Pass ${SUBMISSION_REF_FLAG} <16-hex> — the single-use binding minted by the backend.`);
    process.exit(2);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management page URL first.");
    process.exit(2);
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

  // Guided target hint — read ONCE from a permission-restricted gitignored file (never argv), bound to
  // this submissionRef, then CONSUMED (single-use). Absent → legacy composer-only in FULL_SUBMIT.
  const hintPath = resolve(collectorRoot, TARGET_HINT_REL_PATH);
  let targetHint: ReplyTargetHint | null = null;
  try {
    targetHint = loadTargetHint(hintPath, submissionRef, { existsSync, statSync, readFileSync });
  } catch (e) {
    if (e instanceof TargetHintError) {
      console.error(targetHintRefusalMessage(e.code, hintPath));
      consumeTargetHintFile(hintPath);
      process.exit(HINT_FILE_REFUSAL_EXIT_CODE);
      return;
    }
    throw e;
  }
  consumeTargetHintFile(hintPath); // single-use: never reusable across runs
  if (mode === "ABORT_REHEARSAL" && !targetHint) {
    console.error(
      [
        "Refusing: ABORT_REHEARSAL is guided-only and requires a valid target hint bound to this",
        `submissionRef at ${hintPath} — it never falls back to the legacy composer-only path.`,
      ].join("\n"),
    );
    process.exit(ABORT_REHEARSAL_REQUIRES_HINT_EXIT_CODE);
    return;
  }

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

    const runId = mintReplyRunId();
    const channel = createLoopbackChannel();
    const assembly = assembleReplyRun(channel.server, {
      runId,
      channelCode: REPLY_CHANNEL_CODE,
      submissionRef,
      ...(targetHint ? { targetHint } : {}),
      mode,
      createDriver: () => new NaverReplySubmitProbeDriver(page, { submitTimeoutMs: SUBMIT_TIMEOUT_MS }),
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
