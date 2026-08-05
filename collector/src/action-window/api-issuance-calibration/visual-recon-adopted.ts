/**
 * **ADOPTED visual-recon fixed-label selectors — CONFIRMED matchCount=1 on the REAL NAVER API center.**
 *
 * Each of these was proposed from the redacted visual recon, measured live, and confirmed to resolve to EXACTLY
 * one element on the real API center (live runs of 2026-08-02: #4/#5/#6). Each passes the frozen
 * {@link evaluateSelectorCandidate} adoption gate once its live `matchCount===1` is supplied. This module is the
 * SOURCE OF TRUTH for locating these API-center CONTROLS by a fixed NAVER UI label — never by an application
 * name or a credential value.
 *
 * ⚠ **SCOPE BOUNDARY — this is NOT the issuance highlight driver's calibration, and it deliberately does NOT
 * touch `SELECTORS_CALIBRATED`.** That flag gates Phase B (`API_ISSUANCE_HIGHLIGHT_PROOF` / `NaverIssuanceDriver`),
 * whose `CANDIDATE_TARGET_SELECTORS` are a DIFFERENT target set (`create_app/open_app/api_group/credentials/
 * return`), located via **CSS `querySelectorAll`**, and still UNCALIBRATED (`open_app`/`return` were never
 * measured; the overlapping ones need the clickable control, not an anchor). The selectors below use Playwright
 * **`role=`/`text=`** engine syntax and identify section anchors / labels / buttons for a reviewer, so they are
 * NOT drop-in replacements for the issuance CSS selectors. Wiring these into any driver — and any flip of
 * `SELECTORS_CALIBRATED` — is separate, explicitly-authorized future work.
 */
import { evaluateSelectorCandidate, type SelectorCandidate, type SelectorRejectReason, type VisualReconScreen } from "./visual-recon";
import { VISUAL_RECON_CANDIDATES, type VisualReconTargetId } from "./visual-recon-candidates";

/** The visual-recon targets whose fixed-label selector was CONFIRMED matchCount=1 live (runs #4/#5/#6). */
export const ADOPTED_TARGET_IDS = [
  "app_list.register_application", // 애플리케이션 등록 (register button) — #4/#5
  "app_detail.application_section", // anchored on the unique 애플리케이션 ID label — #6
  "api_group.section", // API 그룹 (section heading) — #4/#5
  "credentials.application_id_label", // 애플리케이션 ID (label cell) — #4/#5
  "credentials.secret_view_button", // 보기 (view) — #4/#5
  "credentials.secret_copy_button", // 복사 (copy) — #4/#5
] as const satisfies readonly VisualReconTargetId[];
export type AdoptedTargetId = (typeof ADOPTED_TARGET_IDS)[number];

/** Which live run(s) confirmed each adopted selector at matchCount=1 (sanitized run labels, not run ids). */
const CONFIRMED_LIVE_RUNS: Readonly<Record<AdoptedTargetId, readonly string[]>> = {
  "app_list.register_application": ["2026-08-02#4", "2026-08-02#5"],
  "app_detail.application_section": ["2026-08-02#6"],
  "api_group.section": ["2026-08-02#4", "2026-08-02#5"],
  "credentials.application_id_label": ["2026-08-02#4", "2026-08-02#5"],
  "credentials.secret_view_button": ["2026-08-02#4", "2026-08-02#5"],
  "credentials.secret_copy_button": ["2026-08-02#4", "2026-08-02#5"],
};

export interface AdoptedVisualReconSelector {
  targetId: AdoptedTargetId;
  screen: VisualReconScreen;
  /** Playwright selector-engine string (role=/text=), using ONLY a fixed NAVER label — never a value/app name. */
  selector: string;
  /** The live matchCount that confirmed uniqueness — always 1 for an adopted selector. */
  liveMatchCount: 1;
  /** Sanitized labels of the live run(s) that confirmed it. */
  confirmedLiveRuns: readonly string[];
}

/** The candidate proposal for a target (its selector is the single source of truth reused here). */
function candidateFor(id: AdoptedTargetId): (typeof VISUAL_RECON_CANDIDATES)[number] {
  const c = VISUAL_RECON_CANDIDATES.find((p) => p.targetId === id);
  if (!c) throw new Error(`adopted target has no candidate proposal: ${id}`);
  return c;
}

/**
 * The adopted selectors — selector strings reused from {@link VISUAL_RECON_CANDIDATES} (so an adopted selector
 * can never drift from its proposal), each stamped with the confirmed live `matchCount===1` evidence.
 */
export const ADOPTED_VISUAL_RECON_SELECTORS: readonly AdoptedVisualReconSelector[] = ADOPTED_TARGET_IDS.map((id) => {
  const c = candidateFor(id);
  return { targetId: id, screen: c.screen, selector: c.candidate.selector, liveMatchCount: 1, confirmedLiveRuns: CONFIRMED_LIVE_RUNS[id] };
});

export interface AdoptedEvaluation {
  targetId: AdoptedTargetId;
  adoptable: boolean;
  reasons: SelectorRejectReason[];
}

/**
 * Re-score every adopted selector through the FROZEN adoption gate with its live `matchCount===1` supplied.
 * Every entry must be `adoptable === true` — this is the machine-checked proof that adoption is legitimate
 * (screenshot-confirmed, unique, fixed-label, not account/credential/position/value dependent).
 */
export function evaluateAdopted(): AdoptedEvaluation[] {
  return ADOPTED_VISUAL_RECON_SELECTORS.map((a) => {
    const measured: SelectorCandidate = { ...candidateFor(a.targetId).candidate, matchCount: a.liveMatchCount };
    const { adoptable, reasons } = evaluateSelectorCandidate(measured);
    return { targetId: a.targetId, adoptable, reasons };
  });
}
