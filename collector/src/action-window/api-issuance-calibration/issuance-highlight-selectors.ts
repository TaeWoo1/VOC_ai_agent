/**
 * **CALIBRATED Phase-B highlight-target locators — the issuance driver's REAL fixed-label selectors.**
 *
 * The `NaverIssuanceDriver` (Phase B — `API_ISSUANCE_HIGHLIGHT_PROOF`) must highlight the ONE real API-center
 * control to press next. Its original {@link CANDIDATE_TARGET_SELECTORS} were synthetic `[data-aw-target=…]`
 * fixtures that never match live NAVER (so every live highlight parked `target_not_found`). This module is the
 * calibrated replacement: for each highlightable target it carries a FIXED-LABEL locator — a STRUCTURAL
 * candidate query plus a FIXED NAVER UI label (e.g. "애플리케이션 등록") — never an application name, a
 * credential value, or a bare coordinate. NAVER's API-center controls expose NO aria-label / id / name (the
 * run-#3 census proved it), so a fixed *label* is the only stable, value-free way to resolve them.
 *
 * **Single source of truth (no drift).** The three live-confirmed locators are DERIVED from the visual-recon
 * adopted set ({@link ADOPTED_TARGET_IDS} / {@link VISUAL_RECON_LABEL_PROBES}) — the same `candidateQuery` +
 * `exactText` that was measured at `matchCount===1` on the real API center (runs #4/#5/#6). A locator can never
 * drift from the evidence that justified it, and {@link evaluateIssuanceHighlightSelectors} re-scores each one
 * through the FROZEN {@link evaluateSelectorCandidate} adoption gate.
 *
 * **SCOPE BOUNDARIES — deliberately honest.**
 *   - **`return` is NOT a highlight target — it is terminal text guidance only** ("SellerOps 탭으로
 *     돌아가세요"), exactly as the Phase-A calibrator excludes `return_path`. It appears in
 *     {@link ISSUANCE_GUIDANCE_ONLY_TARGETS}, never in {@link ISSUANCE_HIGHLIGHT_TARGETS}.
 *   - **`open_app` is NOT a highlight target either — it is NAVIGATION guidance.** Opening a *specific*
 *     existing application means acting on that app's own row, whose NAME is user data, so no fixed label and
 *     no value-free structural anchor resolves it uniquely (a live probe measured a broad row anchor at 44
 *     matches). Rather than highlight a guessed row, the existing-app step shows text guidance ("연결할
 *     애플리케이션을 직접 열어주세요") and the driver OBSERVES the seller's own `app_list → app_detail`
 *     navigation. It is a {@link ISSUANCE_NAVIGATION_TARGET}: guidance + observed transition, never a
 *     highlighted control. Once the detail page is reached, the walk reuses the calibrated `api_group` /
 *     `credentials` fixed-label highlights — so BOTH onboarding paths are `ready_candidate`.
 *   - **These are the driver's fixed-label locators — the `SELECTORS_CALIBRATED` flag is owned by
 *     `api-center-adapter`, not here.** That flag is `true`: the three live_confirmed targets were live-probed
 *     at `matchCount===1` by the read-only `API_ISSUANCE_SELECTOR_PROBE` phase (twice), and they are the only
 *     highlighted controls on either path. This module never reads or writes the flag.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import { evaluateSelectorCandidate, type SelectorCandidate, type SelectorRejectReason, type VisualReconScreen } from "./visual-recon";
import { VISUAL_RECON_CANDIDATES, VISUAL_RECON_LABEL_PROBES, type FixedLabelProbe, type VisualReconTargetId } from "./visual-recon-candidates";
import { ADOPTED_TARGET_IDS } from "./visual-recon-adopted";
import type { IssuanceTarget } from "../api-issuance/issuance-driver";

/**
 * The issuance targets that are a REAL, highlightable API-center control. `open_app` is deliberately NOT here:
 * an existing app is opened by NAVIGATION guidance (see {@link ISSUANCE_NAVIGATION_TARGETS}), and `return` is
 * terminal text guidance, so the only highlighted controls are the three fixed-label ones below.
 */
export const ISSUANCE_HIGHLIGHT_TARGETS = ["create_app", "api_group", "credentials"] as const satisfies readonly IssuanceTarget[];
export type IssuanceHighlightTarget = (typeof ISSUANCE_HIGHLIGHT_TARGETS)[number];

/**
 * The issuance targets that are TEXT guidance only — never located/highlighted on the NAVER page. `open_app`
 * (existing-app step 2) and `return` (final step) both show guidance copy instead of a highlighted control.
 */
export const ISSUANCE_GUIDANCE_ONLY_TARGETS = ["open_app", "return"] as const satisfies readonly IssuanceTarget[];

/**
 * The guidance target whose completion is an OBSERVED NAVIGATION rather than an auto-complete: `open_app`. The
 * seller opens their existing application themselves (`app_list → app_detail`); the driver shows guidance,
 * observes the transition, and the engine verifies the seller reached the detail page before advancing. (This
 * is what distinguishes it from `return`, whose guidance is a SellerOps-side action that auto-completes.)
 */
export const ISSUANCE_NAVIGATION_TARGETS = ["open_app"] as const satisfies readonly IssuanceTarget[];

export function isIssuanceHighlightTarget(target: IssuanceTarget): target is IssuanceHighlightTarget {
  return (ISSUANCE_HIGHLIGHT_TARGETS as readonly IssuanceTarget[]).includes(target);
}

/** Whether a target is opened by observed `app_list → app_detail` navigation guidance (only `open_app`). */
export function isIssuanceNavigationTarget(target: IssuanceTarget): boolean {
  return (ISSUANCE_NAVIGATION_TARGETS as readonly IssuanceTarget[]).includes(target);
}

/** The two onboarding paths a walk takes at step 2 (an existing app is opened; an absent one is created). */
export type IssuancePath = "new_app" | "existing_app";

export type TargetCalibrationStatus =
  /** A fixed-label locator that derives from a visual-recon adopted target; live `matchCount===1` (runs #4/#5/#6). */
  "live_confirmed";

/**
 * A fixed-label locator: a STRUCTURAL candidate query (a plain `querySelectorAll` — no user data) plus a FIXED
 * NAVER UI label the driver matches by accessible name. It carries NO application name, NO credential value, and
 * NO coordinate. Identical shape to {@link FixedLabelProbe}'s query+text so the driver and the read-only probe
 * measure the exact same thing.
 */
export interface IssuanceFixedLabelLocator {
  candidateQuery: string;
  exactText: string;
}

export interface IssuanceTargetSelectorSpec {
  target: IssuanceHighlightTarget;
  screen: VisualReconScreen;
  /** Which onboarding path(s) reach this target. */
  paths: readonly IssuancePath[];
  status: TargetCalibrationStatus;
  /** The visual-recon adopted target this fixed-label locator derives from (single source of truth). */
  derivesFrom: VisualReconTargetId;
  /** The fixed-label locator (structural candidate query + a fixed NAVER label). */
  locator: IssuanceFixedLabelLocator;
}

/**
 * Which visual-recon adopted target each highlight target DERIVES from. Every highlight target has one — the
 * existing-app open step is not here because it is NAVIGATION guidance, not a highlighted control.
 */
const DERIVES_FROM: Readonly<Record<IssuanceHighlightTarget, VisualReconTargetId>> = {
  create_app: "app_list.register_application", // 애플리케이션 등록 (register button) — #4/#5
  api_group: "api_group.section", // API 그룹 (section heading) — #4/#5
  credentials: "credentials.application_id_label", // 애플리케이션 ID (credential section label) — #4/#5
};

/**
 * Which onboarding path(s) reach each highlight target. `api_group` / `credentials` are reached on BOTH paths
 * (they follow both create-app and open-app at step 2); `create_app` is the new-app branch only.
 */
const TARGET_PATHS: Readonly<Record<IssuanceHighlightTarget, readonly IssuancePath[]>> = {
  create_app: ["new_app"],
  api_group: ["new_app", "existing_app"],
  credentials: ["new_app", "existing_app"],
};

/** The screen each highlight target sits on (mirrors the visual-recon checkpoints). */
const TARGET_SCREEN: Readonly<Record<IssuanceHighlightTarget, VisualReconScreen>> = {
  create_app: "app_list",
  api_group: "api_group",
  credentials: "credentials",
};

/** The fixed-label probe for an adopted target — the single source the locator's query+text is reused from. */
function probeFor(id: VisualReconTargetId): FixedLabelProbe {
  const p = VISUAL_RECON_LABEL_PROBES.find((x) => x.targetId === id);
  if (!p) throw new Error(`issuance-highlight-selectors: no fixed-label probe for adopted target ${id}`);
  return p;
}

/**
 * The calibrated highlight-target selectors. For each target the locator's `candidateQuery` + `exactText` are
 * REUSED verbatim from the adopted target's fixed-label probe (so an issuance locator can never drift from the
 * live evidence). `open_app` is absent: it is NAVIGATION guidance, not a highlighted control.
 */
export const ISSUANCE_TARGET_SELECTORS: readonly IssuanceTargetSelectorSpec[] = ISSUANCE_HIGHLIGHT_TARGETS.map((target) => {
  const derivesFrom = DERIVES_FROM[target];
  // Anti-drift: a live_confirmed target MUST derive from an ADOPTED (live matchCount=1) visual-recon target.
  if (!(ADOPTED_TARGET_IDS as readonly VisualReconTargetId[]).includes(derivesFrom)) {
    throw new Error(`issuance-highlight-selectors: ${target} derives from a non-adopted target ${derivesFrom}`);
  }
  const probe = probeFor(derivesFrom);
  return {
    target,
    screen: TARGET_SCREEN[target],
    paths: TARGET_PATHS[target],
    status: "live_confirmed",
    derivesFrom,
    locator: { candidateQuery: probe.candidateQuery, exactText: probe.exactText },
  };
});

/** Look up one highlight target's spec (throws if a non-highlight target — `open_app` / `return` — is passed). */
export function selectorSpecFor(target: IssuanceHighlightTarget): IssuanceTargetSelectorSpec {
  const spec = ISSUANCE_TARGET_SELECTORS.find((s) => s.target === target);
  if (!spec) throw new Error(`issuance-highlight-selectors: no spec for ${target}`);
  return spec;
}

/** The fixed-label locator for a highlight target. */
export function locatorFor(target: IssuanceHighlightTarget): IssuanceFixedLabelLocator {
  return selectorSpecFor(target).locator;
}

/**
 * Whether the GUIDED highlight walk (the live `NaverIssuanceDriver` Action Window) may highlight this target.
 * Every highlight target is `live_confirmed` (calibrated), so all three qualify; the existing-app open step is
 * not a highlight target at all (it is NAVIGATION guidance), so it never reaches this gate. Kept as an explicit
 * status check so a future non-calibrated highlight target would fail closed rather than be highlighted blind.
 */
export function isGuidedHighlightTarget(target: IssuanceHighlightTarget): boolean {
  return selectorSpecFor(target).status === "live_confirmed";
}

export type PathReadiness = "ready_candidate" | "not_ready";

/**
 * Whether an onboarding path is ready to guide. `ready_candidate` (never a bare "ready") because the
 * end-to-end Phase-B highlight PROOF — highlighting + observing the operator's own click on a live store — has
 * not yet run; the read-only `API_ISSUANCE_SELECTOR_PROBE` has live-confirmed the fixed-label targets'
 * matchCount=1 (twice) and `SELECTORS_CALIBRATED` is flipped, but the guided walk itself is the last step.
 *   - `new_app` (create_app → api_group → credentials): all highlight targets live_confirmed ⇒ `ready_candidate`.
 *   - `existing_app` (open_app → api_group → credentials): `open_app` is NAVIGATION guidance (no highlight to
 *     calibrate); its two highlight targets (api_group, credentials) are live_confirmed ⇒ `ready_candidate`.
 * A path is `ready_candidate` only when every highlight target it reaches is live_confirmed.
 */
export function issuancePathReadiness(path: IssuancePath): PathReadiness {
  const targets = ISSUANCE_TARGET_SELECTORS.filter((s) => s.paths.includes(path));
  return targets.length > 0 && targets.every((s) => s.status === "live_confirmed") ? "ready_candidate" : "not_ready";
}

export interface IssuanceSelectorEvaluation {
  target: IssuanceHighlightTarget;
  status: TargetCalibrationStatus;
  /** Whether the adopted fixed-label passes the frozen gate at matchCount=1. */
  adoptable: boolean;
  reasons: SelectorRejectReason[];
}

/**
 * Re-score every calibrated target through the FROZEN {@link evaluateSelectorCandidate} gate, using the ADOPTED
 * selector string + its live `matchCount===1`. This proves each live_confirmed locator is legitimate by the
 * SAME rules the visual-recon adoption used (fixed-label, unique, not account/credential/position/value bound).
 */
export function evaluateIssuanceHighlightSelectors(): IssuanceSelectorEvaluation[] {
  return ISSUANCE_TARGET_SELECTORS.map((spec) => {
    const proposal = VISUAL_RECON_CANDIDATES.find((c) => c.targetId === spec.derivesFrom);
    if (!proposal) throw new Error(`issuance-highlight-selectors: no candidate proposal for ${spec.derivesFrom}`);
    const measured: SelectorCandidate = { ...proposal.candidate, matchCount: 1 }; // live matchCount=1 (adopted)
    const { adoptable, reasons } = evaluateSelectorCandidate(measured);
    return { target: spec.target, status: spec.status, adoptable, reasons };
  });
}
