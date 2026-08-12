/**
 * **Coupang WING API-issuance guided-walk driver — LIVE surface core (SCAFFOLD, NEVER run this unit).**
 *
 * The live sibling of `./coupang-issuance/coupang-issuance-fixture-driver.ts`: a
 * {@link CoupangIssuanceProbeDriver} that drives the guided WING open-API issuance walk over a REAL Playwright
 * `Page` the seller navigated to, instead of a data fixture. It composes the SAME sanitized classifiers the
 * fixture path uses (`coupang-wing-classifier`'s census + `wingPageCategoryFromCensus`, so the two can never
 * disagree) and the SAME generic real-page seams the export/reply/NAVER-issuance drivers already use
 * (`overlay`), differing only in how it obtains the surface: it reads `page.url()` (reduced to a host CATEGORY,
 * never logged raw) and runs the value-free census in-page.
 *
 * LOCATION IS DELIBERATELY OUTSIDE `coupang-issuance/` (like `naver-issuance-driver.ts`) because it legitimately
 * uses `.evaluate` for the census / overlay / read-only tagging. The pure `coupang-issuance/` runtime carries a
 * strict source guard that forbids `.evaluate` entirely; keeping this driver out of that directory keeps that
 * guard intact. This module has its OWN guard (`coupang-wing-issuance-driver-guard.test.ts`) that allows
 * `.evaluate` / `setAttribute` but still forbids every click/type/submit/issue and every field-VALUE read.
 *
 * HARD BOUNDARIES (enforced by that source guard):
 *   - **No login, click, type, submit, issue, or select.** The SELLER performs every real step in their own
 *     window — including pressing the 발급 (issue) button themselves. This driver only reads a sanitized page
 *     category, resolves + annotates a fixed-label section read-only, and reacts to a reported action.
 *   - **No credential read — region PRESENCE only.** For the `credentials` target it detects that a
 *     credential region/control exists (a count + a STRUCTURAL signature); it NEVER reads the Access Key /
 *     Secret Key / 업체코드 value. No `.inputValue`, no value read, no clipboard, no screenshot, no
 *     `page.content()`. The structural signature is computed IN-PAGE from an element's tag + position + child
 *     count only — never from any value/attribute content.
 *   - **Sanitized outputs only.** Counts, booleans, fixed category enums, and an opaque 16-hex signature.
 *
 * ⚠ **CALIBRATION PENDING (LIVE_DOM_CALIBRATION_PENDING) — NOT calibrated.** {@link WING_HIGHLIGHT_LABELS} are
 * PROPOSED fixed-label candidates derived from WING's Korean UI (자체개발 / 업체명 / 호출 IP / 발급 / Access Key).
 * They are NOT proven against the real WING DOM. This driver is a scaffold gated behind the live-run approval
 * and is NEVER run in this unit; a live WING walk must confirm each label resolves uniquely before it is trusted.
 */
import type { Page } from "playwright";
import { log } from "../log";
import { buildWingConsentCompleteScript } from "../cli/coupang-wing-classifier";
import {
  WING_STAGE3_TERMS_OPTION_CANDIDATES,
  WING_KEY_CREATION_CONTROL_ID,
  WING_KEY_CREATION_SELECTOR_CALIBRATED,
  WING_PURPOSE_SCREEN_MARKER_SPEC,
  WING_TERMS_SCREEN_MARKER_SPECS,
  WING_VENDOR_METHOD_SCREEN_MARKER_SPECS,
  wingGuidedHighlightPromotion,
  wingCandidateSpecById,
  type WingFlowScreen,
  type WingFlowScreenMarkerSpec,
  type WingGuidedHighlightTarget,
} from "./coupang-wing-label-recon";
import { mountOverlay, unmountOverlay, overlayMounted, resetOverlayAdvance, readOverlayAdvancePressed } from "./overlay";
import {
  EXTRACT_WING_CENSUS,
  EXTRACT_WING_CHOICE_CONTROL_SHAPES,
  sanitizeChoiceControlCensus,
  buildWingConsentBlockScript,
  sanitizeConsentBlockCensus,
  type WingConsentBlockCensus,
  buildWingChoiceAssociationScript,
  sanitizeChoiceAssociationCensus,
  type WingChoiceAssociationCensus,
  type WingChoiceControlCensus,
  LIVE_DOM_CALIBRATION_PENDING,
  classifyWingUrlCategory,
  observeFrom,
  wingPageCategoryFromCensus,
  type WingObservation,
  type WingPageCategory,
  type WingStructuralCensus,
} from "../cli/coupang-wing-classifier";
import {
  buildFixedLabelContainmentScript,
  buildFixedLabelLocateScript,
  buildFixedLabelRingPlanScript,
  sanitizeContainmentReading,
  type FixedLabelContainmentReading,
} from "./api-issuance-calibration/visual-recon-inpage";
import { COUPANG_ISSUANCE_TOTAL_STEPS } from "./coupang-issuance/coupang-issuance-stages";
import type {
  CoupangIssuanceProbeDriver,
  CoupangIssuanceTarget,
  WingSurfaceProbe,
} from "./coupang-issuance/coupang-issuance-driver";
import { isCoupangCheckpointTarget } from "./coupang-issuance/coupang-issuance-driver";
import type { LocateResult } from "./engine";

/** The highlightable fixed-label targets (everything except the guidance-only `reach_open_api` / `return`). */
/**
 * The fixed-label targets the driver knows how to locate. Its own vocabulary, deliberately NOT the tutorial's:
 * the guided walk stopped guiding `self_dev` / `vendor_info` / `call_ip` on 2026-08-10 (no such option, and no
 * such screen), but the read-only selector probe may still be pointed at their labels, and the historical
 * records cite them.
 *
 * What the tutorial can actually highlight is narrower still — see {@link isWingHighlightTarget}.
 */
export type WingHighlightTarget = "self_dev" | "vendor_info" | "call_ip" | "issue" | "credentials" | "issue_final";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** Proposed fixed WING labels for each highlightable target. WING's
 * issuance controls expose no stable aria-label/id, so a fixed Korean label is the only value-free anchor. These
 * are PROPOSALS from the visible WING UI — a live walk must confirm each resolves to exactly one element.
 */
/**
 * Whether {@link WING_HIGHLIGHT_LABELS} are calibrated against the REAL WING DOM — `LIVE_DOM_CALIBRATION_PENDING`
 * (i.e. NOT calibrated). A code-level marker (not just prose) so the source guard can assert this scaffold never
 * claims a proven detector; a live WING walk must confirm each label resolves uniquely before this flips.
 */
export const WING_HIGHLIGHT_CALIBRATION = LIVE_DOM_CALIBRATION_PENDING;

/**
 * The key-creation control's locator, **derived from the measured candidate rather than re-typed.**
 *
 * `coupang-wing-label-recon.ts` says of these strings "there is exactly one copy of each of these, here", and
 * `WING_KEY_CREATION_SELECTOR_CALIBRATED` promises that any edit to the candidate's `candidateQuery` or
 * `exactText` invalidates the flag. A second hand-written copy defeats both: editing the recon candidate would
 * leave the ring pointing with the stale string, and — because the TERMS heading carries character-identical
 * text — a query that drifted wider than `button,a` here would put the spotlight on the HEADING while the
 * measurement that justified the flag was taken against actionable elements only.
 */
const KEY_CREATION_SPEC: WingFlowScreenMarkerSpec = (() => {
  const spec = WING_TERMS_SCREEN_MARKER_SPECS.find((s) => s.id === WING_KEY_CREATION_CONTROL_ID);
  // Fail at load, not at highlight time: a missing spec would otherwise become "the control was not found" on a
  // live page, which reads as a WING change rather than as our own broken wiring.
  if (!spec) throw new Error("coupang-wing-issuance-driver: no measured candidate for the key-creation control");
  return spec;
})();

export const WING_HIGHLIGHT_LABELS: Readonly<Record<WingHighlightTarget, { candidateQuery: string; exactText: string; tagAncestor?: string }>> = {
  // RETIRED FROM THE TUTORIAL 2026-08-10 — kept for the read-only probe and the records that cite them. The
  // purpose screen offers no 자체개발, and 업체명 / 호출 IP are never shown in this flow.
  self_dev: { candidateQuery: "label,button,span,div,a,legend", exactText: "자체개발" },
  vendor_info: { candidateQuery: "label,span,div,dt,th,strong", exactText: "업체명" },
  call_ip: { candidateQuery: "label,span,div,dt,th,strong", exactText: "호출 IP" },
  // 발급: `exactText` compares the element's WHOLE normalized text, so "발급" never could have matched the real
  // control — its label reads "API Key 발급 받기". What it matched instead, on the live no-key surface on
  // 2026-08-09, was a non-painting node elsewhere in the document: unique, invisible, and reported as a success.
  // The query is narrowed from "button,a,span,div" to "button" for the same reason the text is corrected — the
  // control is a real `<button>`, and a span/div satisfying a button-shaped intent is the failure, not a fallback.
  //
  // LIVE-CALIBRATED. This spec is BYTE-FOR-BYTE the one the read-only probe measured (see
  // `WING_ISSUE_CALIBRATION_EVIDENCE`, and the equality test that pins the two together). Retuning either field
  // — even toward the observed `id`/`className`, which are NOT adopted as anchors — discards the measurement
  // that justifies `WING_ISSUE_SELECTOR_CALIBRATED` and requires a fresh probe.
  issue: { candidateQuery: "button", exactText: "API Key 발급 받기" },
  // LIVE-CALIBRATED 2026-08-11 (see WING_KEY_CREATION_SELECTOR_CALIBRATED). Narrowed to actionable elements
  // because the TERMS heading carries the identical text; measured distinct from it in the same pass. Taken
  // FROM that measurement — see KEY_CREATION_SPEC — so the ring can never point with a string the calibration
  // no longer covers.
  issue_final: { candidateQuery: KEY_CREATION_SPEC.candidateQuery, exactText: KEY_CREATION_SPEC.exactText },
  credentials: { candidateQuery: "label,span,div,dt,th,strong", exactText: "Access Key", tagAncestor: "tr" },
};

function isWingHighlightTarget(target: CoupangIssuanceTarget): target is "issue" | "credentials" | "issue_final" {
  // Gated on the flag, not on a literal list, so WITHDRAWING the calibration removes the ring by itself. The
  // 삭제 record was withdrawn while its target stayed in a hand-written list, and only the flag being read at
  // the point of use keeps that from happening again.
  if (target === "issue_final") return WING_KEY_CREATION_SELECTOR_CALIBRATED;
  // The two SINGLE-SPEC fixed-label targets, which is all this predicate has ever answered for. It is no
  // longer the whole ringed set: the purpose option, 확인 and the two consent sentences were promoted on
  // 2026-08-12 and resolve through `promotedRingSpecs`, which runs ahead of this on both the locate and the
  // highlight path. `WING_HIGHLIGHT_LABELS` is this function's whole domain.
  return target === "issue" || target === "credentials";
}

/**
 * The key-DELETION fixed-label target, kept DELIBERATELY SEPARATE from {@link WingHighlightTarget} /
 * `CoupangIssuanceTarget`: deleting is NOT a step in the issuance walk, so it must not leak into the issuance
 * target union (which drives the guided sequence). It is a highlightable WING label the read-only selector
 * recorder can COUNT on the already-issued page, so a later live run can calibrate the 삭제 control before any
 * highlight-delete phase is ever allowed to reach a PREPARED manifest.
 */
export type WingDeletionTarget = "delete";

/**
 * The value-free result of a READ-ONLY fixed-label probe.
 *
 * `observedTag` is the point of this type. A recorder that can only report the role a control was EXPECTED to
 * have will report it whether or not the selector found that control — which is how `role: "button"` was written
 * into a calibration record for an element that turned out not to be a button, and never to have been measured.
 */
export interface WingFixedLabelProbe {
  /** Candidates that match the fixed label AND paint. Integer only. */
  matchCount: number;
  /** `matchCount === 1` — resolves uniquely, so it could be highlighted. Says nothing about WHICH element. */
  canHighlight: boolean;
  /** Opaque 16-hex structural signature of the unique match. */
  sig?: string;
  /** Matches rejected for not painting. A count; distinguishes "nothing visible matched" from "nothing matched". */
  hiddenMatchCount?: number;
  /** MEASURED tag name of the unique match (e.g. `"BUTTON"`) — an observation, never an expectation. */
  observedTag?: string;
}

/** The live-confirmed counterpart of {@link LIVE_DOM_CALIBRATION_PENDING} — set only from a real live capture. */
export const LIVE_DOM_CALIBRATION_CONFIRMED = "LIVE_DOM_CALIBRATION_CONFIRMED" as const;

/**
 * A calibration a live run **disproved**. Distinct from `LIVE_DOM_CALIBRATION_PENDING`: pending means never
 * measured, refuted means measured, believed, and found wrong on a real page. The distinction is worth a constant
 * because the two carry different obligations — a pending selector needs a first measurement, a refuted one needs
 * an explanation of why the earlier evidence read as confirmation, or the same mistake is available to be made again.
 */
export const LIVE_DOM_CALIBRATION_REFUTED = "LIVE_DOM_CALIBRATION_REFUTED" as const;

/**
 * A calibration whose measurement was real but was taken with an apparatus **later shown unable to support the
 * claim**. A third state, and it needs to be, because the two existing ones both say something false about it:
 * `LIVE_DOM_CALIBRATION_PENDING` says nobody looked, and `LIVE_DOM_CALIBRATION_REFUTED` says somebody looked and
 * the claim was disproved. Here somebody looked, and we no longer know what they saw.
 *
 * The obligation it carries is therefore narrower than refuted and stricter than pending: the old capture may not
 * be re-cited, re-asserting from it is forbidden, and the only way out is a fresh measurement on the current
 * apparatus. A claim that is *unsupported* must not be quietly filed as *probably fine*.
 */
export const LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND = "LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND" as const;

/**
 * **CALIBRATION WITHDRAWN** — see {@link WING_DELETION_CALIBRATION_EVIDENCE} for why. The fixed WING label for the
 * 삭제 (delete) control on the already-issued open-API page.
 *
 * The spec below is **unchanged and deliberately so.** Withdrawing a calibration is not a reason to guess at a
 * new selector: the 2026-08-07 capture is unsupported, not disproved, and editing the spec now would mean the
 * eventual re-measurement measures something nobody ever observed. It stays byte-for-byte what was captured, so
 * the re-run is a clean comparison. Any change here still invalidates the record and requires a fresh probe.
 */
export const WING_DELETION_CALIBRATION = LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND;
export const WING_DELETION_LABELS: Readonly<Record<WingDeletionTarget, { candidateQuery: string; exactText: string; tagAncestor?: string }>> = {
  delete: { candidateQuery: "button,a,span,div", exactText: "삭제" },
};

/**
 * **WITHDRAWN PROVENANCE for the 삭제 calibration.** This record used to justify
 * {@link WING_DELETION_SELECTORS_CALIBRATED} as `true`. It no longer justifies anything, and the flag is `false`.
 *
 * **Two grounds, and the second is the serious one.**
 *
 *  1. `role: "button"` was never measured. It came from `WING_TARGET_EXPECTED_ROLE.delete` — the hardcoded table
 *     of EXPECTED roles — written into a field named `role` and documented "as measured". Byte-for-byte the same
 *     over-claim that was refuted on the 발급 target. The field is now deleted rather than renamed: the
 *     expectation already has a home, and this record has no business restating it.
 *
 *  2. **The uniqueness measurement predates the visibility filter.** The capture ran at `a666ad1` on 2026-08-07;
 *     `buildFixedLabelLocateScript` gained `paints()` at `a3ef479e` on 2026-08-09. So `matchCount: 1` was
 *     produced by the *same* locator version that, on the 발급 target, reported a confident unique match against
 *     a node that does not render. This is not a hypothetical resemblance: the withdrawn 발급 spec was
 *     `{"button,a,span,div", "발급"}` and the 삭제 spec is `{"button,a,span,div", "삭제"}` — the same broad
 *     multi-tag query with a short whole-text label, on the same page family, measured by the same unfiltered
 *     code. Whether that `1` was a painting 삭제 button or a hidden node is **unknown**, and nothing in the
 *     record ever distinguished the two.
 *
 * Hence {@link LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND} rather than `REFUTED`: nobody re-ran it and found it
 * wrong. The claim is unsupported, not disproved. That difference is worth a constant precisely because
 * "unsupported" is the state most likely to be quietly rounded up to "fine" — and this one gates an
 * **irreversible** deletion.
 *
 * What the withdrawal costs is nothing that was working: no live deletion run has ever happened.
 *
 * `signatureRole: "EVIDENCE_ONLY"` still holds and still matters. `withdrawnSig16` is the signature of whatever
 * the unfiltered locator matched, so it is now doubly unusable as a baseline. No code path compares a live
 * signature against this constant, and `coupang-wing-deletion-driver-guard.test.ts` keeps it that way.
 */
export interface WingDeletionCalibrationEvidence {
  readonly status: typeof LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND;
  /** When the calibration was withdrawn. */
  readonly withdrawnOn: string;
  /** Date of the live read-only capture that used to back it (KST). */
  readonly capturedOn: string;
  /** The commit the probe ran on. Load-bearing: it is what dates the capture to the unfiltered locator. */
  readonly gitSha: string;
  /** The commit that added `paints()` to the shared locator, making every earlier count unsound. */
  readonly visibilityFilterAddedIn: "a3ef479e";
  /** The probe's sanitized record id (no account / seller / URL identity). */
  readonly recordId: string;
  /** The sanitized page category the capture was taken on. */
  readonly pageCategory: "open_api_issuance";
  /**
   * The WITHDRAWN observation. `matchCount: 1` was really returned; `visibilityFiltered: false` is why it cannot
   * be read as "one visible 삭제 control". Both fields must stay together — the count alone is the claim that
   * was over-trusted for two days.
   */
  readonly withdrawnObservation: { readonly matchCount: 1; readonly visibilityFiltered: false };
  /** Our own fixed label — the same string as {@link WING_DELETION_LABELS}.delete.exactText, which is UNCHANGED. */
  readonly label: "삭제";
  /** Opaque 16-hex signature of whatever the unfiltered locator matched. Historical only; never a baseline. */
  readonly withdrawnSig16: string;
  /** How many live captures ever backed this record. */
  readonly captureCount: 1;
  /** Honest limit, unchanged: a single capture cannot demonstrate cross-run signature stability. */
  readonly signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED";
  /** What the signature is allowed to be used for. `EVIDENCE_ONLY` ⇒ no runtime gate may read it. */
  readonly signatureRole: "EVIDENCE_ONLY";
  /** The 삭제 press has never happened, and this withdrawal does not change that either way. */
  readonly deletionOutcome: "NEVER_PERFORMED";
  /** What must be measured live before the flag may return to `true`. Same standard the 발급 target had to meet. */
  readonly reconfirmationRequires: "READ_ONLY_PROBE_VISIBLE_UNIQUE_MATCH_WITH_MEASURED_TAG";
}

export const WING_DELETION_CALIBRATION_EVIDENCE: WingDeletionCalibrationEvidence = {
  status: LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND,
  withdrawnOn: "2026-08-09",
  capturedOn: "2026-08-07",
  gitSha: "a666ad1",
  visibilityFilterAddedIn: "a3ef479e",
  recordId: "wingrec_c01e673ebc61",
  pageCategory: "open_api_issuance",
  withdrawnObservation: Object.freeze({ matchCount: 1, visibilityFiltered: false }) as {
    readonly matchCount: 1;
    readonly visibilityFiltered: false;
  },
  label: "삭제",
  withdrawnSig16: "3562cb60c496e220",
  captureCount: 1,
  signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED",
  signatureRole: "EVIDENCE_ONLY",
  deletionOutcome: "NEVER_PERFORMED",
  reconfirmationRequires: "READ_ONLY_PROBE_VISIBLE_UNIQUE_MATCH_WITH_MEASURED_TAG",
};

/**
 * The WITHDRAWN `issue` calibration, retained inside the live record below as {@link
 * WingIssueCalibrationEvidence.supersedes}. It is a **retraction, never support**: no count, id or signature here
 * adds anything to the current claim, and the live record's `captureCount` deliberately does not include them.
 *
 * **What happened.** Until 2026-08-09 this read `LIVE_DOM_CALIBRATION_CONFIRMED` and stated that the `issue`
 * label resolved to exactly one element with role `button` across four captures spanning both account states. On
 * the real no-key surface the operator saw NO highlight anywhere while the run logged `highlighted: true`. The
 * real control's label is `API Key 발급 받기`; the old spec compared the element's whole normalized text against
 * `발급`, which that button's text is not. The unique match was some other, non-painting node, so the tag landed
 * on an element nobody could see. Nothing was pressed — the operator noticed and the run was aborted.
 *
 * **Why four captures read as confirmation.** Two independent over-claims, and neither was a lie about the count:
 *
 *  1. `role: "button"` was never measured. `buildFixedLabelLocateScript` returned `{ count, sig }` — no tag, no
 *     role, no visibility. The field was asserted by hand from what the control was assumed to be. The one
 *     property that would have exposed the mismatch was the one property the apparatus could not produce, so
 *     writing it down cost nothing and proved nothing. It is now MEASURED (`LocateResult.tag`) or absent.
 *  2. `matchCount: 1` was true and irrelevant. It says the selector hit one element; it says nothing about WHICH.
 *     Repeating it across four captures on two surfaces multiplied confidence in a claim about uniqueness while
 *     adding no evidence about identity — the captures agreed with each other, and all four were about the decoy.
 *
 * The general form is the one this codebase keeps rediscovering: **a guard placed one layer away from the thing it
 * guards.** Uniqueness guarded identity, and does not imply it. The locator now rejects non-painting matches, so a
 * decoy of this shape returns `count: 0, hiddenCount: 1` rather than a confident `count: 1`.
 */
export interface WingIssueCalibrationRefutation {
  readonly status: typeof LIVE_DOM_CALIBRATION_REFUTED;
  /** When the refuting live run happened. */
  readonly refutedOn: string;
  /** When the (wrong) confirmation was recorded — kept so the gap between claim and check stays legible. */
  readonly claimedOn: string;
  /** The sanitized record ids behind the WITHDRAWN uniqueness claim. Retained as provenance, not as support. */
  readonly withdrawnRecordIds: readonly string[];
  /** The surfaces those withdrawn captures covered. Named so nobody re-cites them as coverage. */
  readonly withdrawnSurfaces: readonly ["already_issued_page", "no_key_initial_surface"];
  /** The spec that was believed calibrated, verbatim, so the refutation names a concrete thing. */
  readonly refutedSpec: { readonly candidateQuery: string; readonly exactText: string };
  /** What the refuted spec matched live: a unique, non-painting node. Counts only. */
  readonly refutedObservation: { readonly visibleMatchCount: 0; readonly nonPaintingMatchCount: 1 };
  /** Signatures observed under the REFUTED spec — i.e. signatures of the decoy. Historical only; never a gate. */
  readonly withdrawnSig16: readonly string[];
  /** The claim being retracted, named in full so restoring it requires deleting a sentence that says not to. */
  readonly withdrawnClaim: "FOUR_AGREEING_CAPTURES_WITH_AN_UNMEASURED_ROLE";
}

/**
 * **LIVE-CONFIRMED calibration of the `issue` (발급) control** — the READ-ONLY probe of 2026-08-09 at `e8e62981`,
 * on the REAL no-key open-API surface, measuring the corrected spec exactly as shipped.
 *
 * **Everything under {@link measured} was measured, and the two fields that were not say so in their names.**
 * That split is the whole point of the shape. The refuted record carried `role: "button"` — a value the
 * apparatus could not produce, nobody had observed, and nothing marked as unobserved. The locator now returns a
 * measured `tag`, and `measured.observedTag` is that measurement, sitting beside
 * `WING_TARGET_EXPECTED_ROLE.issue` rather than substituted for it.
 *
 * Be precise about what that agreement proves, because the earlier version of this comment was not. Both sides
 * are source constants, so the assertion that they match is a guard on **this record**, not on WING: it fires if
 * someone edits `observedTag` to disagree with the expectation, and it cannot fire because of anything on a live
 * page. What actually constrains identity at runtime is the triple of a tag-only `candidateQuery` (`"button"`,
 * so a match can only ever BE a button), the whole-text `exactText` compare, and the visibility filter. The
 * measured tag is what let the 2026-08-09 failure be *diagnosed*, and it is corroboration here — not the
 * enforcement layer. There is no runtime tag assertion, and this record must not be read as claiming one.
 *
 * **ONE capture. Not four.** The refuted record's four agreeing captures raised confidence in a claim none of
 * them tested, so capture count was never the missing ingredient — measuring the right property was. This record
 * therefore makes the weaker, true statement: on one live no-key surface, the shipped spec resolved to exactly one
 * PAINTING element, and that element is a `BUTTON`. **No cross-surface, cross-session or stability claim is made
 * or may be inferred**, and the already-issued surface has NOT been re-measured under the corrected spec.
 *
 * **The observed `id` / `className` are NOT adopted, and are not kept here at all.** The operator's 2026-08-09
 * sighting reported them; they are written down in `docs/coupang_wing_issue_selector_calibration_landing_v2.md`
 * and named in the test that forbids them, and deliberately nowhere in this file. Promoting either to a
 * production anchor would be a stability guess about markup nobody has watched over time, and a constant sitting
 * beside the selector is a standing invitation to reach for one. The anchor stays the visible Korean label,
 * which is what the probe measured.
 *
 * **Still not established, unchanged by this landing:** what pressing the control DOES. `pressOutcome` stays
 * `UNCONFIRMED` — calibration covers the LOCATOR and nothing downstream of it. And this record says nothing about
 * whether a key exists: `credentialAnchorPresent` read `true` on this confirmed NO-KEY surface, which is exactly
 * why `wingIssuedStateFrom` answers `indeterminate / NO_DISCRIMINATING_SIGNAL`.
 *
 * **`sig16` is `EVIDENCE_ONLY`**, on the same terms as the 삭제 record: one capture cannot establish cross-run
 * stability, so no runtime path may compare a live signature against this constant. Introducing such a comparison
 * would create a stability requirement this evidence cannot honestly satisfy.
 */
export interface WingIssueCalibrationEvidence {
  readonly status: typeof LIVE_DOM_CALIBRATION_CONFIRMED;
  /** Date of the live read-only capture (KST). */
  readonly capturedOn: string;
  /** The commit the probe ran on — the code that produced this measurement. */
  readonly gitSha: string;
  /** The probe's sanitized record id (no account / seller / URL identity). */
  readonly recordId: string;
  readonly pageCategory: "open_api_issuance";
  /**
   * The ONE surface the capture was taken on — the already-issued surface is not covered by this record.
   *
   * **This is OPERATOR-ATTRIBUTED, not measured**, and {@link surfaceAttribution} says so beside it. The probe
   * structurally cannot produce it: `wingIssuedStateFrom` answers `NO_DISCRIMINATING_SIGNAL` precisely because
   * no sanitized signal separates a no-key page from an already-issued one, and `pageCategory` is
   * `open_api_issuance` on both. It is recorded because the calibration's coverage claim is meaningless without
   * naming a surface — not because anything in the run verified it.
   */
  readonly surface: "no_key_initial_surface";
  /**
   * Where {@link surface} came from. The refuted record's fatal field was one the apparatus could not produce
   * sitting unlabelled among ones it could; this is that label, so the same shape cannot recur silently.
   */
  readonly surfaceAttribution: "OPERATOR_REPORTED_NOT_MEASURED";
  /** The spec measured, verbatim — pinned equal to {@link WING_HIGHLIGHT_LABELS}.issue by test. */
  readonly measuredSpec: { readonly candidateQuery: "button"; readonly exactText: "API Key 발급 받기" };
  /**
   * The measurement, and ONLY the measurement. Every field is something the probe returned; nothing here is an
   * expectation, an inference, or a property the locator cannot produce.
   */
  readonly measured: {
    /**
     * Candidates matching the fixed label that PAINT, in the sense `paints()` tests: not `display:none`, not
     * `visibility:hidden`, non-zero client rects, non-zero box. It does NOT test `opacity`, occlusion, clipping
     * or viewport position, so "painting" here is weaker than "a human can see it".
     */
    readonly visibleCount: 1;
    /**
     * Matches of THIS spec rejected for not painting. `0` says no non-painting `API Key 발급 받기` node exists —
     * it is silent about the 2026-08-09 decoy, whose text was `발급` and which this spec does not match at all.
     */
    readonly hiddenCount: 0;
    /** MEASURED tag of the unique match. */
    readonly observedTag: "BUTTON";
    /**
     * Returned by the probe, and a restatement of `visibleCount === 1` — it resolves uniquely, so a ring could
     * be attached. No ring was painted on this read-only run, so this is not a confirmation that a highlight is
     * VISIBLE; that is what the operator's own confirmation in the reveal run is for.
     */
    readonly canHighlight: true;
    /** No fault was raised by the probe. */
    readonly fault: null;
  };
  /** Our own fixed label — the same string as `measuredSpec.exactText`. */
  readonly label: "API Key 발급 받기";
  /** Opaque 16-hex structural signature. Provenance only — see `signatureRole`. */
  readonly sig16: string;
  /** How many independent live captures back this record. Exactly one, and it is not to be padded. */
  readonly captureCount: 1;
  /** Honest limit: a single capture cannot demonstrate cross-run signature stability. */
  readonly signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED";
  /** What `sig16` is allowed to be used for. `EVIDENCE_ONLY` ⇒ no runtime gate may read it. */
  readonly signatureRole: "EVIDENCE_ONLY";
  /** The press has never happened. A calibrated locator does not and cannot imply otherwise. */
  readonly pressOutcome: "UNCONFIRMED";
  /**
   * `credentialAnchorPresent` read `true` on the surface this calibration comes from. The anchor reading IS
   * measured; "no-key" is the operator attribution above, so this is corroboration of a standing conclusion
   * rather than an independent proof of it — the anchor is NOT an issued/not-issued discriminator, and nothing
   * in this record may be read as showing a key does or does not exist. Carried here so the conclusion travels
   * with the evidence instead of living only in prose.
   */
  readonly credentialAnchorPresentOnNoKeySurface: true;
  /** The issued-state classifier's answer on that same page. Unchanged by this landing. */
  readonly issuedStateReason: "NO_DISCRIMINATING_SIGNAL";
  /** The record this replaces. History and retraction — never support for the claim above. */
  readonly supersedes: WingIssueCalibrationRefutation;
}

const WING_ISSUE_CALIBRATION_REFUTATION: WingIssueCalibrationRefutation = {
  status: LIVE_DOM_CALIBRATION_REFUTED,
  refutedOn: "2026-08-09",
  claimedOn: "2026-08-08",
  withdrawnRecordIds: Object.freeze([
    "wingrec_fc4cbafb42c8",
    "wingrec_b2e87f42abd1",
    "wingrec_42985b029ddd",
    "wingrec_b554c86c0f0b",
  ]),
  withdrawnSurfaces: Object.freeze(["already_issued_page", "no_key_initial_surface"]) as readonly [
    "already_issued_page",
    "no_key_initial_surface",
  ],
  refutedSpec: Object.freeze({ candidateQuery: "button,a,span,div", exactText: "발급" }),
  refutedObservation: Object.freeze({ visibleMatchCount: 0, nonPaintingMatchCount: 1 }) as {
    readonly visibleMatchCount: 0;
    readonly nonPaintingMatchCount: 1;
  },
  withdrawnSig16: Object.freeze(["d3f775e83c47e9f8", "b7ba43a8e788b4a8"]),
  withdrawnClaim: "FOUR_AGREEING_CAPTURES_WITH_AN_UNMEASURED_ROLE",
};

export const WING_ISSUE_CALIBRATION_EVIDENCE: WingIssueCalibrationEvidence = {
  status: LIVE_DOM_CALIBRATION_CONFIRMED,
  capturedOn: "2026-08-09",
  gitSha: "e8e62981",
  recordId: "wingrec_f5ff0c250e44",
  pageCategory: "open_api_issuance",
  surface: "no_key_initial_surface",
  surfaceAttribution: "OPERATOR_REPORTED_NOT_MEASURED",
  measuredSpec: Object.freeze({ candidateQuery: "button", exactText: "API Key 발급 받기" }) as {
    readonly candidateQuery: "button";
    readonly exactText: "API Key 발급 받기";
  },
  measured: Object.freeze({ visibleCount: 1, hiddenCount: 0, observedTag: "BUTTON", canHighlight: true, fault: null }) as {
    readonly visibleCount: 1;
    readonly hiddenCount: 0;
    readonly observedTag: "BUTTON";
    readonly canHighlight: true;
    readonly fault: null;
  },
  label: "API Key 발급 받기",
  sig16: "e9da2c58eb9fc190",
  captureCount: 1,
  signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED",
  signatureRole: "EVIDENCE_ONLY",
  pressOutcome: "UNCONFIRMED",
  credentialAnchorPresentOnNoKeySurface: true,
  issuedStateReason: "NO_DISCRIMINATING_SIGNAL",
  supersedes: WING_ISSUE_CALIBRATION_REFUTATION,
};

/**
 * Whether the `issue` (발급) fixed label is calibrated — **TRUE**, on the live measurement recorded in
 * {@link WING_ISSUE_CALIBRATION_EVIDENCE}: `visibleCount: 1`, `hiddenCount: 0`, `observedTag: "BUTTON"` from a
 * READ-ONLY probe of the shipped spec on the real no-key surface. It was withdrawn between 2026-08-09 and this
 * landing, and the withdrawal is retained on the record rather than deleted.
 *
 * The correction and the visibility filter that preceded the probe were **not** measurements, which is why this
 * flag stayed `false` through them: re-asserting `true` on the strength of a plausible fix is the identical move
 * that produced the refuted record. What flips it is the probe, and nothing else may.
 *
 * This flag asserts SELECTOR readiness only. It is not an authorization and not a claim about the press: a reveal
 * run still needs the WING flag, URL screening, a PREPARED manifest bound to a fresh `WALKTHROUGH_*` identity,
 * the driver's checkpoint-first invariant, and the operator's own press. The agent's click/type/submit budget on
 * the marketplace remains ZERO, and `pressOutcome` remains `UNCONFIRMED`.
 *
 * Setting it back to `false` must keep the reveal walk fully fail-closed — the manifest reports
 * `selectorsCalibrated: false`, the preflight refuses to display a manifest, the gate refuses with
 * `SELECTORS_NOT_CALIBRATED`, and the driver refuses to highlight. That direction is tested explicitly, and any
 * change to {@link WING_HIGHLIGHT_LABELS}.issue invalidates this flag and requires a fresh probe.
 *
 * Note what this does NOT flip: {@link WING_HIGHLIGHT_CALIBRATION} stays `LIVE_DOM_CALIBRATION_PENDING`, because
 * `self_dev` / `vendor_info` / `call_ip` are still unresolved on every surface measured so far.
 */
export const WING_ISSUE_SELECTOR_CALIBRATED = true as const;

/**
 * Whether the `delete` (삭제) fixed label is calibrated against the REAL WING DOM. **FALSE — withdrawn
 * 2026-08-09**, see {@link WING_DELETION_CALIBRATION_EVIDENCE}. The capture that used to back it was taken with
 * the locator version that could not tell a painting element from a hidden one, and its `role: "button"` was
 * never measured at all. Neither the count nor the identity survives that.
 *
 * The withdrawal is deliberately asymmetric with the 발급 target, which was re-landed the same week. 발급 got a
 * fresh READ-ONLY measurement first; 삭제 has not been re-measured, and this flag must not move until it is. The
 * asymmetry is the point — the flag tracks evidence, not confidence, and the destructive path is exactly where a
 * plausible-but-unmeasured claim costs the most.
 *
 * The whole destructive walk is now fail-closed: the manifest gate refuses with `SELECTORS_NOT_CALIBRATED`, the
 * preflight cannot display a destructive manifest, and the deletion driver refuses to highlight. Nothing is lost
 * that worked — no live deletion run has ever been performed.
 *
 * Restoring it requires a live READ-ONLY delete probe reporting a **visible** unique match with a **measured**
 * tag, on the unchanged spec. Editing this line from anything else is the move that produced the record above.
 * Even then it would assert selector readiness only, never authorization: a deletion run still needs the WING
 * flag, URL screening, a PREPARED destructive manifest bound to a fresh `WALKTHROUGH_*` identity, the driver's
 * checkpoint-first invariant, and the operator's own press of 삭제. The agent's marketplace action budget is ZERO
 * in every state of this flag.
 */
export const WING_DELETION_SELECTORS_CALIBRATED = false;

/** Default seated-operator observe window (the seller works in the WING window). Tests override to instant. */
export const DEFAULT_WING_OBSERVE_TIMEOUT_MS = 10 * 60_000;
/**
 * The structural settle bound. Far shorter than the old 15s `networkidle` wait because it is a real bound on a
 * predicate that actually resolves, not a timeout that was always paid in full.
 */
const STRUCTURAL_SETTLE_TIMEOUT_MS = 3_000;
const STRUCTURAL_POLL_MS = 100;
const LOCATOR_SETTLE_MS = 400;
const VERIFY_MAX_POLLS = 12;
const VERIFY_POLL_MS = 500;
const OPEN_NAV_POLL_MS = 1_000;
const OVERLAY_ADVANCE_POLL_MS = 500;

/**
 * The opaque per-step latch token for a checkpoint's WING-resident advance button. Value-free — a fixed derived
 * string, compared only for equality, never a page value. Distinct per target so a stale press from a prior step
 * can never satisfy the next one's poll.
 */
function advanceToken(target: CoupangIssuanceTarget): string {
  return `coupang-issuance-advance:${target}`;
}

/**
 * The WING-resident advance button caption per checkpoint — the button the seller presses ON THE WING PAGE to
 * advance the guided walk (so they never bounce back to the SellerOps tab to press "다음"). `reach_open_api` has
 * NO button: it is the one step that auto-advances on the observed `wing_home → open_api_issuance` navigation.
 * `issue` and `credentials` deliberately confirm the seller's own manual act (press 발급 / copy the keys) — the
 * driver still presses nothing and reads no value.
 */
const ADVANCE_BUTTON_LABEL: Readonly<Partial<Record<CoupangIssuanceTarget, string>>> = {
  issue: "발급 화면이 열렸어요 · 다음",
  confirm_purpose: "확인을 눌렀어요 · 다음",
  terms_consent: "동의했어요 · 다음",
  issue_final: "눌렀어요 · 다음",
  vendor_method: "선택했어요 · 다음",
  // THE key-creation step. Its caption confirms the seller's own act AFTER the fact; nothing here presses it,
  // and the step advances by itself the moment WING shows the keys — this button is the fallback for a screen
  // that did not change the way the measurement says it should.
  vendor_confirm: "확인을 눌렀어요 · 다음",
  credentials: "복사했어요 · 다음",
  // The return step hands focus back to SellerOps; the SellerOps tab then owns the "enter keys" CTA, so this
  // on-page button is purely "go back" (avoids two near-identical "enter keys" buttons across the two windows).
  return: "SellerOps로 돌아가기",
};

/**
 * The measured screen each checkpoint's own action makes appear. Watching for it is what removes the seller's
 * "다음" press — the page proving the action happened is strictly better evidence than them telling us.
 *
 * `terms_consent` is deliberately absent: ticking two boxes changes no screen, so it is observed differently
 * (see {@link observeConsentComplete}). `issue_final` is absent for a different reason — it is the key-creation
 * boundary and nothing about it may auto-advance.
 */
const CHECKPOINT_ADVANCES_TO_SCREEN: Readonly<Partial<Record<CoupangIssuanceTarget, WingFlowScreen>>> = {
  issue: "PURPOSE",
  confirm_purpose: "TERMS",
  // MEASURED 2026-08-12 on two checkpoints: pressing `약관 동의 및 Key 발급받기` opens the vendor-method screen
  // and issues no key. This entry is the whole difference between a walk that rests in front of that control
  // because what follows is unknown, and one that knows.
  issue_final: "VENDOR_METHOD",
};

/**
 * **The step that advances on a PAGE CATEGORY rather than a flow screen** — the key-issuing 확인.
 *
 * A sibling map rather than an entry in the one above, because what it waits for is a different kind of fact.
 * The flow screens are three states of one page, told apart by fixed labels; the credentials appearing is the
 * sanitized page category the classifier already produces, and the walk has read it since its first step.
 *
 * **This does not auto-advance the PRESS.** The seller presses 확인 themselves; this observes that WING then
 * showed the keys. An observation of a result cannot cause it, and the ordering is what makes that plain: the
 * category cannot become `credential_shown` before a credential exists.
 */
const CHECKPOINT_ADVANCES_TO_CATEGORY: Readonly<Partial<Record<CoupangIssuanceTarget, WingPageCategory>>> = {
  vendor_confirm: "credential_shown",
};

/** How often the screen observation runs. Slower than the latch poll: it costs three in-page locates. */
const SCREEN_OBSERVE_POLL_MS = 1_000;

/** Bounded sleep between navigation-observe polls (no wall-clock read; timer only). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A DEFINITIVE reach landing category for VERIFY_REACH polling — the categories that STOP the poll because they
 * will not change under further hydration: `open_api_issuance` (success), `credential_shown` (already past issue),
 * or `login` (session lost, recoverable). Transient hydration states (`unknown`, still-`wing_home`) keep polling.
 */
function isVerifyResolved(category: WingPageCategory): boolean {
  return category === "open_api_issuance" || category === "credential_shown" || category === "login";
}

/** The overlay step number per barrier (dev diagnostic badge only — cosmetic, mirrors the engine's plan). */
const OVERLAY_STEP: Readonly<Record<CoupangIssuanceTarget, number>> = {
  reach_open_api: 1,
  issue: 2,
  confirm_purpose: 3,
  terms_consent: 4,
  issue_final: 5,
  vendor_method: 6,
  vendor_confirm: 7,
  credentials: 8,
  return: 9,
};

/**
 * The WING-RESIDENT guidance copy shown in the on-page panel for each step — this IS the seller-facing guidance
 * during the walk, rendered ON the WING page next to the advance button, so the seller's primary screen stays
 * WING (no bounce back to the SellerOps tab per step). Every step is the SELLER's own act: SellerOps never
 * presses 발급 and never reads the Access Key / Secret Key / 업체코드. `reach_open_api` auto-advances on the
 * observed navigation (no button); every other step advances on the seller pressing THIS panel's button.
 *
 * **Exported so the frontend's copy can be PINNED to it.** `frontend/src/lib/actionWindow/copy.ts` claims to
 * carry these strings verbatim; nothing asserted it, and three had already drifted back to the pre-auto-advance
 * wording. `test/crossstack/coupang-issuance-fe-copy-parity.test.ts` is the assertion.
 */
export const OPERATOR_STEP_LABELS: Readonly<Record<CoupangIssuanceTarget, string>> = {
  reach_open_api: "WING에 로그인한 뒤 '오픈API 키 발급' 페이지로 이동하세요. 도착하면 자동으로 넘어갑니다.",
  issue: "'API Key 발급 받기'를 직접 누르세요. 키는 아직 만들어지지 않고 사용 목적 화면만 열립니다. 화면이 열리면 자동으로 넘어갑니다.",
  confirm_purpose: "사용 목적이 'OPEN API'인지 확인하고(기본값입니다) '확인'을 직접 누르세요. 이 버튼도 키를 만들지 않고 약관 화면을 엽니다. 화면이 열리면 자동으로 넘어갑니다.",
  terms_consent: "약관을 직접 읽고 판단하신 뒤 동의 체크박스 2개를 선택하세요. SellerOps는 약관을 읽지도, 대신 동의하지도, 체크하지도 않습니다. 2개가 모두 선택되면 자동으로 넘어갑니다(선택 여부는 저장·전송하지 않습니다).",
  // NOT trimmed. Every sentence here is a safety claim the approval harness reproduces and asserts before the
  // operator grants (`wing-walk-selfcheck.sh`, "the COMPLETE Korean copy of the key-creation step").
  //
  // CORRECTED 2026-08-12. It read "⚠ 여기서 실제로 키가 생성됩니다 … 발급이 끝나면" — and the key is not created
  // here. The control was pressed on the live walk and no key was issued; an integration-method form appears
  // instead, and the operator reports the key is issued by THAT screen's 확인
  // (`WING_KEY_CREATION_CONTROL_REFUTATION`). Telling the seller a key is about to be created, at a button that
  // does not create one, is a false warning — and a false warning spends the credibility the true ones need.
  //
  // What the copy must still do is unchanged: this is where the guidance STOPS, SellerOps never presses it, and
  // nothing auto-advances past it. The reason is now the honest one — what follows has never been measured.
  // CORRECTED AGAIN 2026-08-12, and the correction is a REMOVAL. It said "그 화면은 아직 SellerOps가 안내하지
  // 않으니 직접 진행해 주세요" — true when written, false since the vendor screen was measured. Guidance that
  // apologises for not guiding, on a step that now guides, is the same class of stale safety copy as the
  // key-creation warning this string already had to lose.
  issue_final: "'약관 동의 및 Key 발급받기'를 직접 누르세요 — SellerOps는 이 버튼을 절대 누르지 않습니다. 이 버튼에서는 키가 발급되지 않고 연동 방식을 고르는 화면이 열립니다(live walk 2회에서 그렇게 보고되었습니다. SellerOps는 키 발급 여부를 확인할 수 없습니다). 그 화면이 열리면 자동으로 넘어갑니다.",
  vendor_method: "입력 방식에서 '자체개발(직접입력)'을 직접 선택하세요 — SellerOps는 선택하지 않습니다. 선택하면 URL · IP 주소 입력란이 더 나타납니다(업체명은 이미 화면에 있습니다). 선택한 뒤 아래 버튼을 누르세요.",
  // NOT trimmed, and every sentence is a safety claim the approval harness reproduces before the operator
  // grants. This is the one step in the whole walk that brings an irreversible marketplace credential into
  // existence, and the seller is the only one who can do it.
  vendor_confirm: "업체명 · URL을 입력하고, IP 주소는 입력한 뒤 옆의 '추가'를 눌러 등록하세요 — 추가하지 않으면 IP가 등록되지 않습니다. 그 다음 '확인'을 직접 누르세요. ⚠ 여기서 실제 API 키가 발급됩니다 — 되돌릴 수 없습니다. SellerOps는 이 버튼을 절대 누르지 않고, 입력란에 아무것도 쓰지 않습니다. 키가 화면에 표시되면 자동으로 넘어갑니다.",
  credentials: "표시된 Access Key / Secret Key / 업체코드를 직접 복사하세요. SellerOps는 값을 읽지 않습니다. 복사했으면 아래 버튼을 누르세요.",
  return: "아래 버튼을 눌러 SellerOps로 돌아가세요. 복사한 키를 입력하면 연결이 끝납니다.",
};

/**
 * **The chip above the highlighted control** — which step this is, not what to do about it.
 *
 * The instruction lives in the panel, which wraps and has room for it. The chip cannot wrap (it would grow down
 * over the control it points at), so a full instruction there ran off the viewport: live-observed 2026-08-11 at
 * the key-creation step, cutting off exactly "SellerOps는 이 버튼을 절대 누르지 않고, 자동으로 넘어가지도
 * 않습니다". Two renderings of one sentence, one of them silently incomplete — and the incomplete one sat on
 * the control that creates the key.
 *
 * Each is a NOUN PHRASE naming the control or the act, never an abbreviated instruction: a shortened
 * instruction is how a safety clause gets dropped and still reads like guidance.
 */
export const OPERATOR_STEP_TITLES: Readonly<Record<CoupangIssuanceTarget, string>> = {
  reach_open_api: "오픈API 키 발급 페이지로 이동",
  issue: "'API Key 발급 받기' 누르기",
  confirm_purpose: "사용 목적 확인 후 '확인'",
  terms_consent: "약관 2건 동의",
  // The chip named a consequence this control does not have (see the panel copy above, corrected 2026-08-12).
  // It now names the control, like every other chip — the panel carries what is true about it.
  issue_final: "'약관 동의 및 Key 발급받기' 누르기",
  vendor_method: "입력 방식 '자체개발(직접입력)' 선택",
  // The one chip in the walk that names a CONSEQUENCE, because this control has one and it is irreversible.
  // Every other chip names the control; this is the exception the panel copy alone should not have to carry.
  vendor_confirm: "'확인' 누르기 (키 발급)",
  credentials: "키 3개 복사",
  return: "SellerOps로 돌아가기",
};

/** A browser context whose newest tab may hold the step the seller opened. Structural subset of Playwright's. */
export interface WingContextLike {
  pages(): Page[];
  on?(event: "close", handler: () => void): void;
}

export interface CoupangWingIssuanceDriverOptions {
  /** Bounded window for the seller to act on a highlighted control. Defaults to {@link DEFAULT_WING_OBSERVE_TIMEOUT_MS}. */
  observeTimeoutMs?: number;
  guidanceEnabled?: boolean;
  /** Optional context so the driver reads the NEWEST tab (the seller may open a step in a new tab). */
  context?: WingContextLike;
  /** Pause between VERIFY_REACH settle-polls. Defaults to {@link VERIFY_POLL_MS}; tests set 0. */
  verifyPollMs?: number;
}

/**
 * FIXED, synthetic guidance signatures for the two guidance-only targets (`reach_open_api`, `return`). Neither is
 * a WING control — they are text guidance — so these are NOT derived from any page element. Stable opaque 16-hex
 * constants so the engine's locate↔highlight anti-drift check (which requires the two sigs to match) still passes.
 */
const REACH_OPEN_API_GUIDANCE_SIG = "c0a9b17ec0a9b17e";
const RETURN_GUIDANCE_SIG = "5e11e40b5e11e40b";
/**
 * **TEXT-GUIDED steps: the ones the tutorial guides but cannot highlight.**
 *
 * The 2026-08-10 redesign added four such steps — the purpose radios, `확인`, the consent boxes and the walk's
 * last control. All four were MEASURED and none PROMOTED, so there was no locator to spotlight. **All four have
 * since been promoted** (the last control on 2026-08-11, the other three on 2026-08-12), so `confirm_purpose`
 * and `terms_consent` now take the ring path and reach this map only if a calibration is WITHDRAWN. That
 * fallback is why their entries stay: a withdrawn promotion must land on a docked panel, never back on the
 * `{ count: 0 }` dead end described next. The driver
 * documented exactly that ("a tutorial step for an unpromoted control guides by TEXT") and then returned
 * `{ count: 0 }` for them, which the engine reads as `NONE` and parks `target_not_found` — permanently, because
 * a re-check re-locates and finds nothing again. The redesigned walk could not get past step 3.
 *
 * No test caught it: the session and engine suites drive a fixture driver that answers `count: 1` for every
 * target, so the fixture stood one layer away from the thing it modelled. This constant is the repair, and it
 * promotes NOTHING — a text-guided step gets the guidance panel and its advance button, and no spotlight ring.
 *
 * **`reach_open_api` and `return` belong here too, and were left out.** Both are locator-less guidance in
 * exactly the same sense — their sigs are synthetic constants, not derived from any element — but they kept a
 * separate branch that mounted an ANCHORED overlay, i.e. the defect this map exists to fix:
 *   - `return` followed the `credentials` step, whose `data-aw-target` is still on the Access Key row (nothing
 *     clears a tag between steps), so the ring landed on the Access Key row while the panel read
 *     `SellerOps로 돌아가기 7/7`;
 *   - `reach_open_api` runs on a fresh window where no tag exists at all, so `mountOverlay` returned having
 *     created NOTHING — and the branch answered `{count:1}` regardless, so the engine barriered on step 1 with
 *     no on-page instruction rendered anywhere.
 * One map, one branch: a guidance step clears the prior tag, mounts docked, and reports what actually mounted.
 */
/**
 * **The ring PLAN for the two steps that describe more than one control.**
 *
 * `confirm_purpose` asks the seller to check the purpose and then press 확인; `terms_consent` asks them to tick
 * two separate consents. A single ring cannot express either, and a step that ringed only the first tagged
 * element while the panel described both would be pointing at half of what it says.
 *
 * `primary` is the control the chip names and the page-dimming shroud is punched around — the ACT, not the thing
 * to read: pressing 확인 is what advances the purpose screen. The consents have no such asymmetry, so the first
 * one leads and the second is its equal beside it.
 *
 * **This map promotes nothing by itself.** Every entry is resolved through {@link wingGuidedHighlightPromotion},
 * and an entry whose promotion is withdrawn simply drops out of the plan. As of 2026-08-12 all four ARE
 * promoted, so this is the LIVE path for steps 3 and 4 — the comment said the opposite for as long as it took
 * the calibration to land, which is the kind of drift a reader has no way to catch.
 */
const GUIDED_RING_PLAN: Readonly<
  Partial<Record<CoupangIssuanceTarget, { readonly primary: WingGuidedHighlightTarget; readonly also: readonly WingGuidedHighlightTarget[] }>>
> = {
  confirm_purpose: { primary: "confirm", also: ["purpose_open_api"] },
  terms_consent: { primary: "consent_api", also: ["consent_category"] },
  // One control each. They go through the ring path rather than `WING_HIGHLIGHT_LABELS` for the reason the plan
  // exists: the spec is resolved from the PROMOTION record by id, so withdrawing either calibration removes its
  // ring by itself instead of leaving a hand-written query pointing at a control nothing measured.
  vendor_method: { primary: "vendor_self_dev", also: [] },
  vendor_confirm: { primary: "vendor_confirm", also: [] },
};

/**
 * The PROMOTED specs for a step, primary first. Empty ⇒ nothing was promoted and the step is text-guided.
 *
 * Fail-closed PER CONTROL, not per step. An unpromoted sibling must not suppress a promoted one (that would
 * silently withdraw a calibration nobody withdrew), and a promoted one must not drag an unpromoted one along
 * (that is the promotion this unit is forbidden to make). If the planned primary is not promoted, the first
 * promoted sibling leads — a ring set with no primary would put the chip wherever document order happened to
 * land it.
 *
 * Specs are RESOLVED BY ID from the recon candidates, never re-typed here: the promotion record names an id, and
 * `KEY_CREATION_SPEC` is in this file for the same reason — a second hand-written copy is how a ring ends up
 * pointing with a string the calibration no longer covers.
 */
function promotedRingSpecs(target: CoupangIssuanceTarget): readonly WingFlowScreenMarkerSpec[] {
  const plan = GUIDED_RING_PLAN[target];
  if (!plan) return [];
  const specs: WingFlowScreenMarkerSpec[] = [];
  for (const t of [plan.primary, ...plan.also]) {
    const p = wingGuidedHighlightPromotion(t);
    if (!p.promoted || !p.candidateId) continue;
    specs.push(wingCandidateSpecById(p.candidateId));
  }
  return specs;
}

/**
 * Fold several opaque per-element signatures into one, so a multi-ring step has a single value for the engine's
 * locate↔highlight anti-drift check.
 *
 * Structural, like the signatures it folds: an FNV-1a over the concatenated hex, computed host-side over values
 * that are already opaque. It reads no page content and adds no new exposure — and it is ORDER-SENSITIVE on
 * purpose, because the ring set is ordered (primary first) and two steps that tagged the same elements in a
 * different order are not the same presentation.
 */
function foldSigs(sigs: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const s of sigs.join("|")) {
    h ^= s.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // 16 hex, matching the in-page signature width so nothing downstream has to special-case a folded one.
  const half = h.toString(16).padStart(8, "0");
  return `${half}${half}`;
}

const TEXT_GUIDED_SIG: Readonly<Partial<Record<CoupangIssuanceTarget, string>>> = {
  reach_open_api: REACH_OPEN_API_GUIDANCE_SIG,
  confirm_purpose: "b48e2f05b48e2f05",
  terms_consent: "16d9c7ba16d9c7ba",
  return: RETURN_GUIDANCE_SIG,
};

/**
 * Has the surface painted anything readable? An ES5-plain STRING, like every other in-page script here
 * (tsx/esbuild injects a `__name` helper into serialized functions, which the page then throws on).
 *
 * Value-free by construction: it returns one boolean and reads no text, attribute, URL, or field value. It is
 * deliberately cruder than the classifier — its only job is "is there a document with laid-out content yet",
 * so that a read happens as soon as one exists instead of after a fixed wait.
 */
const WING_SURFACE_PAINTED = `(function () {
  /* coupang-issuance-painted */
  try {
    if (document.readyState === "loading") return false;
    var b = document.body;
    if (!b) return false;
    var r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch (e) {
    return false;
  }
})()`;

/**
 * Remove every read-only ring annotation — BOTH markers. Value-free; safe on a page with none.
 *
 * `data-aw-primary` was added beside `data-aw-target` when a step gained the ability to ring several controls,
 * and this clear was left stripping only the first. Both tagging scripts always write and clear the two
 * together, so the asymmetry lived exactly here: after a `clearHighlight()` the last primary kept a stale
 * `data-aw-primary`, and a later ring-plan tag only strips markers from elements still carrying
 * `data-aw-target` — so that element could be re-tagged while a second one still claimed the chip, and the
 * overlay would put it on whichever came first in document order. Not reachable with today's two ring plans,
 * and repaired anyway: it is the "fixed in one place, left standing in the sibling" shape this workstream keeps
 * paying for.
 */
const IN_PAGE_CLEAR_TAG = `(function () {
  /* coupang-issuance-cleartag */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var els = slice(document.querySelectorAll('[data-aw-target],[data-aw-primary]'));
  for (var i = 0; i < els.length; i++) { els[i].removeAttribute('data-aw-target'); els[i].removeAttribute('data-aw-primary'); }
  return true;
})()`;

export class CoupangWingIssuanceDriver implements CoupangIssuanceProbeDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingIssuanceDriverOptions;
  private readonly closed: Promise<void>;

  constructor(page: Page, opts: CoupangWingIssuanceDriverOptions = {}) {
    this.page = page;
    this.opts = opts;
    this.closed = new Promise<void>((resolve) => {
      let done = false;
      const fire = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      page.on("close", fire);
      opts.context?.on?.("close", fire);
    });
  }

  /** The page all surface work runs against: the newest tab when a context is injected, else the single page. */
  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  /** Evaluate a STRING snippet (not a function) so esbuild's `__name` shim is never referenced in the page. */
  private evalStr<R>(page: Page, script: string): Promise<R> {
    return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
  }

  /** Best-effort settle; a page without `waitForLoadState` (offline fake) is left as-is. */
  /**
   * Settle the surface enough to read it — on a STRUCTURAL predicate, not on the network going quiet.
   *
   * `networkidle` was the wrong signal and cost the seller 15 seconds at every step. WING keeps sockets and
   * analytics open indefinitely, so the wait never succeeded; it always burned the full timeout and returned,
   * and two of them in one transition is the ~30s pause observed live on 2026-08-10. The page was READABLE the
   * whole time.
   *
   * What replaces it asks the only question the reader actually has — has the document stopped loading and
   * painted something — and polls it cheaply. A page that never satisfies it still proceeds after a short
   * bound: the classifier fails closed on thin signals, so reading early is safe, while waiting is not free.
   */
  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      // `domcontentloaded` is a real event on every navigation, unlike `networkidle`. Cheap, and it resolves
      // immediately when the document is already past it.
      await p.waitForLoadState("domcontentloaded", { timeout: STRUCTURAL_SETTLE_TIMEOUT_MS });
    } catch {
      /* already past it, or the page is slow — the structural poll below is the real gate */
    }
    const deadline = STRUCTURAL_SETTLE_TIMEOUT_MS;
    for (let waited = 0; waited < deadline; waited += STRUCTURAL_POLL_MS) {
      const painted = await this.evalStr<boolean>(page, WING_SURFACE_PAINTED).catch(() => false);
      if (painted === true) return;
      await sleep(STRUCTURAL_POLL_MS);
    }
  }

  async settleSurface(): Promise<void> {
    await this.settle(this.activePage());
  }

  async probeSurface(): Promise<WingSurfaceProbe> {
    await this.settle(this.activePage());
    return this.readSurface();
  }

  /**
   * READ-ONLY shape census of the surface's choice controls — counts and closed-vocabulary categories only.
   *
   * A DEDICATED method rather than a general `evaluate` seam on purpose: exposing "run this string in the page"
   * would make the driver's page-side surface unbounded and unauditable. This adds exactly one audited constant
   * to the set of scripts the driver can run.
   *
   * Note what is NOT true of this driver, since an earlier version of this comment claimed it: the
   * evaluated-script SET is not bounded by a test here. `CoupangWingRevealDriver` has that guard (it asserts an
   * exact `evalStr` call count); this driver has seven call sites and no such bound, so an eighth would be
   * invisible. The source guard that does hold forbids every click/type/submit and every value read.
   */
  async choiceControlCensus(): Promise<WingChoiceControlCensus | null> {
    const page = this.activePage();
    await this.settle(page);
    // Re-sanitized host-side: the script maps to the allow-lists, and this guarantees the record's vocabulary
    // even if a future edit to the script forgets to. `null` when the page returned nothing usable — NOT a
    // census reporting zero choice controls, which is what this seam used to hand back.
    return sanitizeChoiceControlCensus(await this.evalStr<unknown>(page, EXTRACT_WING_CHOICE_CONTROL_SHAPES));
  }

  /**
   * READ-ONLY label-ASSOCIATION census of the choice controls, compared against the caller's OWN fixed candidate
   * strings. One in-page evaluation of an audited script whose entire output is integers, booleans, closed
   * category names, and indices into the candidate list the caller supplied. It highlights nothing, tags nothing,
   * clicks nothing, selects nothing, and reads no field value — and it deliberately does not read `checked`.
   *
   * A dedicated method rather than a general `evaluate` seam, for the same reason `choiceControlCensus` is one:
   * a generic escape hatch on this driver is a place where an unaudited script can later be run under a
   * READ_ONLY manifest.
   */
  /**
   * READ-ONLY consent-BLOCK census: for each visible checkbox, the nearest ancestor whose text holds exactly one
   * of the caller's consent sentences.
   *
   * Its own seam for the reason the other two are: this is a distinct measurement, separately described in the
   * manifest, and a generic evaluate hatch is where an unaudited script later runs under a READ_ONLY grant. It
   * reads no `checked` — which box the seller ticked is their business and not a thing this records.
   */
  async consentBlockCensus(consents: readonly string[]): Promise<WingConsentBlockCensus | null> {
    const page = this.activePage();
    await this.settle(page);
    const raw = await this.evalStr<unknown>(page, buildWingConsentBlockScript([...consents]));
    return sanitizeConsentBlockCensus(raw, consents);
  }

  async choiceAssociationCensus(candidates: readonly string[]): Promise<WingChoiceAssociationCensus | null> {
    const page = this.activePage();
    await this.settle(page);
    const raw = await this.evalStr<unknown>(page, buildWingChoiceAssociationScript([...candidates]));
    // `null` when the page returned nothing usable — NOT a census reporting zero controls. See the sanitizer.
    return sanitizeChoiceAssociationCensus(raw, candidates);
  }

  /**
   * READ-ONLY fixed-label CONTAINMENT probe for one candidate spec: the exact-match counts the locate seam
   * already produces, split by paint, PLUS how many innermost elements merely CONTAIN the label. Four integers
   * and a boolean; no text, no element identity, no mutation.
   *
   * Like `probeFixedLabelMatch` — and unlike the association census, which mirrors the shape census — it does
   * NOT settle first. The two reads it is compared against are the locate seam's, taken the same way; adding a
   * settle here would make the "agrees with the locate script" comparison hold under different conditions.
   *
   * This is what turns a `matchCount: 0` from a dead end into a diagnosis — "the label is not on this page" and
   * "the label is on this page but not as an element's whole text" are the two readings the Stage-2 recon could
   * not tell apart, and it recorded an INFERRED explanation because of it.
   */
  async probeLabelContainment(spec: { candidateQuery: string; exactText: string }): Promise<FixedLabelContainmentReading | null> {
    const page = this.activePage();
    const raw = await this.evalStr<unknown>(page, buildFixedLabelContainmentScript(spec));
    // `null` when the page returned nothing usable. A zeroed reading here would fold to `ABSENT_EVERYWHERE` —
    // a confident measured absence produced by a probe that measured nothing.
    return sanitizeContainmentReading(raw);
  }

  /** Classify the CURRENT surface WITHOUT settling — the value-free census + host-category read. */
  private async readSurface(): Promise<WingSurfaceProbe> {
    const page = this.activePage();
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    // The raw URL is reduced to a host CATEGORY and never logged/emitted; only the enum is used.
    const urlCategory = classifyWingUrlCategory(page.url());
    const { pageCategory, signals } = wingPageCategoryFromCensus(urlCategory, census);
    if (pageCategory === "login") {
      log("aw_coupang_issuance_probe", { pageCategory, ok: false });
      return { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" };
    }
    log("aw_coupang_issuance_probe", { pageCategory, ok: true });
    return { ok: true, pageCategory, signals };
  }

  /** VERIFY_REACH's bounded-polling probe: ride out a transient mid-hydration `unknown` before it settles. */
  async probeSurfaceSettled(): Promise<WingSurfaceProbe> {
    const pollMs = this.opts.verifyPollMs ?? VERIFY_POLL_MS;
    let last = await this.probeSurface();
    for (let i = 1; i < VERIFY_MAX_POLLS && !isVerifyResolved(last.pageCategory); i++) {
      if (pollMs > 0) await sleep(pollMs);
      last = await this.readSurface();
    }
    return last;
  }

  /**
   * Resolve a fixed-label highlight target read-only, and (when `tag`) move the `data-aw-target` annotation onto
   * the unique match. Delegates ALL text reading to the audited value-free {@link buildFixedLabelLocateScript}
   * (returns only `{ count, sig? }`) — this driver's own source reads no text/attribute/value. `count !== 1`
   * parks upstream (`target_not_found` recoverable).
   */
  private async resolveFixedLabelTarget(target: WingHighlightTarget, tag: boolean): Promise<LocateResult> {
    return this.resolveFixedLabelSpec(WING_HIGHLIGHT_LABELS[target], tag);
  }

  /**
   * The generic value-free fixed-label locate: run the audited {@link buildFixedLabelLocateScript} for ANY fixed
   * WING label spec (issuance target OR the deletion target), returning only `{ count, sig? }`. Shared by
   * {@link resolveFixedLabelTarget} and {@link probeFixedLabelMatch} so the deletion probe uses the exact same
   * value-free path as the issuance probe — no new text/attribute/value read is introduced.
   */
  private async resolveFixedLabelSpec(
    spec: { candidateQuery: string; exactText: string; tagAncestor?: string },
    tag: boolean,
  ): Promise<LocateResult> {
    const script = buildFixedLabelLocateScript({
      candidateQuery: spec.candidateQuery,
      exactText: spec.exactText,
      tag,
      ...(spec.tagAncestor ? { tagAncestor: spec.tagAncestor } : {}),
    });
    const page = this.activePage();
    const res = await this.evalStr<LocateResult>(page, script);
    // `hiddenCount`/`tag` survive the narrowing: a recorder that cannot report the MEASURED tag can only report an
    // expected one, which is how `role: "button"` entered a calibration record without ever being observed.
    const hidden = typeof res?.hiddenCount === "number" ? { hiddenCount: res.hiddenCount } : {};
    if (res.count !== 1 || !res.sig) return { count: res.count, ...hidden };
    return { count: 1, sig: res.sig, ...hidden, ...(res.tag ? { tag: res.tag } : {}) };
  }

  /**
   * Which measured FLOW SCREEN the seller is currently on — the observation the auto-advance rests on.
   *
   * The coarse `pageCategory` cannot answer this: the issuance page, the purpose screen and the terms screen all
   * classify as `open_api_issuance`, because they share the open-API marker. Screen identity comes from the
   * markers the discovery runs measured, with the SAME precedence as {@link wingFlowScreenFrom} — **TERMS wins**
   * a tie, because the terms screen is the one carrying the key-creation control and a reading that could be
   * either must resolve to the one where stopping is correct.
   *
   * Value-free: it runs the audited fixed-label locate for each marker and looks only at the visible count. No
   * new in-page script, no text read, no URL, no field value.
   *
   * `UNRECOGNIZED` is the honest answer for "not one of the screens we have measured" — including every screen
   * before the seller has got anywhere. Callers must treat it as "not there yet", never as drift.
   */
  async probeFlowScreen(): Promise<WingFlowScreen> {
    // EVERY terms marker is read, not just enough of them to decide. Short-circuiting on the first visible one
    // was correct for the verdict and wrong for the evidence: `stage3.terms.heading` sits first in the array, so
    // on the live walk of 2026-08-10 it answered TERMS and `stage3.terms.issue_final` — the key-creation control
    // — was never read on the terms screen at all. The only readings that existed were from the PURPOSE screen,
    // where it is hidden, so the run produced no basis for promoting it and the sitting had to be repeated.
    //
    // Reading both costs one extra in-page locate on the screen where the walk stops anyway.
    //
    // VENDOR_METHOD is read FIRST, and this ladder must stay in the same order as the pure
    // `wingFlowScreenFrom` — because the vendor screen REPLACES the terms screen rather than overlaying it,
    // measured 2026-08-12. Reversing them would answer TERMS on a screen whose terms markers are hidden.
    //
    // This branch was MISSING on the live walk of 2026-08-12: the marker specs existed, the pure resolver knew
    // the screen, `CHECKPOINT_ADVANCES_TO_SCREEN` pointed `issue_final` at it, and the tests pinned all three —
    // but the ladder that actually runs still had only two rungs, so the probe answered UNRECOGNIZED on the
    // vendor screen and the advance could never fire. The record was fenced; the runtime was not.
    let vendor = false;
    for (const spec of WING_VENDOR_METHOD_SCREEN_MARKER_SPECS) {
      if (await this.markerVisible(spec)) vendor = true;
    }
    if (vendor) return "VENDOR_METHOD";
    let terms = false;
    for (const spec of WING_TERMS_SCREEN_MARKER_SPECS) {
      if (await this.markerVisible(spec)) terms = true;
    }
    if (terms) return "TERMS";
    return (await this.markerVisible(WING_PURPOSE_SCREEN_MARKER_SPEC)) ? "PURPOSE" : "UNRECOGNIZED";
  }

  /**
   * Is this marker PAINTING on the current surface? A hidden match is not a screen the seller can see, which is
   * the distinction that invalidated an earlier calibration record — so `count` alone is not the test.
   */
  private async markerVisible(spec: WingFlowScreenMarkerSpec): Promise<boolean> {
    const res = await this.resolveFixedLabelSpec(spec, false).catch(() => ({ count: 0 }) as LocateResult);
    // The MEASUREMENT, recorded. Both flow-screen markers are unproven — the purpose heading has never been
    // matched by any apparatus, and the terms markers were transcribed off a screen rather than resolved by
    // one — so a live walk has to be able to say which of them actually fires. Without this the auto-advance
    // would fall back to the seller's button and look indistinguishable from having worked.
    //
    // Sanitized: a candidate ID and integers. No text, no URL, no value. `hiddenCount` and `tag` travel because
    // a hidden match is not a screen the seller can see, and a tag that was expected rather than OBSERVED is
    // how a calibration record went wrong here before.
    log("aw_coupang_flow_marker", {
      markerId: spec.id,
      visibleCount: res.count,
      ...(typeof res.hiddenCount === "number" ? { hiddenCount: res.hiddenCount } : {}),
      ...(res.tag ? { observedTag: res.tag } : {}),
    });
    return res.count >= 1;
  }

  /**
   * READ-ONLY: the full sanitized {@link WingObservation} of the CURRENT surface — page category + bucketized
   * signals + calibration blockers (always carries `LIVE_DOM_CALIBRATION_PENDING`). Built from the value-free
   * census + host-category read, exactly like {@link readSurface}, so nothing here reads a value/URL/text. This
   * is what the read-only selector recorder prints alongside each target's matchCount so the later live run
   * yields a machine-checkable calibration record.
   */
  async observeSurface(): Promise<WingObservation> {
    const page = this.activePage();
    await this.settle(page);
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    // Raw URL reduced to a host CATEGORY (never logged/emitted); only the enum feeds the classifier.
    const urlCategory = classifyWingUrlCategory(page.url());
    return observeFrom(urlCategory, census);
  }

  /**
   * READ-ONLY selector-recorder seam (mirrors {@link NaverIssuanceDriver.probeTargetMatch}): measure how many
   * candidates a highlight target's fixed-label locator matches on the CURRENT page, whether it resolves uniquely
   * (`matchCount === 1`), and — for a unique match — its opaque 16-hex structural signature. It runs the SAME
   * value-free {@link resolveFixedLabelTarget} locate WITHOUT tagging (no `data-aw-target` write) and mounts NO
   * overlay, so it never mutates the page, clicks, types, or reads a field value (incl. Access Key / Secret Key /
   * 업체코드). The `sig` is computed in-page from tag + position + child count only — never any value/attribute.
   */
  async probeTargetMatch(target: WingHighlightTarget): Promise<WingFixedLabelProbe> {
    return this.probeFixedLabelMatch(WING_HIGHLIGHT_LABELS[target]);
  }

  /**
   * READ-ONLY selector-recorder seam for ANY fixed WING label spec (issuance targets AND the deletion 삭제
   * target): measure how many candidates the fixed-label locator matches on the CURRENT page, whether it resolves
   * uniquely (`matchCount === 1`), and — for a unique match — its opaque 16-hex structural signature. Runs the same
   * value-free {@link resolveFixedLabelSpec} locate WITHOUT tagging and mounts NO overlay, so it never mutates the
   * page, clicks, types, or reads a field value (incl. Access Key / Secret Key / 업체코드). Lets the recorder
   * calibrate the 삭제 control on the already-issued page without ever pressing or highlighting it.
   */
  async probeFixedLabelMatch(spec: {
    candidateQuery: string;
    exactText: string;
    tagAncestor?: string;
  }): Promise<WingFixedLabelProbe> {
    const res = await this.resolveFixedLabelSpec(spec, false);
    const matchCount = typeof res?.count === "number" && res.count >= 0 ? res.count : 0;
    const canHighlight = matchCount === 1;
    const extra = {
      ...(typeof res?.hiddenCount === "number" ? { hiddenMatchCount: res.hiddenCount } : {}),
      ...(res?.tag ? { observedTag: res.tag } : {}),
    };
    return canHighlight && res.sig ? { matchCount, canHighlight, sig: res.sig, ...extra } : { matchCount, canHighlight, ...extra };
  }

  /**
   * Resolve a step's whole PROMOTED ring set — every spec must land on exactly one painting element, or the step
   * does not ring at all.
   *
   * **All-or-nothing, and that is the honest reading.** A partially-resolved set means the page is not the one
   * the calibration was taken on, and drawing the rings that happened to resolve would present a confident,
   * incomplete picture of a screen we have just discovered we do not recognise. The failing spec's own count is
   * returned so the park upstream says `target_not_found` about a real miss rather than a synthesised zero.
   *
   * When tagging, the prior step's tags are cleared ONCE up front and every spec then tags additively — a
   * per-call clear would leave only the last one tagged, which is the single-ring assumption this exists to lift.
   */
  private async resolveRingPlan(specs: readonly WingFlowScreenMarkerSpec[], tag: boolean): Promise<LocateResult> {
    // ONE evaluation for the whole plan. It used to be one per spec, twice over, plus a separate clear — five
    // round trips for a two-control step, each one a page evaluation on a live marketplace page, and the
    // operator saw the resulting rings arrive visibly later than the single-ring ones on 2026-08-12.
    //
    // The batched script is also ATOMIC where the sequence could not be: it resolves every spec before tagging
    // anything, so the page never holds a partial ring set — not even between two evaluations.
    const raw = await this.evalStr<{ resolved?: boolean; rows?: { count?: number; sig?: string }[] }>(
      this.activePage(),
      buildFixedLabelRingPlanScript({ specs: specs.map((sp) => ({ candidateQuery: sp.candidateQuery, exactText: sp.exactText })), tag }),
    );
    const rows = Array.isArray(raw?.rows) ? raw.rows : [];
    // Re-checked host-side rather than trusted: `resolved` is the script's own summary, and a row set that does
    // not match the plan it was built from is not a resolution of that plan. The FIRST failing row's own count
    // travels, so the park upstream reports a real miss instead of a synthesised zero.
    if (raw?.resolved !== true || rows.length !== specs.length) {
      const missed = rows.find((r) => r?.count !== 1);
      return { count: typeof missed?.count === "number" ? missed.count : 0 };
    }
    const sigs: string[] = [];
    for (const r of rows) {
      if (r?.count !== 1 || !r.sig) return { count: typeof r?.count === "number" ? r.count : 0 };
      sigs.push(r.sig);
    }
    return { count: 1, sig: foldSigs(sigs) };
  }

  async locateTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    // PROMOTED first. `confirm_purpose` and `terms_consent` appear in BOTH tables — they are text-guided until
    // their controls are calibrated and ringed afterwards — so the order of these two branches is what decides
    // which. Promotion wins, and it can only be reached through a record that names a live reading.
    const ring = promotedRingSpecs(target);
    if (ring.length > 0) return this.resolveRingPlan(ring, false);
    // Text-guided (incl. `reach_open_api` and `return`, which are guidance rather than queried WING controls):
    // measured, not promoted. It resolves to a fixed synthetic signature — the page is not queried, so there is
    // nothing to find and nothing to miss.
    const guided = TEXT_GUIDED_SIG[target];
    if (guided) return { count: 1, sig: guided };
    if (!isWingHighlightTarget(target)) return { count: 0 };
    return this.resolveFixedLabelTarget(target, false);
  }

  async highlightTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    const page = this.activePage();
    // Same precedence as `locateTarget`, and it has to be the same or the two disagree about what this step is:
    // one would tag a control while the other reported a synthetic guidance signature, and the engine's
    // anti-drift check compares exactly those two values.
    const ring = promotedRingSpecs(target);
    if (ring.length > 0) {
      const planned = await this.resolveRingPlan(ring, true);
      if (planned.count !== 1 || !planned.sig) return { count: planned.count };
      await sleep(LOCATOR_SETTLE_MS);
      await this.mountStepOverlay(page, target);
      if (!(await overlayMounted(page))) return { count: 0 };
      return { count: 1, sig: planned.sig };
    }
    const guided = TEXT_GUIDED_SIG[target];
    if (guided) {
      // CLEAR THE PRIOR TAG FIRST. Live-confirmed 2026-08-10: without this the mount found the PREVIOUS step's
      // `data-aw-target` — still on `API Key 발급 받기` — removed the old box and rebuilt it in the same place
      // with this step's text. The operator saw a ring pointing at one control while the panel described
      // another, for three consecutive steps. A step that claims no locator must leave no anchor behind.
      await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
      // …then the panel ALONE, docked. Without `dockedPanelOnly` the mount finds no anchor and returns having
      // created nothing, which is why these steps had no presentation of their own once the stale tag was gone.
      await this.mountStepOverlay(page, target, true);
      return (await overlayMounted(page)) ? { count: 1, sig: guided } : { count: 0 };
    }
    if (!isWingHighlightTarget(target)) return { count: 0 };
    const res = await this.resolveFixedLabelTarget(target, true);
    if (res.count !== 1 || !res.sig) return { count: res.count };
    // Give the just-set tag a beat to land, then mount the reused read-only overlay on it (scroll into view +
    // "여기입니다" pointer). Never a WING click awaited.
    await sleep(LOCATOR_SETTLE_MS);
    await this.mountStepOverlay(page, target);
    if (!(await overlayMounted(page))) return { count: 0 };
    return { count: 1, sig: res.sig };
  }

  /**
   * Mount the WING-resident step overlay for one target: the read-only spotlight ring + the guidance panel
   * (product copy) and, for a checkpoint, its advance button. `reach_open_api` gets NO button (it auto-advances
   * on the observed navigation). The button only records the seller's press into an in-page value-free latch;
   * the driver never clicks/types and reads no field value.
   */
  private async mountStepOverlay(page: Page, target: CoupangIssuanceTarget, dockedPanelOnly = false): Promise<void> {
    const buttonLabel = ADVANCE_BUTTON_LABEL[target];
    await mountOverlay(page, {
      ...(dockedPanelOnly ? { dockedPanelOnly: true } : {}),
      stepNumber: OVERLAY_STEP[target],
      totalSteps: COUPANG_ISSUANCE_TOTAL_STEPS,
      copyKey: `actionWindow.coupangIssuance.step.${target}`,
      label: OPERATOR_STEP_LABELS[target],
      // The chip gets the short title; the panel keeps the instruction. Without this both rendered the same
      // long string and the chip's copy ran off the viewport.
      badgeLabel: OPERATOR_STEP_TITLES[target],
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
      // Opt in to the WING-resident guidance panel (this driver is the only one that does); the button is
      // added only for a checkpoint (a target with an advance label). The reach step gets a copy-only panel.
      residentPanel: true,
      ...(buttonLabel ? { advance: { buttonLabel, token: advanceToken(target) } } : {}),
    });
  }

  async clearHighlight(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  async armObserve(target: CoupangIssuanceTarget): Promise<void> {
    // A same-page checkpoint is advanced by the seller pressing THIS step's WING-resident overlay button. Re-arm
    // the value-free latch (set this step's opaque token, drop any prior press) so a stale press from an earlier
    // step or arm window can never be misread as this step's advance. `reach_open_api` arms nothing here — it is
    // watched as a page-CATEGORY transition in `observeUserAction`, not a button press.
    if (isCoupangCheckpointTarget(target)) {
      await resetOverlayAdvance(this.activePage(), advanceToken(target)).catch(() => undefined);
    }
  }

  async observeUserAction(target: CoupangIssuanceTarget): Promise<boolean> {
    // `reach_open_api` is watched as a NAVIGATION: it completes when the seller moves from the WING home to the
    // open-API issuance page — an OBSERVED page-category transition. The engine then re-probes (VERIFY_REACH).
    if (target === "reach_open_api") return this.observeLeftWingHome();
    // Every same-page checkpoint advances WING-resident: poll this step's value-free advance latch until the
    // seller presses the on-page button (or the observe window elapses, so the session re-arms). No value read.
    if (isCoupangCheckpointTarget(target)) return this.observeOverlayAdvance(target);
    return true;
  }

  /**
   * Has the seller finished consenting? A single aggregate boolean, computed IN THE PAGE.
   *
   * The one place this codebase looks at a consent checkbox's state, and it is deliberately the weakest read
   * that answers the question: the conjunction happens page-side, so which box was ticked — or that one was and
   * the other was not — never crosses the boundary and cannot be stored, sent, or logged by anything here.
   *
   * SellerOps still never ticks a box, never reads the terms, and never decides for the seller. Noticing that a
   * human has consented is not consenting on their behalf; it is what lets the tutorial stop asking them to
   * report what the page already shows.
   *
   * Fail-closed: any structural ambiguity yields `false` ("not proven complete"), and the seller's own advance
   * button remains the way through.
   */
  private async observeConsentComplete(): Promise<boolean> {
    const script = buildWingConsentCompleteScript(WING_STAGE3_TERMS_OPTION_CANDIDATES.map((c) => c.exactText));
    return (await this.evalStr<boolean>(this.activePage(), script).catch(() => false)) === true;
  }

  /**
   * Await this checkpoint's completion — whichever the page proves FIRST:
   *
   *  1. **the screen the seller's own action produces.** 발급 opens the purpose screen and 확인 opens the terms
   *     screen, both measured. When the expected screen appears, the seller has plainly done the thing, and
   *     asking them to confirm what the page already proves is what made this read as a tutorial rather than a
   *     product. This is pure observation: nothing is clicked, and the seller still performs every WING action.
   *  2. **their press of the WING-resident advance button.** Kept, and never removed: a marker that does not
   *     resolve (the purpose heading has never been matched by any apparatus — see
   *     `WING_PURPOSE_SCREEN_MARKER_MEASURED`) must degrade to the seller moving on, not to a stalled run. It is
   *     also the safety fence — manual progress always remains available — and it lives in the WING overlay, so
   *     using it still never sends anyone back to the SellerOps tab.
   *
   * Value-free throughout: an opaque token comparison and a visible/hidden count. No click, no type, no field
   * value, no text. On timeout it returns `false` so the session re-arms.
   */
  private async observeOverlayAdvance(target: CoupangIssuanceTarget): Promise<boolean> {
    const timeoutMs = this.opts.observeTimeoutMs ?? DEFAULT_WING_OBSERVE_TIMEOUT_MS;
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / OVERLAY_ADVANCE_POLL_MS));
    const token = advanceToken(target);
    const expected = CHECKPOINT_ADVANCES_TO_SCREEN[target];
    // The screen must CHANGE INTO the expected one — a reading taken BEFORE anything could have happened is the
    // baseline, and an advance is only an observation of the seller's act if it differs from it.
    //
    // Without this the first probe ran at `i === 0`, immediately after arming and before any sleep, and simply
    // asked "is the expected screen showing". WING keeps later screens in the same document — the marker
    // evidence records `stage3.terms.heading` as `hiddenCount: 1` while on PURPOSE — and no reading of the
    // purpose marker has ever been taken ON the issuance page. So if that marker paints before 발급 is pressed,
    // step 2 completed itself and the walk guided step 3 while the seller had done nothing at all. An
    // auto-advance that can fire on arrival is not an observation.
    //
    // Fail-closed: when the baseline ALREADY reads as the expected screen, screen-advance is off for this arm
    // window and the seller's own WING-resident button is the way through. That button is on every checkpoint
    // for exactly this reason.
    // An UNREADABLE baseline disables it too: not knowing where the seller started is exactly the state in
    // which "the expected screen is showing" cannot be told apart from "it was showing all along".
    const baseline = expected ? await this.probeFlowScreen().catch(() => null) : null;
    const screenMayAdvance = expected !== undefined && baseline !== null && baseline !== expected;
    // The same construction for the step whose completion is a page CATEGORY rather than a flow screen: the
    // credentials appearing after the seller presses the key-issuing 확인. Same baseline rule, same reason — a
    // run that started on a page already showing credentials must not report that the seller just made them.
    const expectedCategory = CHECKPOINT_ADVANCES_TO_CATEGORY[target];
    const categoryBaseline = expectedCategory ? await this.readSurface().then((p) => p.pageCategory).catch(() => null) : null;
    const categoryMayAdvance =
      expectedCategory !== undefined && categoryBaseline !== null && categoryBaseline !== expectedCategory;
    // The screen probe costs three in-page locates, so it runs on a slower cadence than the latch poll rather
    // than on every tick. The seller pressing the button is still noticed within one latch poll.
    const screenEvery = Math.max(1, Math.round(SCREEN_OBSERVE_POLL_MS / OVERLAY_ADVANCE_POLL_MS));
    for (let i = 0; i < maxPolls; i++) {
      const pressed = await readOverlayAdvancePressed(this.activePage(), token).catch(() => false);
      if (pressed) return true;
      if (i % screenEvery === 0) {
        if (screenMayAdvance && (await this.probeFlowScreen().catch(() => "UNRECOGNIZED" as WingFlowScreen)) === expected) return true;
        // The consent step changes no screen, so its completion is the seller's own two ticks — observed, never
        // performed, and never recorded (see `observeConsentComplete`).
        if (target === "terms_consent" && (await this.observeConsentComplete())) return true;
        // The key-issuing step. This observes the RESULT — the credentials being on screen — and cannot cause
        // it: the category cannot become `credential_shown` before a credential exists. The seller pressed it.
        if (
          categoryMayAdvance &&
          (await this.readSurface().then((p) => p.pageCategory).catch(() => null)) === expectedCategory
        ) {
          return true;
        }
      }
      if (i < maxPolls - 1) await sleep(OVERLAY_ADVANCE_POLL_MS);
    }
    return false;
  }

  /**
   * Observe the seller's own `wing_home → open_api_issuance` navigation for `reach_open_api`, value-free: poll the
   * sanitized page CATEGORY and resolve `true` the moment the page is no longer the WING home. NEVER clicks,
   * tags, or reads a value; only a coarse category enum is inspected. On timeout (still on the home) it returns
   * `false` so the session re-arms; the engine's VERIFY_REACH decides whether the landing is correct.
   */
  private async observeLeftWingHome(): Promise<boolean> {
    const timeoutMs = this.opts.observeTimeoutMs ?? DEFAULT_WING_OBSERVE_TIMEOUT_MS;
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / OPEN_NAV_POLL_MS));
    for (let i = 0; i < maxPolls; i++) {
      const category = await this.readPageCategory(this.activePage()).catch(() => "wing_home" as WingPageCategory);
      if (category !== "wing_home") return true;
      if (i < maxPolls - 1) await sleep(OPEN_NAV_POLL_MS);
    }
    return false;
  }

  /** The sanitized page CATEGORY of a page (census + host-category only — never a URL or DOM value). */
  private async readPageCategory(page: Page): Promise<WingPageCategory> {
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    const urlCategory = classifyWingUrlCategory(page.url());
    return wingPageCategoryFromCensus(urlCategory, census).pageCategory;
  }

  async cleanup(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed;
  }
}
