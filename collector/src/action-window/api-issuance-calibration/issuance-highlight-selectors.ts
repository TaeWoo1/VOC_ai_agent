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
 *   - **`open_app` uses a value-free STRUCTURAL anchor (candidate, unmeasured).** Opening a *specific* existing
 *     application means acting on that app's own row — its NAME is user data, so no FIXED label resolves it.
 *     Instead it carries a `structural` locator: the sole application-entry ROW (unique under NAVER's
 *     one-app-per-store), matched by plain `querySelectorAll` COUNT — never a name/value. It is a HYPOTHESIS
 *     (`status: "structural_candidate"`, `LIVE_DOM_CALIBRATION_PENDING`): the read-only selector probe must
 *     measure it live before it can be promoted, so the EXISTING-app path stays `not_ready` while the NEW-app
 *     path is `ready_candidate` (see {@link issuancePathReadiness}). The driver still fails closed on it — a
 *     non-unique match (e.g. multiple apps, or a too-broad row selector) parks rather than highlighting a guess.
 *   - **These are Playwright fixed-label locators for the driver — NOT the same thing as flipping
 *     `SELECTORS_CALIBRATED`.** That flag additionally requires the driver's OWN locate+tag+overlay mechanism
 *     to be live-probed (the read-only `API_ISSUANCE_SELECTOR_PROBE` phase) and `open_app` calibrated. It stays
 *     `false`; this module never touches it.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import { evaluateSelectorCandidate, type SelectorCandidate, type SelectorRejectReason, type VisualReconScreen } from "./visual-recon";
import { MATCH_COUNT_UNMEASURED, VISUAL_RECON_CANDIDATES, VISUAL_RECON_LABEL_PROBES, type FixedLabelProbe, type VisualReconTargetId } from "./visual-recon-candidates";
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
  /** A fixed-label locator that derives from a visual-recon adopted target; live `matchCount===1` (runs #4/#5/#6). */
  | "live_confirmed"
  /** A value-free STRUCTURAL anchor HYPOTHESIS (`open_app`) not yet measured live — `LIVE_DOM_CALIBRATION_PENDING`. */
  | "structural_candidate";

/** The single calibration caveat carried by an unmeasured structural anchor (mirrors the adapter's marker). */
export const LIVE_DOM_CALIBRATION_PENDING = "LIVE_DOM_CALIBRATION_PENDING" as const;

/** How a target is located: by a FIXED NAVER label, or by a value-free STRUCTURAL selector (COUNT only). */
export type LocatorKind = "fixed_label" | "structural";

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

/**
 * The value-free STRUCTURAL anchor for `open_app`: the sole application-entry ROW. Matched by plain
 * `querySelectorAll` COUNT and adoptable ONLY when it resolves to exactly one element (unique under NAVER's
 * one-app-per-store). It reads NO name/value/text. Same structural hypothesis the driver counts app-entry rows
 * with (a test pins the two together); a live probe must confirm it resolves uniquely before promotion.
 */
export const OPEN_APP_STRUCTURAL_SELECTOR = "table tbody tr, ul li, ol li, [role='row']";

export interface IssuanceTargetSelectorSpec {
  target: IssuanceHighlightTarget;
  screen: VisualReconScreen;
  /** Which onboarding path(s) reach this target. */
  paths: readonly IssuancePath[];
  status: TargetCalibrationStatus;
  kind: LocatorKind;
  /** The visual-recon adopted target a fixed-label locator derives from (single source of truth). */
  derivesFrom?: VisualReconTargetId;
  /** The fixed-label locator — present ONLY for a `fixed_label` (live_confirmed) target. */
  locator?: IssuanceFixedLabelLocator;
  /** The value-free structural selector — present ONLY for a `structural` (open_app) target. */
  structuralSelector?: string;
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
    // `open_app`: no fixed NAVER label resolves it without app-identity dependence. It carries a value-free
    // STRUCTURAL anchor HYPOTHESIS (the sole app-entry row), unmeasured — a live probe must confirm uniqueness.
    return { target, screen, paths, status: "structural_candidate", kind: "structural", structuralSelector: OPEN_APP_STRUCTURAL_SELECTOR };
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
    kind: "fixed_label",
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

/** The fixed-label locator for a target, or null when the target is not a fixed-label target (`open_app`). */
export function locatorFor(target: IssuanceHighlightTarget): IssuanceFixedLabelLocator | null {
  return selectorSpecFor(target).locator ?? null;
}

/** The value-free structural selector for a target, or null when the target is not structural (only `open_app` is). */
export function structuralSelectorFor(target: IssuanceHighlightTarget): string | null {
  return selectorSpecFor(target).structuralSelector ?? null;
}

/**
 * Whether the GUIDED highlight walk (the live `NaverIssuanceDriver` Action Window) may highlight this target.
 * ONLY a `live_confirmed` (calibrated) target qualifies. A `structural_candidate` (`open_app`, an UNMEASURED
 * anchor hypothesis) is deliberately NOT guided-highlightable — the guided existing-app walk fails closed on it
 * rather than risk highlighting a wrong element from an unconfirmed selector. The READ-ONLY selector probe can
 * still MEASURE the candidate (that is how it earns promotion); measuring is not highlighting.
 */
export function isGuidedHighlightTarget(target: IssuanceHighlightTarget): boolean {
  return selectorSpecFor(target).status === "live_confirmed";
}

export type PathReadiness = "ready_candidate" | "not_ready";

/**
 * Whether an onboarding path's highlight targets are all live-confirmed. `ready_candidate` (never a bare
 * "ready") because the driver's OWN highlight mechanism has not yet been live-probed — the read-only
 * `API_ISSUANCE_SELECTOR_PROBE` phase does that, and only then may `SELECTORS_CALIBRATED` flip.
 *   - `new_app` (create_app → api_group → credentials): all live_confirmed ⇒ `ready_candidate`.
 *   - `existing_app` (open_app → api_group → credentials): open_app is a structural_candidate (unmeasured) ⇒
 *     `not_ready` until a live probe confirms its anchor resolves uniquely.
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
    if (spec.kind === "structural" && spec.structuralSelector) {
      // The structural anchor is an UNMEASURED, not-yet-screenshot-confirmed hypothesis → unadoptable (honest).
      const measured: SelectorCandidate = {
        screen: spec.screen,
        selector: spec.structuralSelector,
        matchCount: MATCH_COUNT_UNMEASURED, // never claims uniqueness offline — a live probe must measure it
        screenshotTargetConfirmed: false, // not visually confirmed as the "open the app" control
        dependsOnAccountOrCredential: false, // structural row — no app name/value
        positionOnly: false, // a structural hook (the app-entry row), not a coordinate / nth-child index
        usesTextMatch: false,
        usesFixedLabelTextOnly: false,
      };
      const { adoptable, reasons } = evaluateSelectorCandidate(measured);
      return { target: spec.target, status: spec.status, adoptable, reasons };
    }
    if (!spec.derivesFrom) throw new Error(`issuance-highlight-selectors: fixed-label target ${spec.target} has no source`);
    const proposal = VISUAL_RECON_CANDIDATES.find((c) => c.targetId === spec.derivesFrom);
    if (!proposal) throw new Error(`issuance-highlight-selectors: no candidate proposal for ${spec.derivesFrom}`);
    const measured: SelectorCandidate = { ...proposal.candidate, matchCount: 1 }; // live matchCount=1 (adopted)
    const { adoptable, reasons } = evaluateSelectorCandidate(measured);
    return { target: spec.target, status: spec.status, adoptable, reasons };
  });
}
