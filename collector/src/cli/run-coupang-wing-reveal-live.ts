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
  stage2DetectionEligibility,
  type Stage2DetectionEligibility,
  type WingRevealResult,
} from "../action-window/coupang-wing-reveal-driver";
import { WING_ISSUE_SELECTOR_CALIBRATED } from "../action-window/coupang-wing-issuance-driver";
import {
  OPERATOR_CONFIRM_BUTTON_LABEL,
  OPERATOR_CONFIRM_PAGE_TITLE,
  type OperatorConfirmAsk,
  type OperatorConfirmation,
} from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import { confirmRunGrant, runGrantRefusalMessage, type RunGrantBinding } from "./operator-run-grant";
import {
  COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
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
    accountBinding: WING_DEFAULT_ACCOUNT_BINDING,
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

/**
 * The manifest fields THIS run holds, for the run-level grant. Built from the same constants the gate above
 * pins and the same run env the bootstrap bound — so the operator presses against what the run will do, not
 * against a paraphrase of it in a terminal or a chat log.
 */
export function revealRunGrantBinding(): RunGrantBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    channel: "COUPANG",
    // The manifest's OWN account value, from the contract module — not a second copy of it. The two drifted,
    // and the operator saw one string on the screen they pressed and another on the manifest they granted.
    account: WING_DEFAULT_ACCOUNT_BINDING,
    surface: "Coupang WING Open API",
    operation:
      "WING issuance-form reveal (the OPERATOR presses 발급; this press is not the key-creating action; agent performs no click/input/value read)",
    mode: REVEAL.mode,
    maxActions: "1 operator-performed 발급 press + 1 sanitized observation",
    agentDoesNot: "'발급'을 대신 누르지 않고, 아무것도 입력하지 않으며, 어떤 값도 읽지 않습니다.",
    // `mode` is `READ_ONLY` and the press is not believed to create a key — but this run's own banner says it
    // CANNOT prove one was not created (`keyCreationRuledOut: false`, and every signal it reads is identical
    // either way). Stated specifically here rather than as a word on the title.
    caution:
      "판매자님이 '발급'을 직접 누르시면 실제 키가 생성될 가능성을 SellerOps는 배제할 수 없습니다 — " +
      "화면으로 확인하실 수 있는 것은 판매자님뿐입니다.",
  };
}

/* ────────────────────────────── sentinels ────────────────────────────── */

/**
 * **There is no readiness sentinel and no pressed sentinel.** Both used to advance this walk — `.ready` before
 * the checkpoint and `.pressed` after it — and a file any process can `touch` cannot be evidence that a human
 * looked at a screen. The `.pressed` one was the worse of the two: it stood for "I pressed 발급 on WING", and
 * the observation taken on the strength of it went into a sanitized record as a fact.
 *
 * Both are now a verified press on the SellerOps confirmation surface (`./operator-confirm`).
 *
 * The ABORT sentinel stays, and the asymmetry is deliberate: a forged abort stops a run, which is the safe
 * direction. Only advancing needs a channel a model cannot reach.
 */
export const REVEAL_ABORT_FILENAME = "run-coupang-wing-reveal-live.abort";

export function sentinelPath(statusFile: string, filename: string): string {
  return resolve(dirname(resolve(statusFile)), filename);
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** What one operator checkpoint produced. `ready`/`pressed` are reachable ONLY through a verified press. */
export type RevealSignal = "ready" | "pressed" | "abort" | "timeout";

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
  /**
   * Every detector still standing on this baseline is one live evidence has already refuted, so a press could not
   * be observed by anything. Stops BEFORE the highlight: nothing is tagged, no overlay is mounted, and the press
   * hint is never printed — the operator is not asked to take a real marketplace action this run cannot watch.
   */
  "BLIND_INSTRUMENT",
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
   * The pre-press capability split, computed from the baseline BEFORE anything was highlighted.
   *
   * Null on the two paths that never reach the computation: an abort/timeout before the readiness signal, and
   * `NOT_OPEN_API_SURFACE`. The second one DOES hold an observation — it is deliberately not measured, because
   * capability against a login or credential page is not a fact about the reveal surface and would read as one.
   * (An earlier version of this comment said null meant "no baseline existed"; review caught it.)
   *
   * On the record because the alternative — a bare `detectableDisjunctCount` in a log line, after the press — is
   * what made two live runs unable to say whether "nothing changed" meant the surface or the instrument.
   */
  eligibility: Stage2DetectionEligibility | null;
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
  // Held outside `stopped` so every exit after the baseline carries it — including the fail-closed refusals,
  // where "what could this run have seen" is exactly what the next unit needs.
  let eligibility: Stage2DetectionEligibility | null = null;
  const stopped = (stop: RevealWalkStop): RevealWalkReport => {
    report = { stop, result: null, eligibility, outcomeAsExpected: false, cleanupFailed: false };
    return report;
  };
  /** NAMES and counts only — the disjuncts are field identifiers, never a value, selector, or page string. */
  const noteEligibility = (e: Stage2DetectionEligibility): void => {
    const fmt = (names: readonly string[]): string => (names.length ? names.join(", ") : "—");
    io.note("  detection capability on THIS baseline (measured before you are asked to press):");
    io.note(`    structural headroom (${e.structuralHeadroomDisjuncts.length}): ${fmt(e.structuralHeadroomDisjuncts)}`);
    io.note(`    empirically refuted on WING (${e.empiricallyRefutedDisjuncts.length}): ${fmt(e.empiricallyRefutedDisjuncts)}`);
    io.note(`    ELIGIBLE detectors (${e.eligibleDetectionDisjuncts.length}): ${fmt(e.eligibleDetectionDisjuncts)}`);
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
    // BEFORE the probe, and so before the highlight that tags and paints, and before anything is disclosed as
    // pressable. (The probe itself is read-only and tags nothing — an earlier comment implied otherwise. The
    // ordering still matters: `highlightIssueCheckpoint` is the step that mounts.) The gate reads
    // ONLY `eligibleDetectionDisjuncts`: structural headroom includes `submitAffordancePresent`, which has
    // headroom on every WING baseline and is proven blind there, so gating on the structural set would be a
    // check that passes forever on the strength of the one detector known not to work.
    eligibility = stage2DetectionEligibility(classified.observation);
    if (eligibility.eligibleDetectionDisjuncts.length === 0) {
      io.note("");
      io.note("⚠ BLIND_INSTRUMENT — every remaining detector for this baseline is one live evidence has refuted.");
      noteEligibility(eligibility);
      io.note("  Refusing to highlight 발급 or ask you to press it: this run could not observe the result.");
      io.note("  Nothing was highlighted and nothing was pressed. WING에서 아무것도 누르지 마세요.");
      return stopped("BLIND_INSTRUMENT");
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
    // Disclosed HERE, immediately above the press request, so the operator sees what this run can and cannot
    // observe at the moment they are asked to act — not afterwards, in a count, in a log line.
    noteEligibility(eligibility);
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
      // The three sets THEMSELVES, from the pre-press computation — not a count. A `SURFACE_UNCHANGED` is only
      // interpretable next to what this run was capable of seeing, and a reader must not have to trust that a
      // number and a set were derived from the same baseline.
      detectionEligibility: eligibility,
      // The driver's independent post-press recomputation over the same baseline. Emitted alongside rather than
      // in place of the above so the two cannot silently diverge; a test asserts they AGREE, against a
      // non-default baseline so neither side can be a literal that happens to match.
      detectableDisjuncts: result.detectableDisjuncts,
    });
    log("aw_coupang_reveal_run_done", {
      urlCategory,
      outcome: result.outcome,
      changedSignalCount: result.changedSignals.length,
      keyCreationRuledOut: result.keyCreationRuledOut,
      eligibleDetectionCount: eligibility.eligibleDetectionDisjuncts.length,
    });
    report = { stop: "OBSERVED", result, eligibility, outcomeAsExpected: asExpected, cleanupFailed: false };
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
 *   9 = BLIND_INSTRUMENT — refused before the highlight; nothing was highlighted or pressed
 *
 * 9 is distinct from 7 deliberately. Both mean "nothing was observed", but 7 says the surface or the operator
 * ended the run and 9 says SellerOps' own instrument was not fit to watch it — the difference between re-running
 * and repairing. Folding it into 7 would hide the one result that must not be retried as-is.
 */
export function revealExitCode(report: RevealWalkReport): number {
  if (report.cleanupFailed) return 8;
  if (report.stop === "BLIND_INSTRUMENT") return 9;
  if (report.stop !== "OBSERVED") return 7;
  return report.outcomeAsExpected ? 0 : 6;
}

/**
 * The two checkpoints, in the operator's own words. Separate builders because they ask for two different things
 * and only one of them is a real marketplace action.
 */
export function revealAskFor(kind: "ready" | "pressed"): OperatorConfirmAsk {
  return kind === "ready"
    ? {
        title: "WING REVEAL 1/2",
        headline: "reach the WING open-API screen YOURSELF in the opened window.",
        lines: [
          "SellerOps는 이 창을 조작하지 않습니다 — 로그인 · 2단계 인증 · 이동은 모두 직접 하세요.",
          "화면에 도착하신 뒤에 아래 버튼을 누르시면, SellerOps가 발급 버튼을 표시(하이라이트)합니다.",
          "이 단계에서는 아무것도 눌리지 않습니다.",
        ],
      }
    : {
        title: "WING REVEAL 2/2",
        headline: "표시된 발급 버튼을 직접 누르신 뒤에 확인해 주세요.",
        lines: [
          "SellerOps는 발급을 대신 누르지 않습니다. 누르는 것은 판매자님입니다.",
          "누르신 뒤 화면이 바뀌면, 아래 버튼을 눌러 주세요 — SellerOps는 그 다음에야 화면을 한 번 읽습니다.",
          "아직 누르지 않으셨다면 누르지 마세요. 이 창은 관찰 한 번으로 끝납니다.",
        ],
      };
}

/**
 * Wire the walk's IO to a confirmation channel and the console. Exported so a test can prove the two waits are
 * two DIFFERENT asks and that neither advances without a verified press: the second stands for "I pressed 발급
 * on WING", and the observation taken on the strength of it goes into a sanitized record as a fact.
 */
export function makeRevealIo(confirm: (ask: OperatorConfirmAsk) => Promise<OperatorConfirmation>): RevealWalkIo {
  return {
    waitFor: async (kind) => {
      const confirmation = await confirm(revealAskFor(kind));
      // `ready` from the channel means "a human pressed the SellerOps button for THIS ask" — which is this
      // checkpoint's own signal. Everything else (abort, timeout) passes through and stops the walk.
      return confirmation.signal === "ready" ? kind : confirmation.signal;
    },
    note: (line) => console.error(line),
    // SANITIZED record → stdout. Enums / booleans / buckets / signal NAMES only — never a selector, value, PII,
    // raw DOM/HTML, screenshot, or raw URL (the URL is reduced to a host category).
    emit: (record) => console.log(JSON.stringify(record, null, 2)),
    pressSignalHint: `SellerOps '${OPERATOR_CONFIRM_PAGE_TITLE}' 탭의 [${OPERATOR_CONFIRM_BUTTON_LABEL}] 버튼`,
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
  const abortPath = sentinelPath(cfg.statusFile, REVEAL_ABORT_FILENAME);
  mkdirSync(dirname(abortPath), { recursive: true });
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation tab is opened BEFORE the driver is built, so the entry page is the operator's own in every
  // ordering and the driver's context has the surface filtered out of it.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => abortFlag.v || existsSync(abortPath),
    abortPath,
    onVerdict: (verdict) => {
      if (verdict !== "CONFIRMED") log("aw_coupang_reveal_operator_confirm_refused", { verdict });
    },
  });
  const io = makeRevealIo(async (ask) => {
    confirmHost.announce(ask);
    const confirmation = await confirmHost.confirm(ask);
    log("aw_coupang_reveal_operator_confirm", {
      checkpoint: ask.title,
      signal: confirmation.signal,
      provenance: confirmation.provenance ?? "none",
    });
    return confirmation;
  });
  const driver = new CoupangWingRevealDriver(confirmHost.entryPage as unknown as Page, {
    context: confirmHost.contextLike as unknown as BrowserContext,
  });
  try {
    // **THE RUN-LEVEL GRANT, before the walk reads anything.** The approval flag above is the assistant's
    // statement of intent; it authorizes nothing. What authorizes this run is the operator pressing a button
    // against the manifest's own binding fields, in a window only they can press.
    const grant = await confirmRunGrant(confirmHost, revealRunGrantBinding());
    if (grant !== "GRANTED") {
      console.error(runGrantRefusalMessage(grant));
      log("aw_coupang_reveal_run_grant", { outcome: grant });
      process.exitCode = 7;
      return;
    }
    log("aw_coupang_reveal_run_grant", { outcome: grant });
    const report = await runRevealWalk(driver, io, screen.urlCategory);
    // The report is READ. A process that exits 0 whatever happened is how "the walk completed" comes to read as
    // "the expected thing happened" to anything downstream of a human watching the terminal.
    process.exitCode = revealExitCode(report);
  } finally {
    removeSentinel(abortPath);
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
