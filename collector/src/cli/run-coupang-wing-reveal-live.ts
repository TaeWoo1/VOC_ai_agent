/**
 * **Live, GATED, human-attended Coupang WING issuance-form REVEAL run
 * (`COUPANG_WING_ISSUANCE_FORM_REVEAL` / `REVEAL_WING_ISSUANCE_CONFIGURATION`).**
 *
 *   npx tsx src/cli/run-coupang-wing-reveal-live.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * One WING-resident Action Window step. SellerOps highlights the live-calibrated `발급` control on the real
 * open-API surface, mounts the expectation checkpoint, and RESTS. The OPERATOR presses 발급 themselves. Then
 * SellerOps clears its overlay, takes ONE sanitized observation of whatever surface appeared, prints it, and
 * exits. It never clicks, types, submits, selects 자체개발, fills 업체명/URL/IP, presses the final 확인, issues a
 * key, or reads any value.
 *
 * **The press is NOT declared as key creation.** On the official Coupang flow 발급 opens the 연동 방식 /
 * configuration step and the key is created by a later `확인`. That is the expectation this run is built around —
 * and it is NOT live-confirmed, so the runtime fails closed: an outcome it does not recognize is reported as
 * such and stops, never as success, and it never advances into the configuration step.
 *
 * **It cannot certify that no key was created.** Every sanitized signal is identical between a real issued page
 * and a real no-key form (`wingIssuedStateFrom` ⇒ `NO_DISCRIMINATING_SIGNAL`), so the printed record carries
 * `keyCreationRuledOut: false` with the classifier's own reason. Only the operator, looking at the screen, can
 * say what happened. A record that omitted this would read as an implicit all-clear.
 *
 * Gating mirrors `run-coupang-wing-deletion-live`: refuses without `--i-understand-this-opens-live-coupang-wing`
 * (a NAVER grant never opens WING); `screenWingUrl` fail-closed BEFORE Chrome launches; a PREPARED manifest for
 * THIS bootstrapped identity, with the immutable reveal descriptor and the `issue` calibration, plus a repo
 * identity check (HEAD is the pinned commit, this repository, clean tree). It NEVER navigates — the operator
 * does. `main()` runs ONLY when invoked directly, so offline build/verify launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  CoupangWingRevealDriver,
  WING_REVEAL_CHECKPOINT_LABEL,
  type WingRevealResult,
} from "../action-window/coupang-wing-reveal-driver";
import { WING_ISSUE_SELECTOR_CALIBRATED } from "../action-window/coupang-wing-issuance-driver";
import {
  COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  PHASE_SPECS,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "./approval-manifest";
import {
  resolveWingActionPhase,
  resolveWingUrl,
  screenWingUrl,
  type WingObservation,
  type WingUrlCategory,
} from "./coupang-wing-classifier";
import { verifyRepoIdentity } from "./repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

const REVEAL = PHASE_SPECS.COUPANG_WING_ISSUANCE_FORM_REVEAL;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Build the reveal phase's prerequisite input and run it through the gate. Returns the sanitized refusal cause
 * (or null when PREPARED). The single choke point: an unbound identity, a softened/missing reveal descriptor, an
 * off-target host, a withdrawn `issue` calibration, a drifted HEAD or a dirty tree all refuse HERE, before any
 * browser opens.
 *
 * `channel` / `accountBinding` / `surface` / `operation` / `maxActions` are pinned to constants rather than read
 * from the environment, for the reason the deletion CLI pins its scope: the operator's one-line grant binds to
 * those fields, so a stale `.env` from another run must not be able to make this manifest describe a different
 * run. This phase carries no `destructiveScope` (it is not destructive), so the pinning lives here.
 */
export function gateRefusalCause(
  apiCenterUrl: string,
  /** Repository-identity verifier seam; the DEFAULT is the real check, so a caller who forgets gets strictness. */
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
  /**
   * Calibration seam, same contract as `verifyIdentity`: the DEFAULT is the shipped constant, never a hardcoded
   * `true`, so withdrawing the calibration closes this path again without touching the gate. It was added while
   * the shipped value was `false` (`SELECTORS_NOT_CALIBRATED` short-circuits ahead of every other cause, so they
   * were otherwise untestable) and it stays for the opposite direction: with the value now `true`, injecting
   * `false` is how the withdrawal path keeps its coverage. `main()` calls this with ONE argument; a test proves
   * that, and a test proves the default tracks the constant.
   */
  calibrated: boolean = WING_ISSUE_SELECTOR_CALIBRATED,
): string | null {
  // The PHASE this run is authorized for, before anything else. The three `WALKTHROUGH_*` identity variables
  // are byte-identical across WING phases, so without this an approval granted for ANOTHER WING action reaches
  // PREPARED here — review demonstrated a reveal grant preparing the destructive deletion run. `expected` is a
  // literal, never env-derived, so both variables must name THIS entrypoint's phase.
  const phaseBinding = resolveWingActionPhase(process.env, "COUPANG_WING_ISSUANCE_FORM_REVEAL");
  if (!phaseBinding.ok) return `${phaseBinding.refusal}: ${phaseBinding.reason}`;

  const input: ApprovalPrereqInput = {
    phase: REVEAL.phase,
    channel: "COUPANG",
    accountBinding: "operator-owned Coupang WING test account",
    mode: REVEAL.mode,
    apiCenterUrl,
    cli: REVEAL.cli,
    driver: REVEAL.driver,
    declaredActions: REVEAL.capableActions,
    // The phase HIGHLIGHTS a real control, so the gate requires a calibration. Defaults to the shared constant —
    // never hardcoded `true` — so withdrawing the calibration closes this path with SELECTORS_NOT_CALIBRATED.
    selectorsCalibrated: calibrated,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: "1 operator-performed 발급 press + 1 sanitized observation",
    surface: "Coupang WING Open API",
    operation: "WING issuance-form reveal (the OPERATOR presses 발급; this press is not the key-creating action; agent performs no click/input/value read)",
    operatorRevealAction: COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/* ────────────────────────────── sentinels ────────────────────────────── */

export const REVEAL_READY_FILENAME = "run-coupang-wing-reveal-live.ready";
export const REVEAL_DONE_FILENAME = "run-coupang-wing-reveal-live.pressed";
export const REVEAL_ABORT_FILENAME = "run-coupang-wing-reveal-live.abort";

export function sentinelPath(statusFile: string, filename: string): string {
  return resolve(dirname(resolve(statusFile)), filename);
}

const POLL_MS = 1_000;
const WAIT_TIMEOUT_MS = 20 * 60_000;

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

/** Wait for one of the operator's sentinels. Pure-ish seam so the walk order is unit-testable offline. */
export type RevealSignal = "ready" | "pressed" | "abort" | "timeout";

/** Injectable surroundings for {@link waitForSignal} — filesystem, clock and the signal handler's flag. */
export interface SignalWaitDeps {
  exists(path: string): boolean;
  sleep(ms: number): Promise<void>;
  /** True once SIGINT/SIGTERM has been seen. Checked FIRST, so Ctrl-C wins over a sentinel that just appeared. */
  aborted(): boolean;
  maxTicks?: number;
  pollMs?: number;
  /**
   * Consume a sentinel once it has fired. A ready file left in place is not inert: if the two waits ever end up
   * watching the same path, the second returns on tick 0 and the human checkpoint is skipped in silence.
   */
  remove?(path: string): void;
}

/**
 * Wait for `target` to appear, or for an abort, or for the deadline. Exported and dependency-injected because it
 * is the only thing standing between "the operator said they pressed 발급" and SellerOps reading a live page — and
 * inline in `main()` it could not be tested without a browser and a 20-minute clock.
 *
 * Abort is checked BEFORE the target on every tick. An operator who hits Ctrl-C while the page is mid-transition
 * must not have a sentinel that lands in the same tick override them.
 */
export async function waitForSignal(
  target: string,
  /** Which signal a hit on `target` means — `ready` before the checkpoint, `pressed` after it. */
  kind: "ready" | "pressed",
  abortPath: string,
  deps: SignalWaitDeps,
): Promise<RevealSignal> {
  // Clamped, both of them. `pollMs: 0` makes the derived budget `Math.ceil(Infinity)` and the loop never ends —
  // a wait with no deadline on the seam that decides when SellerOps reads a live page. A negative one makes the
  // budget negative, so the body never runs and it returns `timeout` without ever checking abort or the target.
  const pollMs = Math.max(1, deps.pollMs ?? POLL_MS);
  const maxTicks = Math.max(1, deps.maxTicks ?? Math.ceil(WAIT_TIMEOUT_MS / pollMs));
  for (let i = 0; i < maxTicks; i++) {
    if (deps.aborted() || deps.exists(abortPath)) return "abort";
    if (deps.exists(target)) return kind;
    await deps.sleep(pollMs);
  }
  return "timeout";
}

/* ────────────────────────────── the walk ────────────────────────────── */

/**
 * The driver surface the walk uses. Narrowed to these five methods on purpose: the walk cannot navigate, click,
 * type, or read a value, because nothing here can. `CoupangWingRevealDriver` satisfies it structurally.
 */
export interface RevealWalkDriverLike {
  classifyInitialSurface(): Promise<{ ok: boolean; observation: WingObservation }>;
  probeIssueMatch(): Promise<{ matchCount: number; canHighlight: boolean; sig?: string }>;
  highlightIssueCheckpoint(): Promise<{ count: number; sig?: string }>;
  observeRevealOutcome(): Promise<WingRevealResult>;
  /**
   * Tear down the overlay and REPORT whether the page is clean. `false` means SellerOps' panel may still be on
   * the seller's live WING DOM — which is the failure that matters, and which the real driver signals by return
   * value, never by throwing (it catches everything internally).
   */
  cleanup(): Promise<boolean>;
}

/** Where the walk stopped. Every value except `OBSERVED` means nothing was observed and nothing was pressed. */
export const REVEAL_WALK_STOPS = [
  "ABORTED_BEFORE_CHECKPOINT",
  "NOT_OPEN_API_SURFACE",
  "ISSUE_NOT_UNIQUE",
  "CHECKPOINT_NOT_PAINTED",
  "ABORTED_AT_CHECKPOINT",
  "OBSERVED",
] as const;
export type RevealWalkStop = (typeof REVEAL_WALK_STOPS)[number];

export interface RevealWalkIo {
  /** Wait for the named sentinel. Returns what actually happened — never throws to signal an abort. */
  waitFor(kind: "ready" | "pressed"): Promise<RevealSignal>;
  /** Operator-facing narration (stderr). Never carries a value, a selector, or a raw URL. */
  note(line: string): void;
  /** The single sanitized record (stdout). Called at most once, and only on `OBSERVED`. */
  emit(record: Record<string, unknown>): void;
  /**
   * How the operator signals the press — printed AT the checkpoint, never before it.
   *
   * It is a field rather than a line `main()` prints up front because of where the original refactor put it:
   * announcing the completion sentinel before the readiness wait invites the operator to create it early, and a
   * pressed sentinel that already exists makes the checkpoint wait a no-op. The human checkpoint would then be
   * skipped in silence, with SellerOps observing a page nobody pressed.
   */
  pressSignalHint: string;
}

export interface RevealWalkReport {
  stop: RevealWalkStop;
  result: WingRevealResult | null;
  /**
   * True ONLY for the one outcome this run was built to expect. Everything else — including
   * `CREDENTIAL_SURFACE_APPEARED` — is false, and false never advances anything: the walk stops either way.
   *
   * `main()` MUST read this: a process that exits 0 on every outcome is how "the walk completed" comes to read
   * as "the expected thing happened" to anything downstream of the terminal.
   */
  outcomeAsExpected: boolean;
  /**
   * True when the overlay clear failed on the way out — either by rejecting, or (the shape the real driver
   * actually uses) by returning false.
   *
   * The original propagated a throwing clear on exactly ONE of six paths, the explicit `await driver.cleanup()`
   * before the checkpoint-abort return; on the other five its `finally` swallowed it and exited 0. So this is
   * not a restoration of prior behaviour — it is new, and it is the difference between an operator learning
   * SellerOps' panel is still on their live WING DOM and not learning it.
   */
  cleanupFailed: boolean;
}

/**
 * The reveal walk, browser-free.
 *
 * Takes a driver and an IO seam rather than a `BrowserContext`, so every path below — the two sentinel waits,
 * both aborts, the timeout, each fail-closed refusal, and the unexpected-outcome stop — is exercised offline.
 * `main()` is the only thing that launches Chrome, and it does so BEFORE calling this.
 *
 * It never navigates and never advances past the single observation, whatever that observation says.
 */
export async function runRevealWalk(
  driver: RevealWalkDriverLike,
  io: RevealWalkIo,
  /**
   * The COARSE host category, never a URL. Typed as the enum rather than `string`, because as `string` a caller
   * passing the raw WING URL typechecked — and it would print verbatim into the sanitized stdout record.
   */
  urlCategory: WingUrlCategory,
): Promise<RevealWalkReport> {
  // Held by reference so the `finally` can annotate the very object being returned — the cleanup runs AFTER the
  // return value is chosen, and its failure is part of what the caller must know.
  let report: RevealWalkReport | null = null;
  const stopped = (stop: RevealWalkStop): RevealWalkReport => {
    report = { stop, result: null, outcomeAsExpected: false, cleanupFailed: false };
    return report;
  };
  try {
    if ((await io.waitFor("ready")) !== "ready") {
      io.note("Aborted or timed out before the checkpoint. Nothing was highlighted.");
      return stopped("ABORTED_BEFORE_CHECKPOINT");
    }
    const classified = await driver.classifyInitialSurface();
    if (!classified.ok) {
      io.note(`Refusing to continue: not the open-API surface (pageCategory=${classified.observation.pageCategory}).`);
      return stopped("NOT_OPEN_API_SURFACE");
    }
    const probe = await driver.probeIssueMatch();
    if (probe.matchCount !== 1) {
      io.note(`Refusing to highlight: the 발급 control matched ${probe.matchCount}, not 1. Nothing was highlighted.`);
      return stopped("ISSUE_NOT_UNIQUE");
    }
    const located = await driver.highlightIssueCheckpoint();
    if (located.count !== 1) {
      io.note("The checkpoint could not be painted — refusing to hand the operator an unmarked page.");
      return stopped("CHECKPOINT_NOT_PAINTED");
    }
    io.note("");
    io.note(`CHECKPOINT — ${WING_REVEAL_CHECKPOINT_LABEL}`);
    // The completion sentinel is disclosed HERE and nowhere earlier. Announced before the readiness wait, it
    // invites the operator to create it in advance — and a pressed sentinel that already exists makes the wait
    // below return on tick 0, skipping the human checkpoint in silence.
    io.note(`  Press 발급 YOURSELF, then signal that you pressed it:  ${io.pressSignalHint}`);
    if ((await io.waitFor("pressed")) !== "pressed") {
      io.note("Aborted or timed out at the checkpoint. Clearing the overlay; no observation taken.");
      return stopped("ABORTED_AT_CHECKPOINT");
    }
    const result = await driver.observeRevealOutcome();
    const asExpected = result.outcome === "CONFIGURATION_SURFACE_SUSPECTED";
    io.note("");
    io.note("Reveal observation complete. 이 창은 곧 닫힙니다 — WING에서 더 진행하지 마세요.");
    // EVERY unexpected outcome gets a STOP block, not only the keys-displayed one. Six of the seven outcomes are
    // unexpected, and the docstring's promise that an unrecognized outcome "stops, never as success" is worth
    // nothing if five of them print the same "observation complete" line a good run prints.
    if (!asExpected) {
      io.note("");
      io.note(`⚠ UNEXPECTED OUTCOME — ${result.outcome}. This run did NOT see what it was built to expect.`);
      io.note("  It is not a failure to investigate away: it is the evidence. Do not re-run, and do not continue");
      io.note("  in WING. 화면을 직접 확인하고 WING에서 더 진행하지 마세요.");
      // The one outcome that suggests the press may have done more than reveal a form says so explicitly — a
      // reader must not have to notice an enum buried in the JSON to learn the keys-displayed surface appeared.
      if (result.outcome === "CREDENTIAL_SURFACE_APPEARED") {
        io.note("  The surface became the keys-displayed category. That is NOT proof a key was created, and");
        io.note("  SellerOps cannot determine it either way — only you, looking at the screen, can.");
      }
    }
    io.emit({
      urlCategory,
      phase: REVEAL.phase,
      operatorAction: COUPANG_WING_ISSUANCE_REVEAL_ACTION.operation,
      outcome: result.outcome,
      changedSignals: result.changedSignals,
      before: result.before,
      after: result.after,
      // Always false, with the classifier's reason. Emitted so the record cannot be read as an all-clear.
      keyCreationRuledOut: result.keyCreationRuledOut,
      keyCreationReason: result.keyCreationReason,
      overlayClearedBeforeObservation: result.overlayClearedBeforeObservation,
    });
    log("aw_coupang_reveal_run_done", {
      urlCategory,
      outcome: result.outcome,
      changedSignalCount: result.changedSignals.length,
      keyCreationRuledOut: result.keyCreationRuledOut,
    });
    report = { stop: "OBSERVED", result, outcomeAsExpected: asExpected, cleanupFailed: false };
    return report;
  } finally {
    // EVERY exit path clears the overlay, including the fail-closed refusals above and a thrown observation —
    // leaving SellerOps' panel and the `data-aw-target` annotation on the seller's live marketplace DOM is the
    // defect that review already caught once inside the driver.
    //
    // A failure here is RECORDED, not swallowed. (The original propagated a throw on ONE of six paths and
    // swallowed it on the other five.) Discarding it leaves the panel on the seller's live page with no signal.
    // BOTH failure shapes. A throw is the obvious one; the one that actually happens is a `false` verdict —
    // `CoupangWingRevealDriver.clearHighlight` catches every error it can hit, so the production driver reports
    // a stuck panel by returning false and never by rejecting. Wiring this to the throw alone made the
    // guarantee unreachable in production while a `cleanupThrows` fake kept its test green.
    const cleared = await driver.cleanup().catch(() => false);
    if (cleared === false) {
      if (report) report.cleanupFailed = true;
      io.note("⚠ The overlay could not be cleared. SellerOps' panel may still be on the WING page — reload it.");
    }
  }
}

/**
 * The process exit code for a finished walk. Extracted so it is testable by VALUE: the source-only guard that
 * replaced it asserted four token strings were present, and an INVERSION — unexpected outcomes exiting 0 and the
 * expected one exiting 6 — passed it unchanged. That inversion is the precise opposite of what the exit codes
 * exist for.
 *
 *   0 = observed, and the outcome was the one this run was built to expect
 *   6 = observed, but an UNEXPECTED outcome — read the STOP block, do not continue in WING
 *   7 = nothing was observed (refused, aborted, or timed out before the operator acted)
 *   8 = the overlay could not be cleared; SellerOps' panel may still be on the live page
 */
export function revealExitCode(report: RevealWalkReport): number {
  if (report.cleanupFailed) return 8;
  if (report.stop !== "OBSERVED") return 7;
  return report.outcomeAsExpected ? 0 : 6;
}

/**
 * Wire the walk's IO to the real filesystem sentinels and the console. Exported so a test can prove the two
 * waits observe DIFFERENT paths: the mapping from signal kind to sentinel file is the one place `waitForSignal`'s
 * label and its target are re-joined, and getting it wrong (both waits on the ready path) makes the checkpoint
 * wait return on tick 0 — SellerOps would observe a page nobody pressed, and exit 0.
 */
export function makeRevealIo(
  paths: { readyPath: string; donePath: string; abortPath: string },
  deps: SignalWaitDeps,
): RevealWalkIo {
  return {
    waitFor: async (kind) => {
      const target = kind === "ready" ? paths.readyPath : paths.donePath;
      const signal = await waitForSignal(target, kind, paths.abortPath, deps);
      // Consume it. Leaving the ready file behind is what makes the "both waits watch the same path" mistake
      // fail OPEN rather than time out.
      if (signal === kind) deps.remove?.(target);
      return signal;
    },
    note: (line) => console.error(line),
    // SANITIZED record → stdout. Enums / booleans / buckets / signal NAMES only — never a selector, value, PII,
    // raw DOM/HTML, screenshot, or raw URL (the URL is reduced to a host category).
    emit: (record) => console.log(JSON.stringify(record, null, 2)),
    pressSignalHint: paths.donePath,
  };
}

/**
 * The operator-facing banner. It is the RUN-TIME restatement of the pair the manifest carries — "not confirmed"
 * and "cannot prove no key was created" — shown at the moment a live window is about to open.
 *
 * Both the CONSTANT and the PRINTING are tested. Guarding only the constant put the guard one layer away from
 * the thing it guards: `REVEAL_BANNER_LINES.slice(0, 4)` in `banner()` drops exactly the two claim lines and
 * left every test green, so the operator would open a live WING window having been told neither.
 */
export const REVEAL_BANNER_LINES: readonly string[] = [
  " LIVE Coupang WING issuance-form REVEAL — explicit per-run approval required.",
  " SellerOps HIGHLIGHTS the 발급 control and RESTS. The OPERATOR presses it. SellerOps never",
  " clicks, types, submits, selects 자체개발, fills 업체명/URL/IP, presses 확인, issues a key, or",
  " reads any value (incl. Access Key / Secret Key / 업체코드).",
  " The press is expected to open the API configuration step — this is NOT confirmed, so an",
  " unrecognized outcome STOPS the run. It CANNOT prove no key was created; only you can see that.",
];

export function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  for (const l of REVEAL_BANNER_LINES) console.error(l);
  console.error(line);
}

/**
 * Live entry (gated). Opens the operator's window ONCE, NEVER navigates it, highlights 발급, rests until the
 * operator signals they pressed it, clears the overlay, takes ONE sanitized observation, prints it, and closes.
 */
async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const url = resolveWingUrl(args, process.env);
  const screen = screenWingUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). It must be the ` +
        "Coupang WING or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }
  const refusal = gateRefusalCause(url);
  if (refusal) {
    console.error(`Refusing to start the WING issuance-form REVEAL run: approval_prerequisite (${refusal}). No browser launched.`);
    console.error(
      refusal === "SELECTORS_NOT_CALIBRATED"
        ? "  The 발급 selector calibration is withdrawn. Restore it only from a fresh READ-ONLY selector probe."
        : refusal.startsWith("HEAD_DRIFT") || refusal.startsWith("DIRTY_TREE")
          ? "  The running code is not the commit this approval names — the grant is REVOKED (contract §1.6). Commit or stash, then re-bootstrap."
          : refusal.startsWith("WRONG_REPOSITORY") || refusal.startsWith("GIT_UNREADABLE")
            ? "  Repository state could not be verified — refusing rather than assuming the code is unchanged."
            : "  Re-bootstrap a valid identity + reveal Approval Manifest, then retry.",
    );
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  const readyPath = sentinelPath(cfg.statusFile, REVEAL_READY_FILENAME);
  const donePath = sentinelPath(cfg.statusFile, REVEAL_DONE_FILENAME);
  const abortPath = sentinelPath(cfg.statusFile, REVEAL_ABORT_FILENAME);
  mkdirSync(dirname(readyPath), { recursive: true });
  for (const p of [readyPath, donePath, abortPath]) removeSentinel(p);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const waitDeps: SignalWaitDeps = {
    exists: existsSync,
    sleep,
    aborted: () => abortFlag.v,
    remove: removeSentinel,
  };
  const io = makeRevealIo({ readyPath, donePath, abortPath }, waitDeps);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const entry = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  const driver = new CoupangWingRevealDriver(entry, { context: ctx });
  try {
    console.error("");
    console.error("Navigate MANUALLY to the WING open-API screen in the opened window, then signal readiness:");
    console.error(`       ${readyPath}`);
    console.error(`     abort: ${abortPath}`);
    // The COMPLETION sentinel is deliberately NOT announced here — the walk discloses it at the checkpoint. See
    // `RevealWalkIo.pressSignalHint`.
    const report = await runRevealWalk(driver, io, screen.urlCategory);
    // The report is READ. A process that exits 0 whatever happened is how "the walk completed" comes to read as
    // "the expected thing happened" to anything downstream of a human watching the terminal.
    process.exitCode = revealExitCode(report);
  } finally {
    for (const p of [readyPath, donePath, abortPath]) removeSentinel(p);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await driver.cleanup().catch(() => undefined);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_reveal_run_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
