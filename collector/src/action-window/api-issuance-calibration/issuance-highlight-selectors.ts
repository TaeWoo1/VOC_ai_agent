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
 * **SCOPE BOUNDARIES — deliberately honest, deliberately incomplete.**
 *   - **`return` is NOT a highlight target.** Returning to SellerOps is not a NAVER control; it is text
 *     guidance only ("SellerOps 탭으로 돌아가세요"), exactly as the Phase-A calibrator excludes `return_path`.
 *     It appears in {@link ISSUANCE_GUIDANCE_ONLY_TARGETS}, never in {@link ISSUANCE_HIGHLIGHT_TARGETS}.
 *   - **`open_app` is UNCALIBRATED.** Opening a *specific* existing application means acting on that app's own
 *     row/name — which is user data, so no FIXED label resolves it, and it was never measured live. It carries
 *     `status: "no_fixed_label"` and NO locator, so the EXISTING-app path is `not_ready` while the NEW-app path
 *     is `ready_candidate` (see {@link issuancePathReadiness}). That readiness split is the point, not a gap.
 *   - **These are Playwright fixed-label locators for the driver — NOT the same thing as flipping
 *     `SELECTORS_CALIBRATED`.** That flag additionally requires the driver's OWN locate+tag+overlay mechanism
 *     to be live-probed (the read-only `API_ISSUANCE_SELECTOR_PROBE` phase) and `open_app` calibrated. It stays
 *     `false`; this module never touches it.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import { evaluateSelectorCandidate, type SelectorCandidate, type SelectorRejectReason, type VisualReconScreen } from "./visual-recon";
import { VISUAL_RECON_CANDIDATES, VISUAL_RECON_LABEL_PROBES, type FixedLabelProbe, type VisualReconTargetId } from "./visual-recon-candidates";
import { ADOPTED_TARGET_IDS } from "./visual-recon-adopted";
import type { IssuanceTarget } from "../api-issuance/issuance-driver";

/** The issuance targets that are a REAL, highlightable API-center control (everything except `return`). */
export const ISSUANCE_HIGHLIGHT_TARGETS = ["create_app", "open_app", "api_group", "credentials"] as const satisfies readonly IssuanceTarget[];
export type IssuanceHighlightTarget = (typeof ISSUANCE_HIGHLIGHT_TARGETS)[number];

/** The issuance targets that are TEXT guidance only — never located/highlighted on the NAVER page. */
export const ISSUANCE_GUIDANCE_ONLY_TARGETS = ["return"] as const satisfies readonly IssuanceTarget[];

export function isIssuanceHighlightTarget(target: IssuanceTarget): target is IssuanceHighlightTarget {
  return (ISSUANCE_HIGHLIGHT_TARGETS as readonly IssuanceTarget[]).includes(target);
}

/** The two onboarding paths a walk takes at step 2 (an existing app is opened; an absent one is created). */
export type IssuancePath = "new_app" | "existing_app";

export type TargetCalibrationStatus =
  /** Derives from a visual-recon adopted fixed-label; live `matchCount===1` (runs #4/#5/#6). */
  | "live_confirmed"
  /** No FIXED NAVER label resolves it without depending on an application's identity — never measured live. */
  | "no_fixed_label";

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
  /** The visual-recon adopted target this locator derives from (single source of truth). Absent when uncalibrated. */
  derivesFrom?: VisualReconTargetId;
  /** The fixed-label locator — present ONLY for a `live_confirmed` target. */
  locator?: IssuanceFixedLabelLocator;
}

/**
 * Which visual-recon adopted target each highlight target DERIVES from. `open_app` is deliberately absent — the
 * adopted set has no "open the existing app" fixed label, because opening a specific app depends on its identity.
 */
const DERIVES_FROM: Partial<Record<IssuanceHighlightTarget, VisualReconTargetId>> = {
  create_app: "app_list.register_application", // 애플리케이션 등록 (register button) — #4/#5
  api_group: "api_group.section", // API 그룹 (section heading) — #4/#5
  credentials: "credentials.application_id_label", // 애플리케이션 ID (credential section label) — #4/#5
};

/** Which onboarding path(s) reach each highlight target. */
const TARGET_PATHS: Readonly<Record<IssuanceHighlightTarget, readonly IssuancePath[]>> = {
  create_app: ["new_app"],
  open_app: ["existing_app"],
  api_group: ["new_app", "existing_app"],
  credentials: ["new_app", "existing_app"],
};

/** The screen each highlight target sits on (mirrors the visual-recon checkpoints). */
const TARGET_SCREEN: Readonly<Record<IssuanceHighlightTarget, VisualReconScreen>> = {
  create_app: "app_list",
  open_app: "app_list",
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
 * The calibrated highlight-target selectors. For a `live_confirmed` target the locator's `candidateQuery` +
 * `exactText` are REUSED verbatim from the adopted target's fixed-label probe (so an issuance locator can never
 * drift from the live evidence). `open_app` is `no_fixed_label` with no locator.
 */
export const ISSUANCE_TARGET_SELECTORS: readonly IssuanceTargetSelectorSpec[] = ISSUANCE_HIGHLIGHT_TARGETS.map((target) => {
  const derivesFrom = DERIVES_FROM[target];
  const paths = TARGET_PATHS[target];
  const screen = TARGET_SCREEN[target];
  if (!derivesFrom) {
    // `open_app`: no fixed NAVER label resolves it without app-identity dependence — uncalibrated, no locator.
    return { target, screen, paths, status: "no_fixed_label" };
  }
  // Anti-drift: a live_confirmed target MUST derive from an ADOPTED (live matchCount=1) visual-recon target.
  if (!(ADOPTED_TARGET_IDS as readonly VisualReconTargetId[]).includes(derivesFrom)) {
    throw new Error(`issuance-highlight-selectors: ${target} derives from a non-adopted target ${derivesFrom}`);
  }
  const probe = probeFor(derivesFrom);
  return {
    target,
    screen,
    paths,
    status: "live_confirmed",
    derivesFrom,
    locator: { candidateQuery: probe.candidateQuery, exactText: probe.exactText },
  };
});

/** Look up one highlight target's spec (throws if a non-highlight target — `return` — is ever passed). */
export function selectorSpecFor(target: IssuanceHighlightTarget): IssuanceTargetSelectorSpec {
  const spec = ISSUANCE_TARGET_SELECTORS.find((s) => s.target === target);
  if (!spec) throw new Error(`issuance-highlight-selectors: no spec for ${target}`);
  return spec;
}

/** The fixed-label locator for a target, or null when the target is uncalibrated (`open_app`). */
export function locatorFor(target: IssuanceHighlightTarget): IssuanceFixedLabelLocator | null {
  return selectorSpecFor(target).locator ?? null;
}

export type PathReadiness = "ready_candidate" | "not_ready";

/**
 * Whether an onboarding path's highlight targets are all live-confirmed. `ready_candidate` (never a bare
 * "ready") because the driver's OWN highlight mechanism has not yet been live-probed — the read-only
 * `API_ISSUANCE_SELECTOR_PROBE` phase does that, and only then may `SELECTORS_CALIBRATED` flip.
 *   - `new_app` (create_app → api_group → credentials): all live_confirmed ⇒ `ready_candidate`.
 *   - `existing_app` (open_app → api_group → credentials): open_app uncalibrated ⇒ `not_ready`.
 */
export function issuancePathReadiness(path: IssuancePath): PathReadiness {
  const targets = ISSUANCE_TARGET_SELECTORS.filter((s) => s.paths.includes(path));
  return targets.every((s) => s.status === "live_confirmed") ? "ready_candidate" : "not_ready";
}

export interface IssuanceSelectorEvaluation {
  target: IssuanceHighlightTarget;
  status: TargetCalibrationStatus;
  /** For a live_confirmed target: whether its adopted fixed-label passes the frozen gate at matchCount=1. */
  adoptable: boolean;
  reasons: SelectorRejectReason[];
}

/**
 * Re-score every calibrated target through the FROZEN {@link evaluateSelectorCandidate} gate, using the ADOPTED
 * selector string + its live `matchCount===1`. This proves each live_confirmed locator is legitimate by the
 * SAME rules the visual-recon adoption used (fixed-label, unique, not account/credential/position/value bound).
 * `open_app` is reported `adoptable:false` with `NOT_UNIQUE` (it has no measured, unique fixed-label locator).
 */
export function evaluateIssuanceHighlightSelectors(): IssuanceSelectorEvaluation[] {
  return ISSUANCE_TARGET_SELECTORS.map((spec) => {
    if (spec.status !== "live_confirmed" || !spec.derivesFrom) {
      return { target: spec.target, status: spec.status, adoptable: false, reasons: ["NOT_UNIQUE"] };
    }
    const proposal = VISUAL_RECON_CANDIDATES.find((c) => c.targetId === spec.derivesFrom);
    if (!proposal) throw new Error(`issuance-highlight-selectors: no candidate proposal for ${spec.derivesFrom}`);
    const measured: SelectorCandidate = { ...proposal.candidate, matchCount: 1 }; // live matchCount=1 (adopted)
    const { adoptable, reasons } = evaluateSelectorCandidate(measured);
    return { target: spec.target, status: spec.status, adoptable, reasons };
  });
}
