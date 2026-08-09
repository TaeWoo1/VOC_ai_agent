/**
 * **WING label RECON — narrowing an unresolved fixed label by MEASUREMENT, not by guessing.**
 *
 * The problem this exists for. On the real no-key issuance form (2026-08-08) three of the four calibration
 * targets failed to resolve: `self_dev` (자체개발) and `call_ip` (호출 IP) matched **0**, `vendor_info` (업체명)
 * matched **8**. The tempting fix — edit `WING_HIGHLIGHT_LABELS` to whatever seems likelier — is exactly the
 * speculative retuning `collector/CLAUDE.md` §6 forbids, and it would burn a live grant to test one hunch.
 *
 * What this does instead: it turns each unresolved target into a SET of candidate labels and measures them all
 * in one read-only pass. WING supplies only integers; every string in the exchange is one WE wrote. A candidate
 * may be promoted into the shipped labels **only** after a live reading shows it resolving uniquely — this
 * module deliberately contains no promotion path, so there is nothing here that can quietly change a locator.
 *
 * **It builds no new browser tooling.** A candidate is measured through the driver's existing read-only
 * `probeFixedLabelMatch` seam — the *same* call the shipped baseline probe already makes, running the audited
 * `buildFixedLabelLocateScript`, whose output is `{ count, sig? }` and nothing else: no text, no value, no
 * selector, no DOM, no attributes, no geometry. That is also why the heavier `EXTRACT_VISUAL_CONTROLS` census
 * is NOT reused here: it returns raw attribute values and bounding boxes that then need a screening gate, which
 * is a larger sanitization surface than this question needs.
 *
 * **Corrected 2026-08-08 — why not the batch `buildFixedLabelProbeScript`.** The first design shipped one batch
 * script for the whole sweep. Two properties this module claims are unobtainable that way, so the runner uses
 * the per-candidate locate seam instead:
 *
 *   1. *No signature.* The batch script returns counts only. Two candidates each matching one element is the
 *      case this module refuses to auto-resolve — and without signatures a reviewer cannot resolve it offline
 *      either (same element under two labels? or two different elements?), so the grant would have to be spent
 *      again. The locate seam returns the opaque 16-hex structural sig for a unique match, which answers it.
 *   2. *A malformed `candidateQuery` reads as a real zero.* The batch script's `try { querySelectorAll } catch
 *      { els = [] }` emits `matchCount: 0` for a query the browser rejected — so `NOT_MEASURED` (which fires on
 *      a MISSING row) could never catch it, and a broken query would be reported as "label confirmed absent".
 *      The docstring below used to claim the opposite. Per-candidate probing surfaces the failure as a fault,
 *      and every shipped `candidateQuery` is additionally proven well-formed offline by a guard test.
 *
 * A candidate label carries no operator data by construction: these are WING's own generic UI words. Nothing
 * derived from the page — no placeholder, no input value, no company or account text — may be added to a
 * candidate list, and the guard test asserts the shape that keeps it that way.
 *
 * **Wired to a runner since 2026-08-08:** `probe-wing-issuance-selectors.ts` runs the sweep when the run's
 * approved phase is `COUPANG_WING_LABEL_RECON` and every approved target is a recon target. It still holds no
 * promotion path — a candidate that resolves uniquely is recorded as evidence and nothing else; changing a
 * shipped label stays an offline edit with its own tests and PR.
 */
import type { WingProbeTargetName } from "../cli/coupang-wing-classifier";

/** The targets that failed to resolve on the real no-key form and therefore need recon. */
export const WING_RECON_TARGETS = ["self_dev", "vendor_info", "call_ip"] as const;
export type WingReconTarget = (typeof WING_RECON_TARGETS)[number];

/** A candidate is our own guess at WING's fixed label, plus the structural query to count it against. */
export interface WingLabelCandidate {
  /** A stable id for this candidate — appears in the sanitized record instead of the label text. */
  readonly id: string;
  readonly candidateQuery: string;
  readonly exactText: string;
  /** Why this candidate is worth measuring. Prose for the reviewer; never sent to the page. */
  readonly rationale: string;
}

/**
 * Candidate label sets. **These are hypotheses to be measured, not improvements.** Each set leads with the
 * currently shipped label so every run re-measures the baseline in the same conditions — otherwise a "better"
 * candidate could look better only because the page changed.
 *
 * The variants are mechanical rather than imaginative on purpose: spacing and particle variants of the same
 * word, and the wider structural queries that a Korean form label might live in. Inventing semantically
 * different wording would be guessing at WING's copy, which is what the live measurement is for.
 */
function deepFreezeCandidates(
  sets: Record<WingReconTarget, readonly WingLabelCandidate[]>,
): Readonly<Record<WingReconTarget, readonly WingLabelCandidate[]>> {
  // `Object.freeze` is shallow, and `readonly` is erased at runtime — without freezing each candidate OBJECT,
  // `CANDIDATES.call_ip[0].exactText = <anything>` succeeds and that string is shipped straight into the page.
  for (const set of Object.values(sets)) {
    Object.freeze(set);
    for (const c of set) Object.freeze(c);
  }
  return Object.freeze(sets);
}

export const WING_LABEL_RECON_CANDIDATES: Readonly<Record<WingReconTarget, readonly WingLabelCandidate[]>> =
  deepFreezeCandidates({
    self_dev: Object.freeze([
      { id: "self_dev.baseline", candidateQuery: "label,button,span,div,a,legend", exactText: "자체개발",
        rationale: "the shipped label — re-measured alongside every variant so the baseline is same-conditions" },
      { id: "self_dev.spaced", candidateQuery: "label,button,span,div,a,legend", exactText: "자체 개발",
        rationale: "same word with the space Korean UI copy often inserts" },
      { id: "self_dev.radio", candidateQuery: "label,span,div", exactText: "자체개발",
        rationale: "the 2026-08-08 record reported role 'option' — narrower query for a radio/label pairing" },
      { id: "self_dev.dev_type", candidateQuery: "label,legend,th,dt,span,div", exactText: "개발방식",
        rationale: "the FIELD's label rather than the OPTION's — a form may label the group, not the choice" },
    ]),
    vendor_info: Object.freeze([
      { id: "vendor_info.baseline", candidateQuery: "label,span,div,dt,th,strong", exactText: "업체명",
        rationale: "the shipped label — matched 9x on the issued page and 8x on the form, so it is too broad" },
      { id: "vendor_info.label_only", candidateQuery: "label,legend", exactText: "업체명",
        rationale: "restricting to real form-label elements is the least speculative way to cut a broad match" },
      { id: "vendor_info.th_dt", candidateQuery: "th,dt", exactText: "업체명",
        rationale: "if the form is a table/definition list, the header cell is the unique one" },
      { id: "vendor_info.vendor_name", candidateQuery: "label,legend,th,dt", exactText: "업체 정보",
        rationale: "a section heading variant; measured to see whether the section, not the field, is unique" },
    ]),
    call_ip: Object.freeze([
      { id: "call_ip.baseline", candidateQuery: "label,span,div,dt,th,strong", exactText: "호출 IP",
        rationale: "the shipped label — 0 matches on both real surfaces, so the spacing or wording is wrong" },
      { id: "call_ip.nospace", candidateQuery: "label,span,div,dt,th,strong", exactText: "호출IP",
        rationale: "the same words unspaced — the single likeliest cause of an exact-match miss" },
      { id: "call_ip.lower", candidateQuery: "label,span,div,dt,th,strong", exactText: "호출 ip",
        rationale: "case variant; the matcher is case-sensitive after whitespace normalization" },
      { id: "call_ip.ip_addr", candidateQuery: "label,legend,th,dt", exactText: "IP 주소",
        rationale: "the generic field name, in case WING does not qualify it with 호출" },
    ]),
  });

/**
 * What a single candidate's measurement means. Closed enum — no free text, no partial credit.
 *
 * `NOT_MEASURED` is separate from `ABSENT` deliberately. The first version folded a missing row into
 * `matchCount: 0` / `ABSENT`, which made a partial reading byte-identical to a complete all-miss reading —
 * the same conflation of "unmeasured" with "measured zero" that this whole unit exists to correct. It matters
 * concretely: a candidate whose read-only probe THREW (the page navigated or closed under it) contributes no
 * row, and a partly-failed sweep would otherwise read as "all candidates confirmed absent" and send a reviewer
 * off to rewrite labels that were never tested.
 */
export const WING_RECON_VERDICTS = ["UNIQUE", "ABSENT", "AMBIGUOUS", "NOT_MEASURED", "INVALID_COUNT"] as const;
export type WingReconVerdict = (typeof WING_RECON_VERDICTS)[number];

export interface WingReconCandidateResult {
  readonly id: string;
  /**
   * The fixed candidate label this row measured — OUR OWN constant, echoed so the record is legible without
   * cross-referencing the source. Never page content: the allowlisted-shape guard test is what keeps it so.
   */
  readonly label: string;
  /** Null when the page returned nothing for this candidate — never silently coerced to 0. */
  readonly matchCount: number | null;
  readonly verdict: WingReconVerdict;
  /**
   * Opaque 16-hex structural signature of a UNIQUE match (tag + document position + child count, computed
   * in-page), else null. This is what makes two simultaneously-unique candidates resolvable offline: equal
   * signatures mean one element wearing two labels, unequal signatures mean genuinely different elements.
   */
  readonly sig16: string | null;
}

export interface WingReconTargetResult {
  readonly target: WingReconTarget;
  readonly candidates: readonly WingReconCandidateResult[];
  /**
   * The candidate ids that resolved uniquely. **Plural on purpose.** Two candidates matching one element each
   * is not automatically one winner — they may be different elements. Resolving that is the reviewer's job with
   * the recorded signatures; this module never picks for them.
   */
  readonly uniqueCandidateIds: readonly string[];
  /** True only when EXACTLY ONE candidate resolved uniquely — the one case with nothing left to interpret. */
  readonly resolvedUnambiguously: boolean;
}

/** Is this a target we hold candidates for? Fail-closed screening, so an env-derived scope cannot slip through. */
export function isWingReconTarget(value: unknown): value is WingReconTarget {
  return typeof value === "string" && (WING_RECON_TARGETS as readonly string[]).includes(value);
}

/** Thrown for an unknown target rather than crashing on `undefined` — a refusal, not a TypeError. */
export class UnknownWingReconTargetError extends Error {
  constructor(readonly target: string) {
    // The MESSAGE is value-free: the offending value may be an operator-supplied scope string, and a message is
    // the part that reaches a log or a stderr line. It stays on `.target` for a debugger to read deliberately.
    super("UNKNOWN_RECON_TARGET");
    this.name = "UnknownWingReconTargetError";
  }
}

function screenTargets(targets: readonly unknown[]): WingReconTarget[] {
  const seen = new Set<WingReconTarget>();
  const out: WingReconTarget[] = [];
  for (const t of targets) {
    if (!isWingReconTarget(t)) throw new UnknownWingReconTargetError(String(t));
    if (seen.has(t)) continue; // a repeated target would double the page work for no new information
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * The candidate probe specs for one or more targets, each in the exact shape the driver's read-only
 * `probeFixedLabelMatch` seam consumes — so a recon pass is N invocations of the SAME call the shipped baseline
 * probe already makes, and introduces no new in-page script. `targetId` correlates the reading back to the
 * candidate; it is one of our own ids, never page content.
 */
export function wingReconProbes(
  targets: readonly WingReconTarget[],
): { targetId: string; candidateQuery: string; exactText: string }[] {
  const out: { targetId: string; candidateQuery: string; exactText: string }[] = [];
  for (const t of screenTargets(targets)) {
    for (const c of WING_LABEL_RECON_CANDIDATES[t]) {
      out.push({ targetId: c.id, candidateQuery: c.candidateQuery, exactText: c.exactText });
    }
  }
  return out;
}

/**
 * A count the page could not have legitimately produced (negative, fractional, NaN, absurd) is `INVALID_COUNT`,
 * not `AMBIGUOUS`. Folding junk into a real verdict would let a broken reading masquerade as a measurement —
 * and `NaN` in particular serializes to `null`, quietly breaking the "integers only" property of a record.
 */
function verdictFor(matchCount: number): WingReconVerdict {
  if (!Number.isSafeInteger(matchCount) || matchCount < 0) return "INVALID_COUNT";
  if (matchCount === 1) return "UNIQUE";
  if (matchCount === 0) return "ABSENT";
  return "AMBIGUOUS";
}

/**
 * Fold a raw `{ targetId, matchCount, sig? }[]` reading into per-target results.
 *
 * A candidate the reading never reported becomes `NOT_MEASURED` with a null count — never `0`/`ABSENT`, which
 * would make a partial reading indistinguishable from a complete all-miss one. Unknown ids in the input are
 * ignored: they belong to no target, and inventing one for them would be worse than saying nothing. A DUPLICATE
 * id in the reading is `NOT_MEASURED` too — two different counts for one candidate means the reading is not
 * trustworthy for it, and silently keeping the last would hide that.
 *
 * A `sig` is retained ONLY for a candidate whose verdict is `UNIQUE`. A signature alongside any other count is
 * incoherent (the locate script emits one only for a single match), so carrying it would dress a junk or
 * ambiguous reading in evidence it does not have.
 */
export function interpretWingRecon(
  targets: readonly WingReconTarget[],
  raw: readonly { targetId: string; matchCount: number; sig?: string }[],
): WingReconTargetResult[] {
  const byId = new Map<string, number>();
  const sigById = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const r of raw) {
    if (byId.has(r.targetId) && byId.get(r.targetId) !== r.matchCount) conflicting.add(r.targetId);
    byId.set(r.targetId, r.matchCount);
    if (typeof r.sig === "string" && r.sig.length > 0) sigById.set(r.targetId, r.sig);
  }
  const out: WingReconTargetResult[] = [];
  for (const target of screenTargets(targets)) {
    const candidates = WING_LABEL_RECON_CANDIDATES[target].map((c): WingReconCandidateResult => {
      if (!byId.has(c.id) || conflicting.has(c.id))
        return { id: c.id, label: c.exactText, matchCount: null, verdict: "NOT_MEASURED", sig16: null };
      const matchCount = byId.get(c.id)!;
      const verdict = verdictFor(matchCount);
      return {
        id: c.id,
        label: c.exactText,
        matchCount,
        verdict,
        sig16: verdict === "UNIQUE" ? (sigById.get(c.id) ?? null) : null,
      };
    });
    const uniqueCandidateIds = candidates.filter((c) => c.verdict === "UNIQUE").map((c) => c.id);
    out.push({
      target,
      candidates,
      uniqueCandidateIds,
      // A target with an unmeasured candidate is NOT resolved even if exactly one other candidate was unique:
      // the unmeasured one might have resolved too, which is the two-unique ambiguity in disguise.
      resolvedUnambiguously:
        uniqueCandidateIds.length === 1 && candidates.every((c) => c.verdict !== "NOT_MEASURED"),
    });
  }
  return out;
}

/* ────────────────────────────── STAGE-2 candidates (hypotheses only) ────────────────────────────── */

/**
 * **Candidate labels for the STAGE-2 configuration screen — hypotheses, and nothing has measured them.**
 *
 * Why they are separate from {@link WING_LABEL_RECON_CANDIDATES}: those were measured on the initial no-key
 * surface and every one of them failed there (`자체개발` / `호출 IP` matched 0 in every spelling; `업체명` never
 * resolved). That result is not transferable — it says those labels are absent from THAT screen, not what the
 * Stage-2 screen contains. Measuring these needs the Stage-2 DOM, which requires the operator to press 발급
 * (`COUPANG_WING_ISSUANCE_FORM_REVEAL`).
 *
 * **Where the wording comes from, since inventing it would be the forbidden move.** The product owner described
 * the official Coupang flow as: 발급 → 연동 방식 선택 → 자체개발(직접입력) → **업체명 · URL · IP 주소** 입력 →
 * **확인**. So `URL`, `IP 주소` and `확인` are transcribed from that description of WING's own copy, not guessed
 * by this module. One weak corroboration exists: `IP 주소` matched **2** on the initial surface while `호출 IP`
 * matched 0 — so the phrase is at least present in WING's vocabulary. Two is not one, and the initial surface is
 * not Stage-2, so that is a reason to MEASURE it, not to ship it.
 *
 * **NOT WIRED TO ANY RUNNER, and this note is accurate.** `resolveWingReconScope` sweeps
 * {@link WING_RECON_TARGETS} only; no code path reads this constant. It is a declared hypothesis set for the unit
 * that observes Stage-2 — deliberately inert until there is a real DOM to measure it against.
 */
export const WING_STAGE2_RECON_TARGETS = ["purpose", "self_dev", "vendor_info", "vendor_url", "call_ip", "confirm"] as const;
export type WingStage2ReconTarget = (typeof WING_STAGE2_RECON_TARGETS)[number];

export const WING_STAGE2_RECON_CANDIDATES: Readonly<Record<WingStage2ReconTarget, readonly WingLabelCandidate[]>> =
  Object.freeze({
    purpose: Object.freeze([
      { id: "stage2.purpose.operator_reported", candidateQuery: "h1,h2,h3,h4,p,span,div,label,legend", exactText: "이제 키의 사용 목적을 골라주세요.",
        rationale: "OPERATOR-REPORTED on 2026-08-09, read off the screen by a human after pressing 발급 — the ONLY description of Stage-2 that exists. It is a hypothesis and provenance, NOT measured evidence: no apparatus has matched it, the transcription may differ from the DOM in whitespace or punctuation, and it may be a heading, a toast or a dialog title. Nothing may depend on it until a read-only Stage-2 recon resolves it" },
    ]),
    self_dev: Object.freeze([
      { id: "stage2.self_dev.direct", candidateQuery: "label,span,div", exactText: "직접입력",
        rationale: "the flow description names the self-developed option as 자체개발(직접입력); the parenthetical may be the label" },
      { id: "stage2.self_dev.baseline", candidateQuery: "label,button,span,div,a,legend", exactText: "자체개발",
        rationale: "the shipped label, re-measured on the screen it was always meant for" },
    ]),
    vendor_info: Object.freeze([
      { id: "stage2.vendor_info.baseline", candidateQuery: "label,legend,th,dt", exactText: "업체명",
        rationale: "on a real form the label should be a label/legend/th/dt — the query that matched 0 on the initial surface" },
    ]),
    vendor_url: Object.freeze([
      { id: "stage2.vendor_url.url", candidateQuery: "label,legend,th,dt", exactText: "URL",
        rationale: "transcribed from the official-flow description (업체명 · URL · IP 주소)" },
    ]),
    call_ip: Object.freeze([
      { id: "stage2.call_ip.ip_addr", candidateQuery: "label,legend,th,dt", exactText: "IP 주소",
        rationale: "from the flow description; matched 2 on the initial surface, so the phrase exists in WING copy" },
      { id: "stage2.call_ip.baseline", candidateQuery: "label,span,div,dt,th,strong", exactText: "호출 IP",
        rationale: "the shipped label, kept so the baseline is re-measured on the screen it was meant for" },
    ]),
    confirm: Object.freeze([
      { id: "stage2.confirm.confirm", candidateQuery: "button,a,span,div", exactText: "확인",
        rationale: "the final key-creating control per the flow description — measured ONLY to locate it, never pressed" },
    ]),
  });

/**
 * **PROVENANCE for the one thing anybody knows about Stage-2: that it exists.**
 *
 * On 2026-08-09 the reveal run (`wt-6a34bd527b2b`, grant `apr-79d628c4f334`, `0297d307`) highlighted the real
 * `API Key 발급 받기` control, the operator confirmed the highlight visually, pressed it themselves, and reported
 * a **persistent** purpose-selection surface. The agent's click/type/submit budget for that run was zero.
 *
 * Everything in this record is either a sanitized machine reading or explicitly attributed to the operator. The
 * distinction is the entire point: the previous two calibration failures both came from an operator-sourced or
 * expected value sitting unlabelled among measured ones.
 *
 * What the APPARATUS returned that day, and it was wrong about the page: `SURFACE_UNCHANGED`, `changedSignals: []`.
 * The predicate could not fire (see `stage2SurfaceRevealed`), so the run STOPPED rather than claiming success —
 * which is the only reason this record says "unmeasured" instead of something confident and false.
 */
export interface WingStage2LiveEvent {
  readonly observedOn: string;
  readonly gitSha: string;
  readonly runId: string;
  /** The surface's EXISTENCE is operator-reported. No apparatus has read it. */
  readonly appearance: "OPERATOR_REPORTED";
  /** Operator-reported: it stayed on screen, so a later census could in principle have seen it. */
  readonly persistent: true;
  /** What the instrument said, retained because the gap between it and `persistent` is the finding. */
  readonly apparatusOutcome: "SURFACE_UNCHANGED";
  readonly apparatusChangedSignalCount: 0;
  /** No structural property of Stage-2 has been measured: not a tag, not a role, not a control count. */
  readonly structuralMarkerMeasured: false;
  /** Unchanged and unchangeable by this evidence — the classifier still cannot tell issued from no-key. */
  readonly keyCreationRuledOut: false;
  readonly issuedStateReason: "NO_DISCRIMINATING_SIGNAL";
  /** Operator actions on the marketplace. Nothing was selected and no 확인 was pressed. */
  readonly operatorSelectedPurpose: false;
  readonly operatorPressedConfirm: false;
  /** Where the operator's transcription of the on-screen text lives — as a candidate, never as a marker. */
  readonly reportedTextRecordedAs: "WING_STAGE2_RECON_CANDIDATES.purpose";
}

export const WING_STAGE2_LIVE_EVENT: WingStage2LiveEvent = Object.freeze({
  observedOn: "2026-08-09",
  gitSha: "0297d307",
  runId: "wt-6a34bd527b2b",
  appearance: "OPERATOR_REPORTED",
  persistent: true,
  apparatusOutcome: "SURFACE_UNCHANGED",
  apparatusChangedSignalCount: 0,
  structuralMarkerMeasured: false,
  keyCreationRuledOut: false,
  issuedStateReason: "NO_DISCRIMINATING_SIGNAL",
  operatorSelectedPurpose: false,
  operatorPressedConfirm: false,
  reportedTextRecordedAs: "WING_STAGE2_RECON_CANDIDATES.purpose",
});

/** The probe scope a live recon run would need approving — the three unresolved targets and nothing else. */
export const WING_RECON_APPROVED_SCOPE: readonly WingProbeTargetName[] = Object.freeze([
  "self_dev",
  "vendor_info",
  "call_ip",
]);
