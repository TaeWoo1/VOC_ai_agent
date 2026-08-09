/**
 * **Live, GATED, human-attended Coupang WING API-issuance READ-ONLY selector/structure RECORDER
 * (`COUPANG_WING_SELECTOR_RECORD`).**
 *
 *   set -a && . ./.env && set +a          # COUPANG_WING_URL (operator-owned; never logged)
 *   npx tsx src/cli/probe-wing-issuance-selectors.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * The Coupang analog of `probe-issuance-selectors.ts`: the read-only step that CALIBRATES the guided WING
 * issuance driver's OWN fixed-label locate mechanism against the real WING open-API issuance page, WITHOUT ever
 * highlighting, tagging, clicking, typing, submitting, issuing a key, or reading a value. It opens the seller's
 * dedicated Chrome window; the SELLER navigates MANUALLY to the open-API issuance page and signals ready (a
 * sentinel file — this recorder never calls `.goto`); then it runs the SAME {@link CoupangWingIssuanceDriver}
 * the guided walk would use, but only through its READ-ONLY {@link CoupangWingIssuanceDriver.probeTargetMatch}
 * (per candidate: how many elements its fixed WING label matches, whether it resolves uniquely, and the opaque
 * 16-hex structural signature of a unique match) plus {@link CoupangWingIssuanceDriver.observeSurface} (the
 * sanitized page category + bucketized signals + calibration blockers).
 *
 * The output is a machine-checkable CALIBRATION RECORD: value-free integers + booleans + fixed candidate labels +
 * coarse candidate roles + opaque 16-hex sigs + the sanitized {@link WingObservation}. NEVER a raw DOM/HTML, a
 * screenshot, a field value (esp. Access Key / Secret Key / 업체코드), PII, a selector, or a raw URL (a URL is only
 * screened to a host CATEGORY, never logged). `LIVE_DOM_CALIBRATION_PENDING` is always reported — this recorder
 * MEASURES uniqueness so a later live run can flip the calibration; it never flips a `SELECTORS_CALIBRATED` flag.
 *
 * **Two modes, both read-only.** By DEFAULT it measures the SHIPPED labels (`WING_HIGHLIGHT_LABELS` + 삭제) —
 * the baseline calibration. Under the approved phase `COUPANG_WING_LABEL_RECON` it ALSO sweeps the CANDIDATE
 * label sets in `coupang-wing-label-recon.ts`, which is how an unresolved label (`self_dev` and `call_ip`
 * matched 0, `vendor_info` matched 8, on the real 2026-08-08 no-key form) gets narrowed by MEASUREMENT instead
 * of by a guess edited into the shipped locators. The sweep probes each candidate through the very same
 * `probeFixedLabelMatch` seam the baseline uses, so it opens no new page interaction; it has no promotion path,
 * so a uniquely-resolving candidate is recorded as evidence and the shipped label is unchanged by the run.
 *
 * SCOPE IS GATED, NOT DEFAULTED. A live run refuses unless BOTH `SELLEROPS_WING_PROBE_TARGETS` (what this run
 * measures) and `SELLEROPS_WING_APPROVED_TARGETS` (what the displayed manifest said, bound by
 * `tools/coupang-local/wing-probe-preflight.sh`) are explicit, non-empty, canonical, and EQUAL — checked BEFORE
 * Chrome launches. An unset scope would otherwise widen the run to every target, so every way of losing it
 * (forgotten export, hand-typed command, dropped run env) would widen past what was approved. A direct manual
 * invocation carries neither variable and is refused. This closes ACCIDENTAL widening (a dropped or forgotten
 * scope); it does not prove the preflight was used, since a hand-typed equal pair also passes.
 *
 * Gating mirrors `run-coupang-wing-issuance-live`: refuses without `--i-understand-this-opens-live-coupang-wing`
 * (`hasCoupangWingRunApproval` — a NAVER grant never opens WING); `screenWingUrl`-fail-closed BEFORE Chrome
 * launches; the recorder NEVER navigates (the seller does — read-only); always `ctx.close()`. `main()` runs ONLY
 * when invoked directly (inert on import), so offline build/verify launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  CoupangWingIssuanceDriver,
  WING_DELETION_LABELS,
  WING_HIGHLIGHT_LABELS,
  type WingDeletionTarget,
  type WingFixedLabelProbe,
  type WingHighlightTarget,
} from "../action-window/coupang-wing-issuance-driver";
import {
  interpretWingRecon,
  isWingReconTarget,
  wingReconProbes,
  type WingReconTarget,
  type WingReconTargetResult,
  type WingStage2ReconTarget,
  type WingStage2ReconTargetResult,
  type WingStage2Precondition,
  interpretWingStage2Recon,
  wingStage2ReconProbes,
  wingStage2Precondition,
  resolveWingStage2ReconScope,
  WING_STAGE2_RECON_TARGETS,
} from "../action-window/coupang-wing-label-recon";
import {
  LIVE_DOM_CALIBRATION_PENDING,
  WING_APPROVAL_PHASE_ENV,
  WING_APPROVED_PHASE_ENV,
  WING_PROBE_TARGET_NAMES,
  wingIssuedStateFrom,
  type WingIssuedState,
  type WingIssuedStateReason,
  resolveGatedWingProbeScope,
  resolveWingUrl,
  screenWingUrl,
  type WingObservation,
  type WingProbeScopeRefusal,
  type WingChoiceControlCensus,
} from "./coupang-wing-classifier";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

/** A per-run operator signal: proceed, abort the session, or the wait timed out. */
export type WingRecordSignal = "ready" | "abort" | "timeout";

/**
 * Every fixed-label target the recorder measures: the highlightable issuance candidates AND the 삭제 (delete)
 * control on the already-issued page. All are measured read-only on the CURRENT page — the delete candidate rides
 * the SAME already-issued page as `issue` / `credentials`, so one recorder run can calibrate 삭제 alongside them
 * (setting up the deletion path) WITHOUT ever highlighting or pressing it.
 */
export type WingRecordTarget = WingHighlightTarget | WingDeletionTarget;

/**
 * The targets the recorder measures. The guidance-only targets (`reach_open_api`, `return`) are NOT queried WING
 * controls — they are text guidance — so they are never probed. `delete` is the 삭제 control on the already-issued
 * page (a value-free count only; never pressed).
 */
export const WING_RECORD_TARGETS: readonly WingRecordTarget[] = [
  "self_dev",
  "vendor_info",
  "call_ip",
  "issue",
  "credentials",
  "delete",
] as const;

/**
 * Coarse, human-legible EXPECTED role for each candidate — a fixed recorder constant (NOT a live element read), so
 * the calibration record says what KIND of control each fixed label is meant to resolve to. It is descriptive
 * evidence only; the live `matchCount` is what proves the candidate resolves uniquely.
 *
 * **Named `EXPECTED` in full because the short name cost us a live run.** As `WING_TARGET_ROLE`, written into a
 * record field called `role`, this constant was read downstream as an observation and summarized into
 * `WING_ISSUE_CALIBRATION_EVIDENCE` as `role: "button"` — a measurement the recorder had never taken and which
 * turned out to be false. An expectation and an observation must not share a name; compare this against the
 * MEASURED `observedTag` on each record rather than trusting either alone.
 */
export const WING_TARGET_EXPECTED_ROLE: Readonly<Record<WingRecordTarget, string>> = {
  self_dev: "option",
  vendor_info: "field-label",
  call_ip: "field-label",
  issue: "button",
  credentials: "readonly-region",
  delete: "button",
};

/** The fixed-label spec for a record target — issuance labels, plus the deletion 삭제 label (decoupled union). */
export function wingRecordLabelSpec(target: WingRecordTarget): { candidateQuery: string; exactText: string; tagAncestor?: string } {
  return target === "delete" ? WING_DELETION_LABELS.delete : WING_HIGHLIGHT_LABELS[target];
}

/** One candidate's sanitized calibration row. Value-free: a count, a boolean, our own fixed label/role, an opaque sig. */
/**
 * Closed, sanitized fault fingerprints for a live capture step whose read-only Playwright/DOM read threw. The
 * raw error message is inspected LOCALLY to pick the enum and is NEVER emitted — only which KIND of failure, so
 * a live failure is diagnosable (e.g. a real WING page navigating/closing under the read) without leaking any
 * message, selector, value, or URL. Mirrors the NAVER driver's sanitized fault fingerprinting.
 */
export const WING_FAULT_FINGERPRINTS = ["CONTEXT_DESTROYED", "TARGET_CLOSED", "TIMEOUT", "EVAL_FAILED", "UNKNOWN"] as const;
export type WingFaultFingerprint = (typeof WING_FAULT_FINGERPRINTS)[number];

export function wingFaultFingerprint(err: unknown): WingFaultFingerprint {
  const m = (err instanceof Error && typeof err.message === "string" ? err.message : "").toLowerCase();
  if (m.includes("execution context was destroyed") || m.includes("context was destroyed")) return "CONTEXT_DESTROYED";
  if (m.includes("target page, context or browser has been closed") || m.includes("target closed") || m.includes("has been closed"))
    return "TARGET_CLOSED";
  if (m.includes("timeout") || m.includes("timed out")) return "TIMEOUT";
  if (m.includes("evaluation failed") || m.includes("failed to evaluate") || m.includes("evaluate")) return "EVAL_FAILED";
  return "UNKNOWN";
}

export interface WingSelectorRecord {
  target: WingRecordTarget;
  /** How many candidates the fixed WING label matched live (integer only). */
  matchCount: number;
  /** Whether it resolves uniquely (matchCount === 1) and can therefore be highlighted. */
  canHighlight: boolean;
  /** Coarse EXPECTED role of the candidate (recorder constant — never a live element read). */
  expectedRole: string;
  /**
   * MEASURED tag name of the unique match (e.g. `"BUTTON"`), else null. The counterpart to {@link expectedRole}:
   * when the two disagree, the fixed label resolved to something other than the kind of control it was written
   * for — the condition that produced an invisible 발급 highlight and went unnoticed for four captures.
   */
  observedTag: string | null;
  /** Matches rejected for not painting. Separates "matched nothing visible" from "matched nothing" (integer). */
  hiddenMatchCount: number;
  /** The fixed WING label anchor the candidate probes for (our own config constant, never scraped page content). */
  label: string;
  /** Opaque 16-hex structural signature of the unique match (tag+position+child-count in-page), else null. */
  sig16: string | null;
  /** Sanitized fingerprint when this candidate's read-only probe THREW (else null). Never a raw message. */
  fault: WingFaultFingerprint | null;
}

/** The machine-checkable calibration record the recorder prints. Integers/booleans/fixed-labels/roles/sigs only. */
export interface WingSelectorRecordResult {
  /** Sanitized surface observation (pageCategory + bucketized signals + blockers). Null when the run never reached ready OR the observe read threw. */
  observation: WingObservation | null;
  /** Sanitized fingerprint when the surface observation THREW (else null) — so a failed observe is diagnosable, not an opaque fatal. */
  observationFault: WingFaultFingerprint | null;
  targets: WingSelectorRecord[];
  /** How many candidates resolved uniquely this run (sanitized count). */
  uniqueCandidates: number;
  /** How many candidates did NOT resolve uniquely — the drift/calibration signal (sanitized count). */
  nonUniqueCandidates: number;
  aborted: boolean;
  /**
   * Sanitized ISSUED-STATE verdict derived from {@link observation} — a three-value enum plus a closed reason,
   * no value read.
   *
   * **As of 2026-08-08 this is always `indeterminate` on the open-API surface, and that is correct.** The real
   * post-delete no-key form read `credentialAnchorPresent: true`, so the anchor is a proven false positive for
   * issued-state; no signal recorded on BOTH a real issued page and a real no-key form tells them apart. The
   * field is still emitted — the reason distinguishes `NOT_OPEN_API_SURFACE` / `SCAN_TRUNCATED` /
   * `NO_DISCRIMINATING_SIGNAL` / `NO_OBSERVATION`, which is real information about the reading. What it must
   * not be read as is a state: `indeterminate` is the absence of evidence, never evidence of either outcome.
   * Full evidence table + what would restore a verdict: `wingIssuedStateFrom` in `coupang-wing-classifier`.
   */
  issuedState: { state: WingIssuedState; reason: WingIssuedStateReason };
  /**
   * The candidate-label RECON sweep, or null when the run was not a recon run (the ordinary baseline probe).
   *
   * **Evidence, never a decision.** A candidate resolving uniquely here does not promote it: no code path in
   * this recorder or in `coupang-wing-label-recon` writes a shipped label, and two candidates resolving at once
   * is deliberately left `resolvedUnambiguously: false` for an offline reviewer with the signatures in hand.
   */
  recon: WingReconSweep | null;
  /** The Stage-2 sweep, or null when this run was not a Stage-2 recon (or aborted before measuring anything). */
  stage2: WingStage2Sweep | null;
  /** ALWAYS present: these candidate labels are unvalidated hypotheses until a live run proves matchCount === 1. */
  calibration: typeof LIVE_DOM_CALIBRATION_PENDING;
}

/** One candidate's read-only probe failed; the sanitized fingerprint says WHICH KIND, never the message. */
export interface WingReconFault {
  id: string;
  fault: WingFaultFingerprint;
}

export interface WingReconSweep {
  /** Recorded so the sweep's own record states the phase that authorized it, not just the scope. */
  phase: typeof WING_LABEL_RECON_PHASE;
  targets: WingReconTargetResult[];
  /** Candidates whose read-only probe THREW. Each is `NOT_MEASURED` above — never a measured zero. */
  faults: WingReconFault[];
  candidatesMeasured: number;
  candidatesNotMeasured: number;
}

export interface WingStage2Sweep {
  phase: typeof WING_STAGE2_RECON_PHASE;
  /**
   * Whether the surface passed the Stage-2 precondition. On anything but `OK` the sweep is NOT run: measuring
   * Stage-2 hypotheses against the initial surface produces a full set of confident ABSENT verdicts for labels
   * that were never on screen, which is worse than no reading at all.
   */
  precondition: WingStage2Precondition;
  targets: WingStage2ReconTargetResult[];
  faults: WingReconFault[];
  candidatesMeasured: number;
  candidatesNotMeasured: number;
  /** Null when the census seam was absent or threw — never a fabricated zero-control reading. */
  choiceControls: WingChoiceControlCensus | null;
  choiceControlFault: WingFaultFingerprint | null;
}

/** Injected seams so the whole read-only recorder is unit-tested offline over fakes (no browser, no WING). */
export interface WingSelectorRecordDeps {
  /** Block until the operator signals ready / abort / timeout (sentinel-file only). */
  waitForReady(): Promise<WingRecordSignal>;
  /** The sanitized surface observation (pageCategory + signals + blockers) — reused from the driver's own probe. */
  observeSurface(): Promise<WingObservation>;
  /** Read-only fixed-label match for one candidate (never tags/highlights/clicks/reads a value). */
  probeTarget(target: WingRecordTarget): Promise<WingFixedLabelProbe>;
  /**
   * Read-only fixed-label match for an ARBITRARY candidate spec — the recon sweep's only page interaction, and
   * the SAME driver seam `probeTarget` uses (`probeFixedLabelMatch`). Required only for a recon run; a baseline
   * run never calls it.
   */
  probeCandidate?(spec: { candidateQuery: string; exactText: string }): Promise<{
    matchCount: number;
    canHighlight: boolean;
    sig?: string;
  }>;
  /**
   * READ-ONLY choice-control SHAPE census — the one measurement this recorder gained for Stage-2. Optional for
   * the same reason `probeCandidate` is: a run that cannot take it must record that it could not, never die.
   */
  choiceControlCensus?(): Promise<WingChoiceControlCensus>;
  /** Print sanitized instructions (noop in tests). */
  announce?(): void;
}

/** How the orchestrator was scoped this run. `recon` is empty for an ordinary baseline probe. */
export interface WingSelectorRecordOptions {
  recon?: readonly WingReconTarget[];
  /** Stage-2 sweep scope. Mutually exclusive with `recon` by construction — the phase gate picks exactly one. */
  stage2?: readonly WingStage2ReconTarget[];
}

/**
 * The pure orchestrator. Waits for the operator's single ready signal, reads the sanitized surface observation,
 * then measures every candidate's fixed-label matchCount read-only. It NEVER highlights, tags, clicks, or reads a
 * value — every measurement is `probeTarget` (count + opaque sig only). Abort/timeout return the empty sanitized
 * record. `label`/`role` are recorder/driver constants; `sig16` is null unless the candidate resolved uniquely.
 */
export async function runWingSelectorRecord(
  deps: WingSelectorRecordDeps,
  probeTargets: readonly WingRecordTarget[] = WING_RECORD_TARGETS,
  opts: WingSelectorRecordOptions = {},
): Promise<WingSelectorRecordResult> {
  const reconTargets = opts.recon ?? [];
  const stage2Targets = opts.stage2 ?? [];
  deps.announce?.();
  const signal = await deps.waitForReady();
  if (signal !== "ready") {
    return {
      observation: null,
      observationFault: null,
      targets: [],
      uniqueCandidates: 0,
      nonUniqueCandidates: 0,
      aborted: signal === "abort",
      issuedState: wingIssuedStateFrom(null),
      // An aborted/timed-out recon run measured nothing. Emitting an empty sweep would read as "swept, found
      // nothing"; null says the sweep never happened, which is the same measured-vs-unmeasured distinction the
      // per-candidate `NOT_MEASURED` verdict draws one level down.
      recon: null,
      // Same reasoning as `recon: null` — an aborted run swept nothing, and an empty sweep object would read as
      // "swept, found nothing" for a Stage-2 nobody ever looked at.
      stage2: null,
      calibration: LIVE_DOM_CALIBRATION_PENDING,
    };
  }

  // Each read-only step is isolated: a real WING page that navigates/closes under one read yields a sanitized
  // fingerprint for THAT step, not an opaque top-level fatal that loses the whole record. The recorder captures
  // everything it can and reports where it could not.
  let observation: WingObservation | null = null;
  let observationFault: WingFaultFingerprint | null = null;
  try {
    observation = await deps.observeSurface();
  } catch (e) {
    observationFault = wingFaultFingerprint(e);
  }

  const targets: WingSelectorRecord[] = [];
  let uniqueCandidates = 0;
  let nonUniqueCandidates = 0;

  for (const target of probeTargets) {
    let matchCount = 0;
    let canHighlight = false;
    let sig: string | undefined;
    let observedTag: string | undefined;
    let hiddenMatchCount = 0;
    let fault: WingFaultFingerprint | null = null;
    try {
      const probe = await deps.probeTarget(target);
      ({ matchCount, canHighlight, sig } = probe);
      observedTag = probe.observedTag;
      hiddenMatchCount = probe.hiddenMatchCount ?? 0;
    } catch (e) {
      fault = wingFaultFingerprint(e);
    }
    targets.push({
      target,
      matchCount,
      canHighlight,
      expectedRole: WING_TARGET_EXPECTED_ROLE[target],
      observedTag: canHighlight && observedTag ? observedTag : null,
      hiddenMatchCount,
      label: wingRecordLabelSpec(target).exactText,
      sig16: canHighlight && sig ? sig : null,
      fault,
    });
    if (canHighlight) uniqueCandidates += 1;
    else nonUniqueCandidates += 1;
  }

  return {
    observation,
    observationFault,
    targets,
    uniqueCandidates,
    nonUniqueCandidates,
    aborted: false,
    issuedState: wingIssuedStateFrom(observation),
    recon: reconTargets.length > 0 ? await sweepReconCandidates(deps, reconTargets) : null,
    stage2: stage2Targets.length > 0 ? await sweepStage2(deps, stage2Targets, observation) : null,
    calibration: LIVE_DOM_CALIBRATION_PENDING,
  };
}

/**
 * The STAGE-2 sweep: precondition first, then the same read-only candidate seam, then the shape census.
 *
 * The precondition is checked BEFORE any candidate is probed, and a failure returns zero candidate rows rather
 * than a set of `ABSENT` ones. That ordering is the point — `ABSENT` means "measured, not found", and measuring
 * Stage-2 labels on the initial surface would produce six confident absences for a screen nobody was looking at.
 */
async function sweepStage2(
  deps: WingSelectorRecordDeps,
  targets: readonly WingStage2ReconTarget[],
  observation: WingObservation | null,
): Promise<WingStage2Sweep> {
  const precondition = wingStage2Precondition(observation);
  const empty = {
    phase: WING_STAGE2_RECON_PHASE,
    precondition,
    targets: [] as WingStage2ReconTargetResult[],
    faults: [] as WingReconFault[],
    candidatesMeasured: 0,
    candidatesNotMeasured: 0,
    choiceControls: null,
    choiceControlFault: null,
  };
  if (precondition !== "OK") return empty;

  const raw: { targetId: string; matchCount: number; sig?: string }[] = [];
  const faults: WingReconFault[] = [];
  const probe = deps.probeCandidate;
  if (probe) {
    for (const spec of wingStage2ReconProbes(targets)) {
      try {
        const res = await probe({ candidateQuery: spec.candidateQuery, exactText: spec.exactText });
        raw.push({ targetId: spec.targetId, matchCount: res.matchCount, ...(res.sig ? { sig: res.sig } : {}) });
      } catch (e) {
        faults.push({ id: spec.targetId, fault: wingFaultFingerprint(e) });
      }
    }
  }
  let choiceControls: WingChoiceControlCensus | null = null;
  let choiceControlFault: WingFaultFingerprint | null = null;
  if (deps.choiceControlCensus) {
    try {
      choiceControls = await deps.choiceControlCensus();
    } catch (e) {
      choiceControlFault = wingFaultFingerprint(e);
    }
  }
  const folded = interpretWingStage2Recon(targets, raw);
  const all = folded.flatMap((t) => t.candidates);
  return {
    phase: WING_STAGE2_RECON_PHASE,
    precondition,
    targets: folded,
    faults,
    candidatesMeasured: all.filter((c) => c.verdict !== "NOT_MEASURED").length,
    candidatesNotMeasured: all.filter((c) => c.verdict === "NOT_MEASURED").length,
    choiceControls,
    choiceControlFault,
  };
}

/**
 * The candidate sweep: probe every candidate of every recon target through the SAME read-only seam the baseline
 * probe uses, then fold the reading with {@link interpretWingRecon}.
 *
 * A candidate whose probe THREW contributes NO row to the reading, so `interpretWingRecon` marks it
 * `NOT_MEASURED` with a null count — the one distinction that keeps a page which navigated mid-sweep from
 * reading as "these labels are confirmed absent". The fingerprint is recorded separately so the failure is
 * diagnosable without a raw message. A missing `probeCandidate` dep leaves every candidate `NOT_MEASURED`
 * rather than throwing: a recon run that could not measure must say so, not die and lose the baseline record.
 */
async function sweepReconCandidates(
  deps: WingSelectorRecordDeps,
  reconTargets: readonly WingReconTarget[],
): Promise<WingReconSweep> {
  const raw: { targetId: string; matchCount: number; sig?: string }[] = [];
  const faults: WingReconFault[] = [];
  const probe = deps.probeCandidate;
  if (probe) {
    for (const spec of wingReconProbes(reconTargets)) {
      try {
        const res = await probe({ candidateQuery: spec.candidateQuery, exactText: spec.exactText });
        raw.push({ targetId: spec.targetId, matchCount: res.matchCount, ...(res.sig ? { sig: res.sig } : {}) });
      } catch (e) {
        faults.push({ id: spec.targetId, fault: wingFaultFingerprint(e) });
      }
    }
  }
  const targets = interpretWingRecon(reconTargets, raw);
  const all = targets.flatMap((t) => t.candidates);
  return {
    phase: WING_LABEL_RECON_PHASE,
    targets,
    faults,
    candidatesMeasured: all.filter((c) => c.verdict !== "NOT_MEASURED").length,
    candidatesNotMeasured: all.filter((c) => c.verdict === "NOT_MEASURED").length,
  };
}


/* ────────────────────────────── STAGE-2 recon scope (a third, separate gate) ────────────────────────────── */

export const WING_STAGE2_REFUSALS = ["PHASE_APPROVAL_MISMATCH", "STAGE2_SCOPE_EMPTY", "STAGE2_TARGET_UNKNOWN"] as const;
export type WingStage2Refusal = (typeof WING_STAGE2_REFUSALS)[number];

/** Env var carrying the per-run Stage-2 scope. Its OWN name: a probe scope must never arm a Stage-2 sweep. */
export const WING_STAGE2_TARGETS_ENV = "SELLEROPS_WING_STAGE2_TARGETS" as const;

export type WingStage2ScopeResult =
  | { requested: false }
  | { requested: true; ok: true; targets: WingStage2ReconTarget[] }
  | { requested: true; ok: false; refusal: WingStage2Refusal; reason: string };

/**
 * The STAGE-2 gate. Same fail-closed shape as {@link resolveWingReconScope}, and separate from it for the same
 * reason that one is separate from the probe-scope gate: the phase is what the operator reads on the manifest.
 *
 * The both-directions check matters more here than anywhere else in this file. Without it, a Stage-2 manifest
 * whose phase failed to reach the run would fall through to an ORDINARY BASELINE PROBE — the run would measure
 * the three shipped labels on a Stage-2 screen, print a sanitized record, exit 0, and the operator would have
 * spent a live grant on a reading nobody asked for. Refusing on a one-sided phase makes that impossible.
 */
export function resolveWingStage2Scope(env: Record<string, string | undefined>): WingStage2ScopeResult {
  const own = (k: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(env, k)) return undefined;
    const v = (env as Record<string, unknown>)[k];
    return typeof v === "string" ? v : undefined;
  };
  // EXACT, un-trimmed — matching the recon gate and the shell allowlist that authorizes it.
  const runIsStage2 = (own(WING_APPROVAL_PHASE_ENV) ?? "") === WING_STAGE2_RECON_PHASE;
  const approvedIsStage2 = (own(WING_APPROVED_PHASE_ENV) ?? "") === WING_STAGE2_RECON_PHASE;
  if (!runIsStage2 && !approvedIsStage2) return { requested: false };
  if (runIsStage2 !== approvedIsStage2) {
    return {
      requested: true,
      ok: false,
      refusal: "PHASE_APPROVAL_MISMATCH",
      reason: runIsStage2
        ? `${WING_APPROVAL_PHASE_ENV} requests ${WING_STAGE2_RECON_PHASE} but ${WING_APPROVED_PHASE_ENV} does not — ` +
          "re-run the preflight so the approved phase is bound to this run (a phase left over from an earlier shell is not an approval)"
        : `${WING_APPROVED_PHASE_ENV} is ${WING_STAGE2_RECON_PHASE} but this run did not request it — ` +
          "use the command the preflight printed; without the phase this run would measure the shipped labels on the Stage-2 screen",
    };
  }
  const resolved = resolveWingStage2ReconScope(own(WING_STAGE2_TARGETS_ENV));
  if (!resolved.ok) {
    return { requested: true, ok: false, refusal: "STAGE2_TARGET_UNKNOWN", reason: resolved.reason };
  }
  if (resolved.targets.length === 0) {
    return { requested: true, ok: false, refusal: "STAGE2_SCOPE_EMPTY", reason: "the Stage-2 scope resolved to no targets" };
  }
  return { requested: true, ok: true, targets: resolved.targets };
}

export function stage2RefusalMessage(refusal: WingStage2Refusal, reason: string): string {
  return (
    `Refusing to launch: WING Stage-2 recon scope is not approved (${refusal}). ${reason}. ` +
    "Re-bootstrap with the Stage-2 phase, then use the command the preflight prints. No browser launched."
  );
}

/* ────────────────────────────── candidate-label RECON scope (a second, narrower gate) ────────────────────── */

/**
 * The approval phase that turns this recorder into a candidate-label RECON pass. It is NOT a flag: the phase is
 * the field the operator reads on the manifest, so deriving the mode from anything else would let the run do
 * something the displayed manifest never described. `tools/coupang-local/wing-probe-preflight.sh` prints it
 * inline on the run command for exactly this phase and no other.
 */
export const WING_LABEL_RECON_PHASE = "COUPANG_WING_LABEL_RECON" as const;
/**
 * The approval phase that turns this recorder into a STAGE-2 recon pass. A separate phase for the same reason
 * the label recon is: the manifest is what the operator reads, and "sweep candidates on the screen you reach by
 * pressing 발급" is different work from "sweep candidates on the page you land on" — different enough that the
 * operator is being asked to press a real marketplace control before signalling ready.
 */
export const WING_STAGE2_RECON_PHASE = "COUPANG_WING_STAGE2_RECON" as const;
// The two phase env vars are DEFINED in the pure classifier leaf (the WING action CLIs need them without
// importing this recorder) and re-exported here, where the recon gate reads them. Two variables, for the same
// reason there are two scope variables: review found the one-variable design broken in both directions — a stale
// `SELLEROPS_APPROVAL_PHASE=COUPANG_WING_LABEL_RECON` from an earlier shell would arm a 12-hypothesis sweep
// under a manifest approved for the three SHIPPED labels, and a recon manifest run without the phase the
// preflight printed would quietly measure the baselines. The scope gate sees neither: the target set is identical.
export { WING_APPROVAL_PHASE_ENV, WING_APPROVED_PHASE_ENV };

/** Closed set of reasons a RECON pass is refused. Baseline probing is unaffected by these. */
export const WING_RECON_REFUSALS = [
  "RECON_TARGET_NOT_APPROVED",
  "RECON_SCOPE_EMPTY",
  "PHASE_APPROVAL_MISMATCH",
] as const;
export type WingReconRefusal = (typeof WING_RECON_REFUSALS)[number];

export type WingReconScopeResult =
  | { requested: false }
  | { requested: true; ok: true; targets: WingReconTarget[] }
  | { requested: true; ok: false; refusal: WingReconRefusal; reason: string };

/**
 * The RECON gate, layered on top of (never instead of) the approved-scope gate.
 *
 * Recon sweeps CANDIDATE labels — several unvalidated hypotheses per target — which is a materially different
 * operation from measuring the shipped baselines, so it is gated on the approved PHASE rather than inferred.
 * Two rules, both fail-closed:
 *
 *   1. Recon runs only under {@link WING_LABEL_RECON_PHASE}. Any other phase (or none) ⇒ `requested: false`,
 *      and the recorder behaves exactly as it did before recon existed.
 *   2. Under that phase EVERY approved target must be a recon target. Not "the intersection" — the whole
 *      approved set. A run approved for `self_dev,delete` would otherwise sweep candidates for one target while
 *      the manifest described a set the sweep does not cover, so the operator could not tell from the manifest
 *      what would be measured. Refusing keeps `approved scope == swept scope` a readable identity.
 *
 * Pure: no I/O, no clock, no process state. What it does NOT prove is the same limit the scope gate states —
 * a deliberate operator can hand-type the phase. It closes accidental drift, not intent.
 */
export function resolveWingReconScope(
  env: Record<string, string | undefined>,
  approved: readonly WingRecordTarget[],
): WingReconScopeResult {
  // OWN properties + strings only, matching `resolveGatedWingProbeScope`: an inherited key must not arm recon.
  const own = (k: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(env, k)) return undefined;
    const v = (env as Record<string, unknown>)[k];
    return typeof v === "string" ? v : undefined;
  };
  // EXACT match, deliberately un-trimmed. `wing-probe-bootstrap.sh` and the preflight both use an exact `case`
  // allowlist, so a trimming runner would accept phase spellings the harness that authorizes it would refuse —
  // the runner must never be more permissive about its own authorization than the gate that grants it.
  const runPhase = own(WING_APPROVAL_PHASE_ENV) ?? "";
  const approvedPhase = own(WING_APPROVED_PHASE_ENV) ?? "";
  const runIsRecon = runPhase === WING_LABEL_RECON_PHASE;
  const approvedIsRecon = approvedPhase === WING_LABEL_RECON_PHASE;

  // Neither side claims recon ⇒ an ordinary baseline probe, exactly as before recon existed.
  if (!runIsRecon && !approvedIsRecon) return { requested: false };
  // Exactly one side claims it ⇒ the run and the approved manifest describe different work. Refuse both ways:
  // running a sweep the manifest did not authorize, and running a baseline under a manifest that promised one.
  if (runIsRecon !== approvedIsRecon) {
    return {
      requested: true,
      ok: false,
      refusal: "PHASE_APPROVAL_MISMATCH",
      reason: runIsRecon
        ? `${WING_APPROVAL_PHASE_ENV} requests ${WING_LABEL_RECON_PHASE} but ${WING_APPROVED_PHASE_ENV} does not — ` +
          "re-run the preflight so the approved phase is bound to this run (a phase left over from an earlier shell is not an approval)"
        : `${WING_APPROVED_PHASE_ENV} is ${WING_LABEL_RECON_PHASE} but this run did not request it — ` +
          "use the command the preflight printed; without the phase this run would measure the shipped labels, not the candidates",
    };
  }

  if (approved.length === 0) {
    return {
      requested: true,
      ok: false,
      refusal: "RECON_SCOPE_EMPTY",
      reason: `the approved scope is empty — ${WING_LABEL_RECON_PHASE} sweeps candidates for approved targets and has none`,
    };
  }
  const offending = approved.filter((t) => !isWingReconTarget(t));
  if (offending.length > 0) {
    // Echo only names this module can vouch for. `approved` normally arrives from the scope gate already
    // filtered to `WING_PROBE_TARGET_NAMES`, but as an exported pure function it can be handed anything, and
    // this reason reaches stderr — so an unrecognized token is reported as a COUNT, never printed back.
    const known = offending.filter((t) => (WING_PROBE_TARGET_NAMES as readonly string[]).includes(t));
    const unknownCount = offending.length - known.length;
    const named = known.length > 0 ? known.join(", ") : "none";
    return {
      requested: true,
      ok: false,
      refusal: "RECON_TARGET_NOT_APPROVED",
      reason:
        `${WING_LABEL_RECON_PHASE} requires every approved target to be a recon target — ` +
        `non-recon target(s): ${named}; unrecognized token(s): ${unknownCount}`,
    };
  }
  // Every element passed `isWingReconTarget`, so the narrowing is sound; order follows the approved scope.
  return { requested: true, ok: true, targets: approved.filter(isWingReconTarget) };
}

/** The operator-facing recon refusal line. Pure + exported so a test can prove no raw env value reaches it. */
export function reconRefusalMessage(refusal: WingReconRefusal, reason: string): string {
  return (
    `Refusing to launch: WING candidate-label recon scope is not approved (${refusal}). ${reason}. ` +
    "Re-bootstrap with the recon phase and scope, then use the command the preflight prints. No browser launched."
  );
}

/** One candidate row as the sanitized record prints it. Every field is a count, a boolean, or OUR OWN constant. */
export interface WingReconRecordRow {
  id: string;
  /** Our own fixed candidate label — never scraped page content. */
  label: string;
  /** The target's coarse EXPECTED role (a recorder constant, not a live element read). */
  expectedRole: string;
  matchCount: number | null;
  verdict: string;
  /** `matchCount === 1`. Stated explicitly because "would this label be highlightable" is the question asked. */
  canHighlight: boolean;
  sig16: string | null;
}

/**
 * Shape the sweep for the printed record: flatten to candidate rows and add the two per-target constants the
 * fold does not carry (expected role, and the highlightability the UNIQUE verdict already implies). Pure and
 * exported so a test can prove the printed shape carries nothing beyond counts, booleans, and our own strings.
 *
 * `canHighlight` is derived from the VERDICT, not from a separate count comparison: `NOT_MEASURED` therefore
 * yields `false` without ever claiming a count it does not have.
 */
export function reconRecordFor(sweep: WingReconSweep | null): {
  phase: string;
  targets: { target: string; resolvedUnambiguously: boolean; uniqueCandidateIds: readonly string[]; candidates: WingReconRecordRow[] }[];
  faults: WingReconFault[];
  candidatesMeasured: number;
  candidatesNotMeasured: number;
} | null {
  if (!sweep) return null;
  return {
    phase: sweep.phase,
    targets: sweep.targets.map((t) => ({
      target: t.target,
      resolvedUnambiguously: t.resolvedUnambiguously,
      uniqueCandidateIds: t.uniqueCandidateIds,
      candidates: t.candidates.map((c): WingReconRecordRow => ({
        id: c.id,
        label: c.label,
        expectedRole: WING_TARGET_EXPECTED_ROLE[t.target],
        matchCount: c.matchCount,
        verdict: c.verdict,
        canHighlight: c.verdict === "UNIQUE",
        sig16: c.sig16,
      })),
    })),
    faults: sweep.faults,
    candidatesMeasured: sweep.candidatesMeasured,
    candidatesNotMeasured: sweep.candidatesNotMeasured,
  };
}

/**
 * The exact targets the recorder will measure, given the gate's APPROVED set. Extracted (and exported) so the
 * one line standing between "approved" and "measured" is directly unit-testable: an in-place edit here — say
 * back to the full fixed set — is the whole failure this gate exists to prevent, and a source guard cannot
 * see it. Order-stable; never adds a target the gate did not return.
 */
export function scopedRecordTargetsFor(approved: readonly WingRecordTarget[]): WingRecordTarget[] {
  return WING_RECORD_TARGETS.filter((t) => approved.includes(t));
}

/**
 * The operator-facing refusal line. Pure + exported so a test can prove no raw env value reaches it: the only
 * inputs are the closed refusal enum and the gate's own reason, which reports COUNTS for unrecognized tokens.
 */
export function scopeRefusalMessage(refusal: WingProbeScopeRefusal, reason: string): string {
  return (
    `Refusing to launch: WING probe scope is not approved (${refusal}). ${reason}. ` +
    "Prepare the run with tools/coupang-local/wing-probe-preflight.sh and use the command it prints. No browser launched."
  );
}

/* ────────────────────────────── sentinels + live wiring (inert on import) ────────────────────────────── */

/** Readiness sentinel filename (cleared at startup + after use). */
export const RECORD_SENTINEL_FILENAME = "probe-wing-issuance-selectors.ready";
/** Operator abort sentinel filename (ends the session, writes the empty sanitized record). */
export const RECORD_ABORT_FILENAME = "probe-wing-issuance-selectors.abort";

export function recordSentinelPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), RECORD_SENTINEL_FILENAME);
}
export function recordAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), RECORD_ABORT_FILENAME);
}

const SENTINEL_POLL_MS = 1_000;
const RECORD_WAIT_TIMEOUT_MS = 20 * 60_000; // generous budget for a manual login + navigate to the issuance page

function mintRunId(): string {
  return `wingrec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

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

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE Coupang WING READ-ONLY selector/structure recorder — explicit per-run approval required.");
  console.error(" It measures ONLY how many candidates each target's fixed WING label matches (a count), whether");
  console.error(" it resolves uniquely, and an opaque 16-hex structural signature. It never highlights, tags,");
  console.error(" clicks, types, submits, issues a key, or reads any value (incl. Access Key / Secret Key / 업체코드).");
  console.error(" The SELLER navigates MANUALLY to the open-API issuance page, then signals ready. Output is a");
  console.error(" sanitized calibration record — no selector, value, PII, raw DOM/HTML, screenshot, or raw URL.");
  console.error(line);
}

/**
 * Stage-2 instructions. Separate copy, because the operator is being asked to take a REAL marketplace action
 * before signalling ready — and the one thing they must not do (press 확인) is on the screen they are opening.
 */
function printStage2Instructions(readyPath: string, abortPath: string): void {
  console.error("");
  console.error("WING Stage-2 recon: reach the purpose-selection screen YOURSELF in the opened window.");
  console.error("  1) Log in and reach the open-API 키 발급 page (nothing on WING is clicked for you).");
  console.error("  2) Press 'API Key 발급 받기' YOURSELF. SellerOps does not press it and never will.");
  console.error("  3) STOP on the purpose screen. Choose nothing. Type nothing. Do NOT press '확인'.");
  console.error('  4) With that screen still open, signal readiness by creating this file (or say "ready"):');
  console.error(`       ${readyPath}`);
  console.error(`     To abort the session, create: ${abortPath}  (or press Ctrl+C).`);
  console.error("  Polling… (read-only — nothing is highlighted, selected, clicked, or navigated)");
}

function printInstructions(readyPath: string, abortPath: string): void {
  console.error("");
  console.error("WING selector recorder: navigate MANUALLY to the open-API 키 발급 page in the opened window.");
  console.error("  1) Log in and reach the open-API issuance page yourself (nothing on WING is clicked for you).");
  console.error('  2) Signal readiness by creating this file (or say "ready"):');
  console.error(`       ${readyPath}`);
  console.error(`     To abort the session, create: ${abortPath}  (or press Ctrl+C).`);
  console.error("  Polling… (read-only — nothing is highlighted, clicked, or navigated)");
}

/**
 * Live entry (gated). NOT run during offline build/verify. Opens the seller's window ONCE, NEVER navigates it,
 * waits for the operator's ready signal, records each candidate's fixed-label matchCount + sig read-only, prints
 * ONLY the sanitized calibration record, and always closes. Never highlights, tags, clicks, or reads a value.
 */
async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  // Public WING host is not a secret: default to the WING root, or take an explicit `--url <u>` / positional /
  // COUPANG_WING_URL. The operator logs in + navigates to the target screen themselves (this recorder never
  // `.goto`s). Fail closed BEFORE launching Chrome: reject placeholders, unparseable URLs, and off-target hosts.
  // The raw URL is never printed — only a reason enum + host category.
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

  // The STAGE-2 gate runs FIRST, before the baseline probe scope, because it decides whether a baseline probe
  // should happen at all. A Stage-2 run measures Stage-2 candidates and the shape census and NOTHING ELSE: the
  // shipped locators have no meaning on that screen, and probing them there would be page interaction the
  // manifest never described.
  const stage2Scope = resolveWingStage2Scope(process.env);
  if (stage2Scope.requested && !stage2Scope.ok) {
    console.error(stage2RefusalMessage(stage2Scope.refusal, stage2Scope.reason));
    process.exitCode = 2;
    return;
  }
  const stage2Targets = stage2Scope.requested && stage2Scope.ok ? stage2Scope.targets : [];
  const isStage2Run = stage2Targets.length > 0;

  // The per-run TARGET scope, gated BEFORE Chrome launches (it used to be resolved after, inside the run).
  // A live run never defaults to the full target set: both the requested scope and the preflight-bound
  // APPROVED scope must be explicit, canonical, and equal, so neither a forgotten export nor a hand-typed
  // command can widen past what the operator saw. (What a refusal prints is described at the branch below.)
  // …and SKIPPED entirely on a Stage-2 run, which has no baseline targets to scope. Skipping a gate is only
  // safe because the gate above is strict in both directions: `isStage2Run` is true only when the requested
  // phase AND the preflight-bound approved phase both name the Stage-2 phase exactly.
  const probeScope = isStage2Run ? ({ ok: true, targets: [] } as const) : resolveGatedWingProbeScope(process.env);
  if (!probeScope.ok) {
    // stderr only, and only the closed enum + the gate's own token-free reason — the raw env value may hold
    // whatever the operator mistyped. stdout stays reserved for the sanitized calibration record.
    console.error(scopeRefusalMessage(probeScope.refusal, probeScope.reason));
    process.exitCode = 2;
    return;
  }
  const scopedTargets = scopedRecordTargetsFor(probeScope.targets);

  // The SECOND gate, also before Chrome launches. Recon sweeps candidate hypotheses rather than the shipped
  // baselines, so it runs only under its own approved phase and only when the whole approved scope is
  // sweepable. A refusal here stops the run outright rather than silently downgrading to a baseline probe —
  // the operator approved a recon manifest, and quietly measuring something else is the failure this prevents.
  const reconScope = resolveWingReconScope(process.env, probeScope.targets);
  if (reconScope.requested && !reconScope.ok) {
    console.error(reconRefusalMessage(reconScope.refusal, reconScope.reason));
    process.exitCode = 2;
    return;
  }
  const reconTargets = reconScope.requested && reconScope.ok ? reconScope.targets : [];
  // Belt and braces: the two sweeps are mutually exclusive by phase, and a future edit that let both arm would
  // run twelve initial-surface hypotheses against a Stage-2 screen. The phases cannot both match, so this can
  // only fire on a code change — which is exactly when it should.
  if (isStage2Run && reconTargets.length > 0) {
    console.error(stage2RefusalMessage("PHASE_APPROVAL_MISMATCH", "a run cannot be both a label recon and a Stage-2 recon"));
    process.exitCode = 2;
    return;
  }

  const cfg = loadConfig();
  const runId = mintRunId();
  const readyPath = recordSentinelPathFor(cfg.statusFile);
  const abortPath = recordAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(readyPath), { recursive: true });
  removeSentinel(readyPath);
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The driver reads the NEWEST tab (context injected) — wherever the seller navigated. The recorder never drives it.
  const entry = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  const driver = new CoupangWingIssuanceDriver(entry, { context: ctx });

  const deps: WingSelectorRecordDeps = {
    waitForReady: async () => {
      removeSentinel(readyPath);
      const maxTicks = Math.ceil(RECORD_WAIT_TIMEOUT_MS / SENTINEL_POLL_MS);
      for (let i = 0; i < maxTicks; i++) {
        if (abortFlag.v || existsSync(abortPath)) return "abort";
        if (existsSync(readyPath)) return "ready";
        await sleep(SENTINEL_POLL_MS);
      }
      return "timeout";
    },
    observeSurface: () => driver.observeSurface(),
    probeTarget: (target) => driver.probeFixedLabelMatch(wingRecordLabelSpec(target)),
    // The recon sweep's ONLY page interaction — literally the same driver call as `probeTarget`, differing
    // solely in which fixed label it counts. No new in-page script, no new read, no new mutation.
    probeCandidate: (spec) => driver.probeFixedLabelMatch(spec),
    // The Stage-2 shape census: ONE additional read-only in-page evaluation, of an audited constant script that
    // returns closed-vocabulary categories and integers. Re-sanitized host-side so the record's vocabulary is
    // guaranteed by code the page cannot influence.
    choiceControlCensus: () => driver.choiceControlCensus(),
    announce: () => isStage2Run ? printStage2Instructions(readyPath, abortPath) : printInstructions(readyPath, abortPath),
  };

  try {
    // `scopedTargets` was fixed by the approved-scope gate above, before the browser launched; `reconTargets`
    // is empty unless the recon phase gate armed it against that same approved scope.
    const result = await runWingSelectorRecord(deps, scopedTargets, { recon: reconTargets, stage2: stage2Targets });
    console.error("");
    console.error("WING selector recorder complete. 이제 SellerOps 탭으로 직접 돌아가세요.");
    // SANITIZED calibration record → stdout. Integers/booleans/fixed-labels/roles/opaque sigs + the sanitized
    // observation only — never a selector, value, PII, raw DOM/HTML, screenshot, or raw URL.
    console.log(
      JSON.stringify(
        {
          runId,
          urlCategory: screen.urlCategory,
          probeTargets: scopedTargets,
          aborted: result.aborted,
          uniqueCandidates: result.uniqueCandidates,
          nonUniqueCandidates: result.nonUniqueCandidates,
          calibration: result.calibration,
          // The machine-checkable issued-state verdict. Without it on the wire the operator cannot see the one
          // field a post-delete calibration is run to obtain — the record would carry the raw signals but not
          // the answer derived from them.
          issuedState: result.issuedState,
          observation: result.observation,
          targets: result.targets,
          // Null on an ordinary baseline run. On a recon run: per-candidate ids, OUR OWN fixed candidate
          // labels, integer counts, closed verdicts, and opaque sigs — the same value-free classes the
          // baseline rows already carry.
          recon: reconRecordFor(result.recon),
        },
        null,
        2,
      ),
    );
    log("aw_coupang_selector_record_done", {
      runId,
      urlCategory: screen.urlCategory,
      aborted: result.aborted,
      uniqueCandidates: result.uniqueCandidates,
      nonUniqueCandidates: result.nonUniqueCandidates,
      issuedState: result.issuedState.state,
      issuedStateReason: result.issuedState.reason,
      reconCandidatesMeasured: result.recon?.candidatesMeasured ?? 0,
      reconCandidatesNotMeasured: result.recon?.candidatesNotMeasured ?? 0,
      reconTargetsResolved: result.recon?.targets.filter((t) => t.resolvedUnambiguously).length ?? 0,
    });
  } finally {
    removeSentinel(readyPath);
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_selector_record_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
