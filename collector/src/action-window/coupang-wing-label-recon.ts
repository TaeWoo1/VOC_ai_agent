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
import type { FixedLabelContainmentReading } from "./api-issuance-calibration/visual-recon-inpage";

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
function deepFreezeCandidates<K extends string>(
  sets: Record<K, readonly WingLabelCandidate[]>,
): Readonly<Record<K, readonly WingLabelCandidate[]>> {
  // `Object.freeze` is shallow, and `readonly` is erased at runtime — without freezing each candidate OBJECT,
  // `CANDIDATES.call_ip[0].exactText = <anything>` succeeds and that string is shipped straight into the page.
  for (const set of Object.values(sets) as readonly (readonly WingLabelCandidate[])[]) {
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
  /**
   * Matches whose text was right but which do NOT paint. **`null` means the reading carried none — never 0.**
   *
   * The locate script has always returned this and the sweep always dropped it, so every Stage-2 `ABSENT` in the
   * landed evidence means "zero PAINTING matches" and cannot rule out a hidden one. That limit is recorded as
   * `absenceBounds.hiddenMatchCountCarried: false` against that run, and carrying the count here is what closes
   * it for the next one. The distinction between null and 0 is the same one `NOT_MEASURED` draws for the count:
   * a reading that did not report a hidden count has not measured zero of them.
   */
  readonly hiddenMatchCount: number | null;
  /**
   * The MEASURED tag name of a unique match (e.g. `"LABEL"`), else null.
   *
   * The locate script has returned it since `e8e62981` and this seam dropped it — the same shape as the hidden
   * count above, and the same one that let `role: "button"` be written into a calibration record by hand and be
   * wrong. A record may only state what the apparatus returns, so a sweep whose rows cannot carry a tag can only
   * ever justify a promotion from an EXPECTED one. Null when the reading carried none: never a guess, and never
   * a tag for a count that was not 1.
   */
  readonly observedTag: string | null;
  /**
   * The containment reading for this candidate, or null when the run did not take one (every non-calibration
   * run). Null is not "nothing was contained" — see {@link presence}, which is `NOT_MEASURED` in that case.
   */
  readonly containment: FixedLabelContainmentReading | null;
  /**
   * What the containment reading says about this label's presence, as a closed verdict. `NOT_MEASURED` whenever
   * no containment reading was taken, so a run without the instrument can never look like a measured absence.
   */
  readonly presence: WingStage2Presence;
}

/**
 * **Where a fixed label actually is, once containment is measured.** This is the vocabulary that separates the
 * four readings a bare `matchCount: 0` collapses into one.
 *
 * `ABSENT_WITHIN_SCAN_BOUND` is not a hedge — it is the only honest verdict when the scan hit its element cap,
 * and it exists because the Stage-2 recon had to record `candidateScanTruncationReported: false` as a limit on
 * seven absences. An absence measured over a prefix of the document is an absence from that prefix.
 */
export const WING_STAGE2_PRESENCES = [
  "PRESENT_VISIBLE",
  "PRESENT_HIDDEN_ONLY",
  "PRESENT_NOT_WHOLE_TEXT",
  "ABSENT_EVERYWHERE",
  "ABSENT_WITHIN_SCAN_BOUND",
  "NOT_MEASURED",
] as const;
export type WingStage2Presence = (typeof WING_STAGE2_PRESENCES)[number];

/**
 * Fold a containment reading into a presence verdict. Total, deterministic, and ordered from the strongest
 * evidence down: a painting exact match beats a hidden one, which beats mere containment, which beats absence.
 */
export function wingStage2PresenceFrom(containment: FixedLabelContainmentReading | null | undefined): WingStage2Presence {
  if (!containment) return "NOT_MEASURED";
  if (containment.exactVisible > 0) return "PRESENT_VISIBLE";
  if (containment.exactHidden > 0) return "PRESENT_HIDDEN_ONLY";
  if (containment.deepestContainsVisible + containment.deepestContainsHidden > 0) return "PRESENT_NOT_WHOLE_TEXT";
  // Absence LAST, and only unqualified when the scan was complete. A truncated scan that found nothing has not
  // searched the document; calling that `ABSENT_EVERYWHERE` is the over-claim this vocabulary exists to refuse.
  return containment.scanTruncated ? "ABSENT_WITHIN_SCAN_BOUND" : "ABSENT_EVERYWHERE";
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
  return probesFromCandidates(screenTargets(targets), WING_LABEL_RECON_CANDIDATES);
}

/**
 * The same flattening over ANY candidate map. Shared so the Stage-2 sweep runs the identical code path as the
 * initial-surface sweep rather than a parallel copy that could drift into emitting something else.
 */
function probesFromCandidates<K extends string>(
  targets: readonly K[],
  candidates: Readonly<Record<K, readonly WingLabelCandidate[]>>,
): { targetId: string; candidateQuery: string; exactText: string }[] {
  const out: { targetId: string; candidateQuery: string; exactText: string }[] = [];
  for (const t of targets) {
    for (const c of candidates[t] ?? []) {
      out.push({ targetId: c.id, candidateQuery: c.candidateQuery, exactText: c.exactText });
    }
  }
  return out;
}

/**
 * Screen Stage-2 targets the way {@link screenTargets} screens the initial-surface ones: THROW on an unknown
 * name, de-duplicate the rest. Filtering silently would be the weaker behaviour — a caller that asked for a
 * target this module does not own would get a smaller sweep and no indication, which is the same
 * "measured fewer things than the manifest said" failure the scope gates exist to prevent.
 */
function screenStage2Targets(targets: readonly unknown[]): WingStage2ReconTarget[] {
  const seen = new Set<WingStage2ReconTarget>();
  const out: WingStage2ReconTarget[] = [];
  for (const t of targets) {
    if (typeof t !== "string" || !isWingStage2ReconTarget(t)) throw new UnknownWingReconTargetError(String(t));
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Stage-2 probe specs. Same shape, same seam, different (declared-inert-until-now) hypothesis set. */
export function wingStage2ReconProbes(
  targets: readonly WingStage2ReconTarget[],
): { targetId: string; candidateQuery: string; exactText: string }[] {
  return probesFromCandidates(screenStage2Targets(targets), WING_STAGE2_RECON_CANDIDATES);
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
  raw: readonly WingReconRawRow[],
): WingReconTargetResult[] {
  return interpretFor(screenTargets(targets), WING_LABEL_RECON_CANDIDATES, raw);
}

/**
 * One candidate's raw reading. `matchCount` is the painting exact-match count; everything else is optional
 * because a run may not have taken it, and an absent optional must never be folded into a measured zero.
 */
export interface WingReconRawRow {
  readonly targetId: string;
  readonly matchCount: number;
  readonly sig?: string;
  readonly hiddenCount?: number;
  /** The MEASURED tag of a unique match, when the reading carried one. Absent ⇒ not measured, never assumed. */
  readonly tag?: string;
  readonly containment?: FixedLabelContainmentReading;
}

/**
 * Stage-2 reading, folded by the SAME logic — including `NOT_MEASURED` for a missing or self-conflicting row,
 * which is the distinction that stops a partly-failed sweep reading as "these Stage-2 labels are confirmed
 * absent". Sharing the fold rather than copying it is deliberate: a second implementation is a second place for
 * the measured/unmeasured conflation to come back.
 */
export function interpretWingStage2Recon(
  targets: readonly WingStage2ReconTarget[],
  raw: readonly WingReconRawRow[],
): WingStage2ReconTargetResult[] {
  return interpretFor(screenStage2Targets(targets), WING_STAGE2_RECON_CANDIDATES, raw);
}

/** A Stage-2 target's folded reading. Same shape as the initial-surface one, over the Stage-2 target names. */
export interface WingStage2ReconTargetResult {
  readonly target: WingStage2ReconTarget;
  readonly candidates: readonly WingReconCandidateResult[];
  readonly uniqueCandidateIds: readonly string[];
  readonly resolvedUnambiguously: boolean;
}

function interpretFor<K extends string>(
  targets: readonly K[],
  candidateMap: Readonly<Record<K, readonly WingLabelCandidate[]>>,
  raw: readonly WingReconRawRow[],
): { target: K; candidates: WingReconCandidateResult[]; uniqueCandidateIds: string[]; resolvedUnambiguously: boolean }[] {
  const byId = new Map<string, number>();
  const shapeById = new Map<string, string>();
  const sigById = new Map<string, string>();
  const hiddenById = new Map<string, number>();
  const tagById = new Map<string, string>();
  const containmentById = new Map<string, FixedLabelContainmentReading>();
  const conflicting = new Set<string>();
  for (const r of raw) {
    // A repeated candidate id is a conflict when ANY of its readings differ, not just the count. Comparing the
    // count alone let two rows with the same count but different containment through, and the last one silently
    // won — which is the same "reported twice, differently" case, one field over.
    const shape = JSON.stringify([r.matchCount, r.sig ?? null, r.hiddenCount ?? null, r.tag ?? null, r.containment ?? null]);
    if (shapeById.has(r.targetId) && shapeById.get(r.targetId) !== shape) conflicting.add(r.targetId);
    shapeById.set(r.targetId, shape);
    byId.set(r.targetId, r.matchCount);
    if (typeof r.sig === "string" && r.sig.length > 0) sigById.set(r.targetId, r.sig);
    // Optional readings: only a real number is recorded. `undefined` leaves the map empty and the row null —
    // the same measured-vs-unmeasured line the count itself draws, one field over.
    if (typeof r.hiddenCount === "number" && Number.isSafeInteger(r.hiddenCount) && r.hiddenCount >= 0)
      hiddenById.set(r.targetId, r.hiddenCount);
    if (typeof r.tag === "string" && r.tag.length > 0) tagById.set(r.targetId, r.tag);
    if (r.containment) containmentById.set(r.targetId, r.containment);
  }
  const out: { target: K; candidates: WingReconCandidateResult[]; uniqueCandidateIds: string[]; resolvedUnambiguously: boolean }[] = [];
  for (const target of targets) {
    const candidates = (candidateMap[target] ?? []).map((c): WingReconCandidateResult => {
      if (!byId.has(c.id) || conflicting.has(c.id))
        return {
          id: c.id,
          label: c.exactText,
          matchCount: null,
          verdict: "NOT_MEASURED",
          sig16: null,
          // A candidate the reading never reported (or reported twice, differently) has no trustworthy hidden
          // count or containment either — carrying one from a conflicting row would dress an untrusted reading
          // in evidence. `presence` follows the count: unmeasured.
          hiddenMatchCount: null,
          observedTag: null,
          containment: null,
          presence: "NOT_MEASURED",
        };
      const matchCount = byId.get(c.id)!;
      const verdict = verdictFor(matchCount);
      const containment = containmentById.get(c.id) ?? null;
      return {
        id: c.id,
        label: c.exactText,
        matchCount,
        verdict,
        sig16: verdict === "UNIQUE" ? (sigById.get(c.id) ?? null) : null,
        hiddenMatchCount: hiddenById.get(c.id) ?? null,
        // Tied to UNIQUE for the same reason the signature is: a tag is a property of THE match, and there is
        // no such thing when the count is 0 or 2.
        observedTag: verdict === "UNIQUE" ? (tagById.get(c.id) ?? null) : null,
        containment,
        presence: wingStage2PresenceFrom(containment),
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
 * **WIRED TO A RUNNER since 2026-08-09.** `probe-wing-issuance-selectors.ts` sweeps this set when the run's
 * approved phase is `COUPANG_WING_STAGE2_RECON` and the Stage-2 precondition passes. (This note previously said
 * the opposite, and asserted its own accuracy while a comment ten lines below already contradicted it.) It still
 * holds NO promotion path: a candidate that resolves uniquely is recorded as evidence and nothing else.
 */
export const WING_STAGE2_RECON_TARGETS = [
  "purpose", "self_dev", "vendor_info", "vendor_url", "call_ip", "confirm",
  // The TERMS screen, measured for the first time on 2026-08-10. It is reached by pressing 확인 on the purpose
  // screen, and no account of this flow predicted it: the product owner's description goes purpose → 업체명 ·
  // URL · IP 주소 → 확인, and the live flow goes purpose → 확인 → terms. Every string below is the operator's
  // verbatim transcription of that screen, taken the same day.
  "terms_heading", "terms_api_agree", "terms_category_agree", "terms_cancel", "terms_issue_final",
  // APPENDED 2026-08-11 for the guided-control highlight calibration. The `OPEN API` option has been identified
  // as radio 0's accessible name (`WING_STAGE2_OPTION_IDENTIFICATION_EVIDENCE`), but identifying a name is not
  // locating an element: no apparatus has ever run a fixed-label LOCATE against the string, so nothing knows
  // whether it resolves to one painting element. Appended rather than slotted beside `purpose`, because an
  // earlier run's records are read back by id and a canonical-order change would silently re-sort them.
  "purpose_open_api",
  // APPENDED 2026-08-12 for the VENDOR-METHOD screen — the one that follows `약관 동의 및 Key 발급받기` and, per
  // the operator, actually issues the key. Every string below is an OPERATOR TRANSCRIPTION of that screen
  // (`OPEN API 키 발급` / `업체 입력 방식` / `연동업체 선택` / `자체개발(직접입력)` / `업체명` / `취소` `확인`),
  // taken on 2026-08-12 after two out-of-scope presses revealed it. **No apparatus has read this screen**, so
  // these are hypotheses of exactly the standing the TERMS strings had before 2026-08-10 — and they are appended,
  // never slotted in, because earlier runs' records are read back by id.
  //
  // 업체명 / 취소 / 확인 get NO new target: `vendor_info`, `terms_cancel` and `confirm` already carry those
  // strings. A reading is stamped with the SCREEN it was taken on, so the same candidate measured here is a
  // different row from the same candidate measured on the purpose screen — and a second target carrying a
  // duplicate `exactText` is how the purpose heading's drift got measured as absent in the first place.
  "vendor_method_heading", "vendor_method_prompt", "vendor_partner", "vendor_self_dev",
] as const;
export type WingStage2ReconTarget = (typeof WING_STAGE2_RECON_TARGETS)[number];

export const WING_STAGE2_RECON_CANDIDATES: Readonly<Record<WingStage2ReconTarget, readonly WingLabelCandidate[]>> =
  // deepFreeze, NOT `Object.freeze`. These were declared inert, and a shallow freeze was survivable while no
  // code path read them; wiring them to a runner made the difference load-bearing. `Object.freeze` does not
  // freeze the candidate OBJECTS, and `readonly` is erased at runtime — so
  // `WING_STAGE2_RECON_CANDIDATES.purpose[0].exactText = <anything>` succeeded, and that string is shipped
  // straight into the live page as an exact-match query. Found by this unit's own test.
  deepFreezeCandidates({
    purpose: Object.freeze([
      { id: "stage2.purpose.operator_reported", candidateQuery: "h1,h2,h3,h4,p,span,div,label,legend", exactText: "이제 키의 사용 목적을 골라주세요.",
        rationale: "OPERATOR-REPORTED on 2026-08-09, read off the screen by a human after pressing 발급. MEASURED ABSENT_EVERYWHERE on 2026-08-10 — kept anyway, because the absence is the evidence that separates it from the verbatim entry below, and dropping it would leave that comparison unrepeatable" },
      { id: "stage2.purpose.operator_verbatim", candidateQuery: "h1,h2,h3,h4,p,span,div,label,legend", exactText: "키의 사용 목적을 골라주세요",
        rationale: "the SAME heading transcribed VERBATIM on 2026-08-10, which differs from the 08-09 report by a leading 이제 and a trailing period — the likeliest explanation of that report's measured absence in every form. Still a hypothesis: no apparatus has matched this string either, and it may be a heading, a dialog title or a toast" },
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
        rationale: "the purpose screen's advance control. MEASURED 2026-08-10: pressing it hid the purpose screen and revealed the TERMS screen, so it is NOT the key-creating control the flow description called it — that description was wrong about the ordering, as it was already wrong about the option wording" },
      // The PROMOTABLE shape of the same label, and the one a highlight would have to use. `button,a,span,div`
      // is character-for-character the query that produced the 삭제 record now filed
      // APPARATUS_UNSOUND and the 발급 refutation: a short whole-text label against four tag families, one of
      // them `div`. Both of those resolved to exactly one element and one of them was a decoy. Narrowing to
      // actionable elements is what separated the key-creation control from its identically-worded heading, so
      // it is measured here BESIDE the baseline rather than swapped for it — if the two disagree, the
      // disagreement is the finding.
      { id: "stage2.confirm.actionable", candidateQuery: "button,a", exactText: "확인",
        rationale: "the 확인 control narrowed to actionable elements, which is the only shape a ring may point with. Measured alongside the broad baseline so a difference in count between the two is visible rather than inferred" },
    ]),
    // ── the TERMS screen (2026-08-10, all five OPERATOR_TRANSCRIBED verbatim) ──
    terms_heading: Object.freeze([
      { id: "stage3.terms.heading", candidateQuery: "h1,h2,h3,h4,legend,strong,p,span,div", exactText: "약관 동의 및 Key 발급받기",
        rationale: "the terms screen's heading, transcribed verbatim on 2026-08-10. NOTE: character-for-character identical to the final button's label, which is why the two are separate targets with different element queries — see stage3.terms.issue_final" },
    ]),
    // ── the two consent sentences, plus the per-tag NARROWINGS added 2026-08-11 ──
    //
    // The broad query measured TWO painting matches for each sentence on 2026-08-10, which is why neither was
    // promotable: a ring needs one element, and two matches name neither. The narrowings exist to find out
    // WHICH tag carries the sentence — the wrapper or the inner run — rather than to make the count smaller by
    // trying queries until one returns 1. That distinction is why all four are swept together: if two of them
    // each return 1 they are the same two elements the broad query found, and the pair is a nesting, not an
    // ambiguity. Nothing is promoted from a narrowing that a live reading has not returned.
    terms_api_agree: Object.freeze([
      { id: "stage3.terms.api_agree", candidateQuery: "label,span,div,p", exactText: "API 이용 약관에 동의합니다.",
        rationale: "the FIRST checkbox's visible label, transcribed verbatim on 2026-08-10; the trailing period is part of the transcription and is not to be trimmed" },
      { id: "stage3.terms.api_agree.label", candidateQuery: "label", exactText: "API 이용 약관에 동의합니다.",
        rationale: "the sentence as a `<label>`. A weak prior: the terms checkboxes measured labelForCount 0 and ancestorLabelCount 0, so if this resolves the label exists but is not associated with the box — which is a finding about the page, not a locator" },
      { id: "stage3.terms.api_agree.p", candidateQuery: "p", exactText: "API 이용 약관에 동의합니다.",
        rationale: "the sentence as a paragraph — one of the two tag families the broad query's two matches must come from" },
      { id: "stage3.terms.api_agree.span", candidateQuery: "span", exactText: "API 이용 약관에 동의합니다.",
        rationale: "the sentence as an inline run, the likeliest inner half of a wrapper/run nesting" },
      { id: "stage3.terms.api_agree.div", candidateQuery: "div", exactText: "API 이용 약관에 동의합니다.",
        rationale: "the sentence as a block wrapper, the likeliest outer half of the same nesting" },
    ]),
    terms_category_agree: Object.freeze([
      { id: "stage3.terms.category_agree", candidateQuery: "label,span,div,p", exactText: "카테고리 자동 매칭 서비스 이용에 동의합니다.",
        rationale: "the SECOND checkbox's visible label, transcribed verbatim on 2026-08-10. A separate consent from the API terms — nothing here treats the two as one decision" },
      { id: "stage3.terms.category_agree.label", candidateQuery: "label", exactText: "카테고리 자동 매칭 서비스 이용에 동의합니다.",
        rationale: "the second sentence as a `<label>`, measured on the same terms as the first — the two consents are never inferred from one another" },
      { id: "stage3.terms.category_agree.p", candidateQuery: "p", exactText: "카테고리 자동 매칭 서비스 이용에 동의합니다.",
        rationale: "the second sentence as a paragraph" },
      { id: "stage3.terms.category_agree.span", candidateQuery: "span", exactText: "카테고리 자동 매칭 서비스 이용에 동의합니다.",
        rationale: "the second sentence as an inline run" },
      { id: "stage3.terms.category_agree.div", candidateQuery: "div", exactText: "카테고리 자동 매칭 서비스 이용에 동의합니다.",
        rationale: "the second sentence as a block wrapper" },
    ]),
    terms_cancel: Object.freeze([
      { id: "stage3.terms.cancel", candidateQuery: "button,a,span,div", exactText: "취소",
        rationale: "the terms screen's cancel control, transcribed verbatim. Located so the guided tutorial can NAME the way out; nothing presses it either" },
    ]),
    terms_issue_final: Object.freeze([
      { id: "stage3.terms.issue_final", candidateQuery: "button,a", exactText: "약관 동의 및 Key 발급받기",
        rationale: "THE KEY-CREATION CONTROL. Same text as the heading, so the query is narrowed to actionable elements — and whether that narrowing makes it unique is the measurement, not an assumption. Measured ONLY to locate it: this phase has no tooling that presses it and must never acquire one" },
    ]),
    // ── the purpose screen's `OPEN API` option, as a LOCATE target (2026-08-11) ──
    //
    // **A name is not a location, and this target exists because the two were about to be confused.**
    // `WING_STAGE2_OPTION_IDENTIFICATION_EVIDENCE` settles that radio 0's accessible name IS the `OPEN API`
    // candidate's text and that it derives from a single `label[for]`. That is a strong prior for the first
    // candidate below and evidence for none of them: the association census walks OUT from each control to
    // whatever names it, while a fixed-label locate walks IN from a query to whatever carries the text. The two
    // can disagree — a `label[for]` naming the radio does not mean exactly one painting element on the screen
    // has `OPEN API` as its whole text, and `OPEN API` is short, latin, and the kind of string a page can
    // repeat in a heading, a tab, or a badge.
    //
    // Nothing here selects the option. Which purpose to use is the product owner's decision, already made and
    // recorded as a decision rather than a measurement; this locates the label so the seller can be SHOWN it.
    purpose_open_api: Object.freeze([
      { id: "stage2.purpose_open_api.label", candidateQuery: "label", exactText: "OPEN API",
        rationale: "the option's `<label for>` element — the one the association census measured as radio 0's name source (`nameSource: LABEL_FOR`, `labelForCount: 1`). The strongest prior in this set, and still unmeasured as a locate" },
      { id: "stage2.purpose_open_api.broad", candidateQuery: "label,span,div,p", exactText: "OPEN API",
        rationale: "the same string against the wider tag families, swept BESIDE the narrow query so a count above 1 here identifies the label query's uniqueness as a narrowing rather than an absence of repeats on the screen" },
      { id: "stage2.purpose_open_api.input", candidateQuery: "input,button,a", exactText: "OPEN API",
        rationale: "the actionable shapes. Expected to match 0 — a radio's whole text is empty — and measured anyway, because 'expected to match 0' is the assumption class this workstream has been wrong about twice" },
    ]),
    // ── the VENDOR-METHOD screen (2026-08-12, all OPERATOR_TRANSCRIBED verbatim, none yet measured) ──
    //
    // Each target is swept as a BROAD query beside a single-tag narrowing, for the reason the purpose option and
    // the consents were: the broad row is what turns a narrow `1` into a disambiguation rather than a
    // coincidence, and four bare `visibleCount: 1` rows say nothing about why the shipped query is the narrow one.
    vendor_method_heading: Object.freeze([
      { id: "stage4.vendor.heading", candidateQuery: "h1,h2,h3,h4,legend,strong,p,span,div", exactText: "OPEN API 키 발급",
        rationale: "the screen's title, transcribed verbatim on 2026-08-12. Deliberately NOT a screen marker: the walk's own first page is called 오픈API 키 발급, and two titles differing only by 오픈/OPEN is exactly the collision that would make every earlier screen read as this one" },
    ]),
    vendor_method_prompt: Object.freeze([
      { id: "stage4.vendor.method_prompt", candidateQuery: "label,legend,th,dt,strong,span,div,p", exactText: "업체 입력 방식",
        rationale: "the field label for the method choice, transcribed off the live screen. SHIPPED AS THE SCREEN MARKER on 2026-08-12 and REFUTED the same day — it read PRESENT_NOT_WHOLE_TEXT on all five readings INCLUDING the vendor screen's own, so the phrase is on the page split across nodes and no whole-text query can see it. Kept because the absence is the evidence; see WING_VENDOR_METHOD_PROMPT_MARKER_REFUTED" },
    ]),
    vendor_partner: Object.freeze([
      { id: "stage4.vendor.partner.label", candidateQuery: "label", exactText: "연동업체 선택",
        rationale: "A SCREEN MARKER since 2026-08-12, and measured: hidden on all four earlier readings, visible:1 with a measured LABEL tag on the vendor screen. The association census agrees from the other direction — radio 0's derived name IS this string, via label[for]" },
      { id: "stage4.vendor.partner.broad", candidateQuery: "label,span,div,p,option", exactText: "연동업체 선택",
        rationale: "the same string against the wider families INCLUDING `option`, because this may be a select's placeholder rather than a radio's label — a distinction nothing has observed and which decides whether it can be ringed at all" },
    ]),
    vendor_self_dev: Object.freeze([
      { id: "stage4.vendor.self_dev.label", candidateQuery: "label", exactText: "자체개발(직접입력)",
        rationale: "the second SCREEN MARKER, measured on the same terms as the first. The WHOLE parenthetical is what matches: `self_dev`'s two halves (자체개발 / 직접입력) were swept on this screen too and both read PRESENT_NOT_WHOLE_TEXT, so the label is one string and not two" },
      { id: "stage4.vendor.self_dev.broad", candidateQuery: "label,span,div,p,option", exactText: "자체개발(직접입력)",
        rationale: "the whole-parenthetical string against the wider families, on the same terms as the vendor option beside it" },
    ]),
  });

export function isWingStage2ReconTarget(name: string): name is WingStage2ReconTarget {
  return (WING_STAGE2_RECON_TARGETS as readonly string[]).includes(name);
}

/* ────────────────────── STAGE-2 purpose-OPTION candidates (label calibration) ────────────────────── */

/**
 * Where a purpose-option candidate's wording comes from. Closed, and separate from the free-text `rationale`,
 * because provenance is the field a reviewer must be able to check mechanically.
 *
 * The three classes are not interchangeable. A product-owner flow description is a human's account of WING's
 * copy; a spacing variant is a mechanical transform of one; an operator transcription is a human reading the
 * live screen. None of them is a measurement, which is why they are all candidates and none is shipped.
 */
export const WING_PURPOSE_CANDIDATE_PROVENANCES = [
  "PRODUCT_OWNER_FLOW_DESCRIPTION",
  "MECHANICAL_SPACING_VARIANT",
  "OPERATOR_TRANSCRIBED",
] as const;
export type WingPurposeCandidateProvenance = (typeof WING_PURPOSE_CANDIDATE_PROVENANCES)[number];

export interface WingPurposeOptionCandidate {
  readonly id: string;
  readonly exactText: string;
  readonly provenance: WingPurposeCandidateProvenance;
  readonly rationale: string;
}

/**
 * **The fixed strings each visible Stage-2 choice control's derived name is compared against.**
 *
 * Every entry traces to something on the record: the product owner's description of the official flow
 * (발급 → 연동 방식 선택 → 자체개발(직접입력) → 업체명 · URL · IP 주소 → 확인), a mechanical spacing variant of
 * one, or — since 2026-08-10 — an operator reading the live Stage-2 screen. Nothing here is invented wording.
 *
 * **The last two entries are the operator's verbatim transcription of the two visible radios**, taken on
 * 2026-08-10 in screen order. They are what the previous unit reserved `OPERATOR_TRANSCRIBED` for and declined
 * to guess at: it measured two radios, found `exactCandidateIndex: -1` on both, and recorded the wording as
 * unknown rather than shipping 업체연동 / 대행 / whatever seemed plausible into the live page as a query.
 *
 * **A human reading a screen is still not a measurement**, which is why they are candidates like the rest. What
 * it is, is a source class the other two cannot substitute for — and one that at least lands inside a bound the
 * previous unit's measurement had already set. That run recorded radio 0's derived name in the `short` band
 * (1–8 characters) and radio 1's in `medium` (9–24), knowing nothing of the strings. `OPEN API` is 8 and
 * `플레이오토 웹 솔루션` is 11, in that order.
 *
 * **That check is weaker than it looks, and the weakness is ours.** The two bands were stated in the request
 * that asked for the transcription, so the reading was not blind to what would satisfy them. It can still catch
 * a gross error — the wrong screen, the wrong element, the two options reversed — but it is not independent
 * confirmation, and the bands are wide. Nothing here ties either string to either control; producing that tie
 * is what the calibration re-run is for.
 *
 * Note what the transcription settles about the flow description, before any instrument runs: **neither radio
 * is labelled 자체개발 or 직접입력.** One option names a specific solution rather than describing an integration
 * method. Whether `OPEN API` is the self-developed path the flow account describes, and what the other option's
 * relationship to WING is, are product questions this module does not answer and must not assume.
 *
 * Ordered flow-description-first, then spacing variants, then transcriptions — the order they entered the file.
 * Ordering carries no claim about the screen, and the comparison is exhaustive, so it is order-insensitive by
 * construction; the indices are stable only so an earlier run's `exactCandidateIndex` stays readable.
 */
export const WING_STAGE2_PURPOSE_OPTION_CANDIDATES: readonly WingPurposeOptionCandidate[] = Object.freeze([
  Object.freeze({
    id: "purpose_option.self_dev",
    exactText: "자체개발",
    provenance: "PRODUCT_OWNER_FLOW_DESCRIPTION" as const,
    rationale: "the flow description's name for the self-developed option; already a Stage-2 recon candidate, which measured 0 whole-text matches",
  }),
  Object.freeze({
    id: "purpose_option.self_dev_spaced",
    exactText: "자체 개발",
    provenance: "MECHANICAL_SPACING_VARIANT" as const,
    rationale: "the same word with the space Korean UI copy often inserts — the single likeliest cause of an exact-match miss",
  }),
  Object.freeze({
    id: "purpose_option.direct_input",
    exactText: "직접입력",
    provenance: "PRODUCT_OWNER_FLOW_DESCRIPTION" as const,
    rationale: "the parenthetical in 자체개발(직접입력); the option's visible label may be the parenthetical rather than the head word",
  }),
  Object.freeze({
    id: "purpose_option.direct_input_spaced",
    exactText: "직접 입력",
    provenance: "MECHANICAL_SPACING_VARIANT" as const,
    rationale: "spacing variant of the parenthetical, for the same reason",
  }),
  Object.freeze({
    id: "purpose_option.open_api",
    exactText: "OPEN API",
    provenance: "OPERATOR_TRANSCRIBED" as const,
    rationale: "the FIRST visible radio's label, read off the live Stage-2 screen by the operator on 2026-08-10 and reproduced verbatim; 8 characters, which is the `short` band the 2026-08-09 run measured for radio 0",
  }),
  Object.freeze({
    id: "purpose_option.playauto_web_solution",
    exactText: "플레이오토 웹 솔루션",
    provenance: "OPERATOR_TRANSCRIBED" as const,
    rationale: "the SECOND visible radio's label, transcribed verbatim on 2026-08-10; 11 characters, which is the `medium` band measured for radio 1. It names a specific solution rather than describing an integration method, so nothing about it may be inferred from the flow description",
  }),
]);

/**
 * **The TERMS screen's two checkbox labels**, transcribed verbatim on 2026-08-10.
 *
 * A separate constant from the purpose options rather than more entries in it, because they belong to a
 * different screen and a different decision. Folding them into a list called "purpose option candidates" would
 * make the name lie, and this workstream has spent three units fixing names that stopped matching contents.
 *
 * **Two consents, not one.** The API terms and the category-matching service are separate checkboxes with
 * separate wording, and nothing in SellerOps may treat agreeing to one as agreeing to the other — or agree on
 * the seller's behalf at all. These strings exist so a tutorial can NAME each box; the operator ticks them.
 */
export const WING_STAGE3_TERMS_OPTION_CANDIDATES: readonly WingPurposeOptionCandidate[] = Object.freeze([
  Object.freeze({
    id: "terms_option.api_agree",
    exactText: "API 이용 약관에 동의합니다.",
    provenance: "OPERATOR_TRANSCRIBED" as const,
    rationale: "the FIRST terms checkbox's visible label, read off the live screen on 2026-08-10 and reproduced verbatim, trailing period included",
  }),
  Object.freeze({
    id: "terms_option.category_agree",
    exactText: "카테고리 자동 매칭 서비스 이용에 동의합니다.",
    provenance: "OPERATOR_TRANSCRIBED" as const,
    rationale: "the SECOND terms checkbox's visible label, transcribed verbatim on 2026-08-10; a distinct consent from the API terms and never bundled with it",
  }),
]);

/**
 * **Every fixed string the label-association census compares a visible choice control's derived name against.**
 *
 * The purpose options first, then the terms options, so the indices an earlier run recorded still mean what
 * they meant: `OPEN API` stays 4 and `플레이오토 웹 솔루션` stays 5. Appending is the only safe way to grow this
 * list, and the reason is on the record — the association reading is stored as an INDEX.
 *
 * One list rather than one-per-screen because the census takes one list per call and the run does not know
 * which screen it is on: it knows what it read. A checkbox whose name matches a purpose option, or a radio
 * whose name matches a terms label, would be a finding worth having rather than a lookup that silently missed.
 */
export const WING_STAGE4_VENDOR_METHOD_OPTION_CANDIDATES: readonly WingPurposeOptionCandidate[] = Object.freeze([
  Object.freeze({
    id: "vendor_method_option.partner",
    exactText: "연동업체 선택",
    provenance: "OPERATOR_TRANSCRIBED" as const,
    rationale: "the integration-vendor option on the vendor-method screen, transcribed verbatim on 2026-08-12. Whether it is a radio, a select placeholder, or the label of a select is not established, and the census is one of the two instruments that can tell them apart",
  }),
  Object.freeze({
    id: "vendor_method_option.self_dev",
    exactText: "자체개발(직접입력)",
    provenance: "OPERATOR_TRANSCRIBED" as const,
    rationale: "the self-developed option, transcribed WHOLE including the parenthetical. The purpose screen's candidates carry the two halves separately (자체개발 / 직접입력) and both measured 0 there — so which of the three forms this screen actually uses is unknown and is being measured, not assumed",
  }),
]);

export const WING_CHOICE_LABEL_CANDIDATES: readonly WingPurposeOptionCandidate[] = Object.freeze([
  ...WING_STAGE2_PURPOSE_OPTION_CANDIDATES,
  ...WING_STAGE3_TERMS_OPTION_CANDIDATES,
  // APPENDED, never inserted — the association reading is stored as an INDEX into this list, so `OPEN API` must
  // stay 4 and the two terms sentences must stay 6 and 7 for every record already written.
  ...WING_STAGE4_VENDOR_METHOD_OPTION_CANDIDATES,
]);

/**
 * **The walk's LAST control.** Named once, in the leaf, so every layer refers to the same thing.
 *
 * It read "the control that creates the key" until 2026-08-12. It is not — see
 * {@link WING_KEY_CREATION_CONTROL_REFUTATION} directly below, which is the whole story. The id keeps its
 * `issue_final` spelling because renaming it would touch every layer at the moment the real key-creating
 * control is UNKNOWN, and a name that is a second guess is worse than one whose doc says what is established.
 *
 * MEASURED to exist and located by text; never pressed by any phase. No phase in this workstream has tooling
 * that could press it, and the boundary is deliberate: key issuance is its own approval step, with its own
 * manifest, and cannot be reached by continuing a discovery run one more checkpoint.
 */
export const WING_KEY_CREATION_CONTROL_ID = "stage3.terms.issue_final" as const;

/**
 * **REFUTED 2026-08-12: `약관 동의 및 Key 발급받기` does NOT create the key.**
 *
 * It was pressed, on the live guided walk `apr-197d0cd2c9c7` / `wt-c5f5184e4a12` at git `7d19e624` — outside
 * that run's approved scope, which budgeted zero presses of it — and **no key was issued.** What appeared
 * instead is a further screen nothing in this codebase had ever seen: an integration-method form headed
 * `OPEN API 키 발급`, with `업체 입력 방식` / `연동업체 선택`, a `자체개발(직접입력)` option, a `업체명` field,
 * and `취소` / `확인`. The operator reports that the key is issued by THAT screen's `확인`.
 *
 * **The claim it replaces was asserted, never measured.** Five places said this control "CREATES THE KEY" as
 * fact — the manifest operation, the preflight disclosure, the probe's warning, the seller-facing Korean step
 * copy, and the target's own doc comment. Nobody had pressed it, because every phase correctly refused to; so
 * the one observation that could settle it was the one the safety boundary prevented. That is not a criticism
 * of the boundary. It is the reason a claim of this shape has to be written down as an expectation until
 * something observes it, exactly as `pressOutcome: "UNCONFIRMED"` is on the 발급 record.
 *
 * **The product owner was right all along, about a screen nobody could reach.** The original flow description
 * — 발급 → 연동 방식 선택 → 자체개발(직접입력) → 업체명 · URL · IP 주소 → 확인 — was judged "wrong about the
 * ordering" on 2026-08-10 when the purpose screen led to TERMS instead. It was not wrong; the vendor form sits
 * AFTER the terms, and every reading since has measured `업체명` / `URL` / `IP 주소` as present-but-hidden
 * precisely because the screen holding them had not been opened. Four flow-discovery checkpoints on
 * 2026-08-11 read them `PRESENT_HIDDEN_ONLY` and could not have read anything else.
 *
 * **What stays true, and what stops being a reason.** The walk still rests in front of this control, and that
 * is still correct — but the reason is now "what follows it is not established", not "it creates the key". The
 * agent's press budget for it remains zero and no phase gains tooling to press it.
 *
 * **OPERATOR_REPORTED, not measured.** No apparatus has read the vendor screen: it is past every phase's stop
 * point, so its markers, its option labels and its `확인` are all uncalibrated. Nothing may be promoted, guided
 * or auto-advanced from this record — it says what is known and names what is not.
 */
export interface WingKeyCreationControlRefutation {
  readonly status: "LIVE_DOM_CALIBRATION_REFUTED";
  readonly refutedOn: "2026-08-12";
  /** The run on which the press happened. */
  readonly runId: "wt-c5f5184e4a12";
  readonly approvalId: "apr-197d0cd2c9c7";
  readonly gitSha: "7d19e624";
  /** The control the claim was about. */
  readonly controlId: typeof WING_KEY_CREATION_CONTROL_ID;
  /** The withdrawn claim, named in full so restoring it means deleting a sentence that says not to. */
  readonly withdrawnClaim: "PRESSING_IT_CREATES_THE_KEY";
  /** How the claim was arrived at. It was never a reading. */
  readonly withdrawnClaimBasis: "ASSERTED_FROM_THE_CONTROL_LABEL_NEVER_OBSERVED";
  /**
   * **The press was outside the run's approved scope**, and the record says so rather than describing a walk
   * that stopped where the manifest said it would. A record that reports the boundary holding when it did not
   * is worth less than no record.
   */
  readonly pressWasInScope: false;
  /** What the press produced. The whole refutation, in one field. */
  readonly keyIssued: false;
  /**
   * **WHO says no key was issued. Not the apparatus — it structurally cannot say.**
   *
   * `wingIssuedStateFrom` returns `NO_DISCRIMINATING_SIGNAL`, and that is itself a MEASURED result: every
   * sanitized signal this recorder captures is identical on an issued and a no-key surface. So `keyIssued:
   * false` is the operator's report of their own screen, on the same footing as `revealedScreenAttribution`
   * beside it — and it was missing that footing while its neighbour had it, which is how "no key was issued"
   * came to be repeated as an apparatus MEASUREMENT in eight operator-facing places. The guard against it is in
   * `wing-vendor-method-discovery.test.ts`, which greps the whole tree, so the phrasing may not come back.
   */
  readonly keyIssuedAttribution: typeof WING_KEY_ABSENCE_ATTRIBUTION;
  /** The screen that appeared instead — OPERATOR-REPORTED; no apparatus has read it. */
  readonly revealedScreen: "VENDOR_INTEGRATION_METHOD_FORM";
  readonly revealedScreenAttribution: "OPERATOR_REPORTED_NOT_MEASURED";
  /**
   * The control the operator reports actually issues the key. Uncalibrated, unlocated, and deliberately NOT
   * given a candidate here: writing a query for a screen nobody has measured is the move this file exists to
   * refuse.
   */
  readonly keyCreatedBy: "THE_VENDOR_FORM_CONFIRM_UNCALIBRATED";
  /** The walk's stop point is unchanged; only its stated reason is. */
  readonly restsBeforeControlStillCorrect: true;
  readonly newReasonToRest: "WHAT_FOLLOWS_IT_IS_NOT_ESTABLISHED";
}

/**
 * **What "no key was issued" rests on, named once.**
 *
 * The operator looked at their own screen and reported it. SellerOps did not corroborate it and cannot: the
 * issued and no-key surfaces are measurably indistinguishable across every signal it captures. The one thing
 * the runtime CAN add is negative and weak — the sanitized page category never became `credential_shown` on
 * any reading of any run — and a category that does not change is not a credential that does not exist.
 */
export const WING_KEY_ABSENCE_ATTRIBUTION = "OPERATOR_REPORTED_APPARATUS_CANNOT_DISCRIMINATE" as const;

export const WING_KEY_CREATION_CONTROL_REFUTATION: WingKeyCreationControlRefutation = Object.freeze({
  status: "LIVE_DOM_CALIBRATION_REFUTED",
  refutedOn: "2026-08-12",
  runId: "wt-c5f5184e4a12",
  approvalId: "apr-197d0cd2c9c7",
  gitSha: "7d19e624",
  controlId: WING_KEY_CREATION_CONTROL_ID,
  withdrawnClaim: "PRESSING_IT_CREATES_THE_KEY",
  withdrawnClaimBasis: "ASSERTED_FROM_THE_CONTROL_LABEL_NEVER_OBSERVED",
  pressWasInScope: false,
  keyIssued: false,
  keyIssuedAttribution: WING_KEY_ABSENCE_ATTRIBUTION,
  revealedScreen: "VENDOR_INTEGRATION_METHOD_FORM",
  revealedScreenAttribution: "OPERATOR_REPORTED_NOT_MEASURED",
  keyCreatedBy: "THE_VENDOR_FORM_CONFIRM_UNCALIBRATED",
  restsBeforeControlStillCorrect: true,
  newReasonToRest: "WHAT_FOLLOWS_IT_IS_NOT_ESTABLISHED",
});

/**
 * Fail-closed capability check, run BEFORE the operator is asked for anything.
 *
 * An association census with no candidates to compare against still measures derivation, association and
 * grouping — but it cannot answer the question the phase is named for, and every row would read
 * `exactCandidateIndex: -1` for the trivial reason that there was nothing to match. Spending a live grant on an
 * instrument that cannot produce its headline finding is the same mistake `BLIND_INSTRUMENT` exists to stop on
 * the reveal harness; this is the same gate, one surface over.
 */
export const WING_LABEL_CALIBRATION_BLIND_REASON = "PURPOSE_OPTION_CANDIDATES_EMPTY" as const;

export function wingLabelCalibrationBlind(candidates: readonly WingPurposeOptionCandidate[]): boolean {
  return candidates.filter((c) => c.exactText.trim().length > 0).length === 0;
}

/**
 * Resolve a Stage-2 recon scope from a comma-separated request, fail-closed. Absent/empty ⇒ the full set.
 *
 * Stage-2 targets are a SEPARATE namespace from {@link WingProbeTargetName} on purpose. `purpose`,
 * `vendor_url` and `confirm` are not shipped locators and have no baseline spec, so adding them to the canonical
 * probe names would widen what an ordinary selector probe can be pointed at — a strictly larger blast radius
 * than this unit needs, for the convenience of one shared parser.
 */
export function resolveWingStage2ReconScope(
  raw: string | undefined | null,
): { ok: true; targets: WingStage2ReconTarget[] } | { ok: false; reason: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, targets: [...WING_STAGE2_RECON_TARGETS] };
  const requested = trimmed.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  if (requested.length === 0) return { ok: true, targets: [...WING_STAGE2_RECON_TARGETS] };
  const unknown = requested.filter((t) => !isWingStage2ReconTarget(t));
  if (unknown.length > 0) {
    // A COUNT, never the tokens: this reason reaches stderr, and echoing an arbitrary env value there is how a
    // sanitized surface acquires an unsanitized hole.
    return { ok: false, reason: `${unknown.length} unrecognized Stage-2 recon target name(s)` };
  }
  // Canonical order + de-duplicated, so the manifest and the sweep describe the same set in the same words.
  return { ok: true, targets: WING_STAGE2_RECON_TARGETS.filter((t) => requested.includes(t)) };
}

/**
 * **Is the surface in front of us actually Stage-2?** Fail-closed precondition for the Stage-2 recon sweep.
 *
 * The operator presses 발급 themselves and then signals ready, so nothing structurally prevents a sweep of
 * Stage-2 candidate labels running against the INITIAL surface — and that is the one mistake that would be
 * expensive, because it produces a full set of confident `ABSENT` verdicts for labels that were simply never on
 * screen. The previous recon already learned that lesson the other way round: initial-surface misses were not
 * transferable to Stage-2, and they would not be transferable back.
 *
 * The test is the one thing the reveal run actually measured: `choiceControlCountBucket` was `none` on the
 * initial surface and `few` after the press. So a visible choice control is required. This is a NECESSARY
 * condition, not a sufficient one — it cannot prove the surface is Stage-2, only rule out the surface we know
 * it is not.
 */
export const WING_STAGE2_PRECONDITIONS = ["OK", "NOT_OPEN_API_SURFACE", "NO_VISIBLE_CHOICE_CONTROL", "NOT_OBSERVED"] as const;
export type WingStage2Precondition = (typeof WING_STAGE2_PRECONDITIONS)[number];

export function wingStage2Precondition(
  observation: { pageCategory: string; signals: { choiceControlCountBucket?: string } } | null,
): WingStage2Precondition {
  if (!observation) return "NOT_OBSERVED";
  if (observation.pageCategory !== "open_api_issuance") return "NOT_OPEN_API_SURFACE";
  const bucket = observation.signals.choiceControlCountBucket;
  // `undefined` is NOT "none". An unmeasured signal cannot satisfy a precondition, and it cannot fail one for
  // the reason the caller would assume either — so it is refused as unobserved rather than as an empty Stage-2.
  if (bucket === undefined) return "NOT_OBSERVED";
  return bucket === "none" ? "NO_VISIBLE_CHOICE_CONTROL" : "OK";
}

/**
 * **The SUPERSEDED record: the run where Stage-2 opened and the instrument could not see it.**
 *
 * Retained, like the `issue` calibration refutation, because the shape of the failure is the useful part. On
 * 2026-08-09 the reveal run (`wt-6a34bd527b2b`, `0297d307`) highlighted the real `API Key 발급 받기` control, the
 * operator pressed it themselves, and reported a **persistent** purpose-selection surface. The apparatus returned
 * `SURFACE_UNCHANGED` with `changedSignals: []` — the predicate could not fire (see `stage2SurfaceRevealed`), so
 * the run STOPPED rather than claiming success, which is the only reason the record said "unmeasured" instead of
 * something confident and false.
 */
export interface WingStage2ApparatusFailure {
  readonly observedOn: string;
  readonly gitSha: string;
  readonly runId: string;
  readonly appearance: "OPERATOR_REPORTED";
  readonly persistent: true;
  readonly apparatusOutcome: "SURFACE_UNCHANGED";
  readonly apparatusChangedSignalCount: 0;
  readonly cause: "PREDICATE_UNSATISFIABLE_ON_WING_MARKUP";
}

const WING_STAGE2_APPARATUS_FAILURE: WingStage2ApparatusFailure = Object.freeze({
  observedOn: "2026-08-09",
  gitSha: "0297d307",
  runId: "wt-6a34bd527b2b",
  appearance: "OPERATOR_REPORTED",
  persistent: true,
  apparatusOutcome: "SURFACE_UNCHANGED",
  apparatusChangedSignalCount: 0,
  cause: "PREDICATE_UNSATISFIABLE_ON_WING_MARKUP",
});

/**
 * **PROVENANCE for Stage-2, now that an instrument has finally seen one.**
 *
 * On 2026-08-09 the Reveal Live v3 run (`wt-dc2b46e93881`, grant `apr-3b60dacb9a69`, `3699df9e`) highlighted the
 * real `API Key 발급 받기` control, the operator confirmed the highlight visually, pressed it themselves, and
 * Stage-2 persisted. The agent's click/type/submit budget was zero, and it made ONE sanitized observation.
 *
 * The apparatus returned `CONFIGURATION_SURFACE_SUSPECTED` off exactly **one** moved signal:
 * `choiceControlCountBucket` `none → few`. That is the purpose-selection disjunct, firing on the surface it was
 * written for. The census this run replaced had no `choiceControlCount` at all, so **v2 could not have detected
 * this transition** whatever the page did. That is the provable half, and it is the whole point. Whether the
 * marketplace ALSO changed between two separate runs is not measurable from either capture, so this record does
 * not say it did not — an earlier version of this comment asserted exactly that, under a heading promising
 * claims at the strength the evidence supports.
 *
 * **Everything here is either a sanitized machine reading or explicitly attributed to the operator**, and the
 * distinction is the whole point: both prior calibration failures came from an operator-sourced or expected
 * value sitting unlabelled among measured ones. (Two, not three. The third failure on this surface —
 * {@link WingStage2ApparatusFailure} — has a different cause, `PREDICATE_UNSATISFIABLE_ON_WING_MARKUP`: a
 * predicate that could not fire, not an unlabelled value, and not a calibration.)
 *
 * **What is still NOT known.** No label, no role, no control identity, no wording — `structuralMarkerMeasured`
 * stays `false`. A bucket moving from `none` to `few` says 1–3 painting, enabled choice controls appeared. It does
 * not say what they are, what they are called, or what selecting one would do. That is the READ_ONLY Stage-2
 * recon's job, and nothing here may substitute for it.
 */
export interface WingStage2LiveEvent {
  readonly observedOn: string;
  readonly gitSha: string;
  readonly runId: string;
  /**
   * The surface's existence is operator-visible; the TRANSITION is now machine-measured. Both halves are named
   * because neither alone is the fact: the operator can see a screen the census cannot read, and the census can
   * read a delta without knowing what produced it.
   */
  readonly appearance: "OPERATOR_VISIBLE_TRANSITION_MACHINE_MEASURED";
  /** Operator-reported: it stayed on screen. */
  readonly persistent: true;
  readonly apparatusOutcome: "CONFIGURATION_SURFACE_SUSPECTED";
  readonly apparatusChangedSignalCount: 1;
  /**
   * The ONE sanitized delta, verbatim. Named rather than summarised so a later reader cannot mistake the
   * strength of this evidence: one bucket, one step, on one capture.
   */
  readonly measuredTransition: "choiceControlCountBucket:none->few";
  /**
   * The three **Stage-2 predicate disjuncts** that were measured on both sides and did NOT move, plus
   * `pageCategory` (not a signal — see `changedSignalNames` — but the coarsest thing that could have moved).
   *
   * Deliberately NOT the full set of unchanged signals: roughly nine more census signals also held still, as
   * `apparatusChangedSignalCount: 1` already implies. What this list is for is the predicate's own terms, so a
   * reader cannot assume more of the detector fired than did. An earlier doc comment called it "signals that
   * were measured on BOTH sides and did NOT move", which was both non-exhaustive and not signals-only.
   */
  readonly measuredUnchanged: readonly ["dialogLikePresent:false", "actionControlCountBucket:many", "submitAffordancePresent:false", "pageCategory:open_api_issuance"];
  /**
   * The same `dialogLikePresent` reading as in {@link measuredUnchanged}, surfaced as its own field because it
   * is a finding in its own right: **no dialog-contract container was painting and enabled on either side**, so
   * Stage-2 does not use that contract and a detector built only on it would have seen nothing.
   *
   * The selector set lives in `EXTRACT_WING_CENSUS` and is NOT restated here — a hand-copied list drifts
   * silently when the census changes, and a test anchors this record to the shipped script instead.
   *
   * Read it as exactly that and no further. It is NOT a measurement that the surface is visually non-modal: an
   * overlay built from plain `div`s with none of those attributes reads `false` here while looking like a modal
   * to the seller. What is measured is the markup contract, not the appearance. Nor is "absent" quite right —
   * the census filters to painting, non-`aria-disabled` elements, so a hidden dialog node also reads `false`.
   */
  readonly dialogLikePresent: false;
  /**
   * Still `false`. A count moved; nothing named, typed, or identified any Stage-2 control. No tag, no role, no
   * label, no wording. The recon exists precisely because this is false.
   */
  readonly structuralMarkerMeasured: false;
  /** ONE capture. No stability claim, no cross-run anchor — the mistake the `issue` calibration already made. */
  readonly captureCount: 1;
  readonly signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED";
  /** Unchanged and unchangeable by this evidence — the classifier still cannot tell issued from no-key. */
  readonly keyCreationRuledOut: false;
  readonly issuedStateReason: "NO_DISCRIMINATING_SIGNAL";
  /** Operator actions on the marketplace. Nothing was selected and no 확인 was pressed. */
  readonly operatorSelectedPurpose: false;
  readonly operatorPressedConfirm: false;
  /**
   * The operator's transcription of the on-screen text remains a CANDIDATE. This run measured a control *count*,
   * never any wording, so nothing here promotes the reported sentence to a measured label.
   */
  readonly reportedTextRecordedAs: "WING_STAGE2_RECON_CANDIDATES.purpose";
  readonly purposeWordingMeasured: false;
  /** The run whose apparatus failed on this same surface, kept on the record rather than overwritten. */
  readonly supersedes: WingStage2ApparatusFailure;
}

export const WING_STAGE2_LIVE_EVENT: WingStage2LiveEvent = Object.freeze({
  observedOn: "2026-08-09",
  gitSha: "3699df9e",
  runId: "wt-dc2b46e93881",
  appearance: "OPERATOR_VISIBLE_TRANSITION_MACHINE_MEASURED",
  persistent: true,
  apparatusOutcome: "CONFIGURATION_SURFACE_SUSPECTED",
  apparatusChangedSignalCount: 1,
  measuredTransition: "choiceControlCountBucket:none->few",
  measuredUnchanged: Object.freeze([
    "dialogLikePresent:false",
    "actionControlCountBucket:many",
    "submitAffordancePresent:false",
    "pageCategory:open_api_issuance",
  ]) as WingStage2LiveEvent["measuredUnchanged"],
  dialogLikePresent: false,
  structuralMarkerMeasured: false,
  captureCount: 1,
  signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED",
  keyCreationRuledOut: false,
  issuedStateReason: "NO_DISCRIMINATING_SIGNAL",
  operatorSelectedPurpose: false,
  operatorPressedConfirm: false,
  reportedTextRecordedAs: "WING_STAGE2_RECON_CANDIDATES.purpose",
  purposeWordingMeasured: false,
  supersedes: WING_STAGE2_APPARATUS_FAILURE,
});

/** The probe scope a live recon run would need approving — the three unresolved targets and nothing else. */
export const WING_RECON_APPROVED_SCOPE: readonly WingProbeTargetName[] = Object.freeze([
  "self_dev",
  "vendor_info",
  "call_ip",
]);

/* ────────────────────────────── STAGE-2 RECON evidence (2026-08-09, live) ────────────────────────────── */

/**
 * **The first STRUCTURAL measurement of Stage-2.** Distinct from {@link WING_STAGE2_LIVE_EVENT}, which recorded
 * that the surface APPEARS and that one bucket moved. This records what is ON it.
 *
 * Run `wt-2b984a46c298` / `wingrec_0f296204926c`, git `277220f7`, phase `COUPANG_WING_STAGE2_RECON`. The
 * operator pressed `API Key 발급 받기` themselves, left the purpose screen untouched, and signalled ready. The
 * agent's click / type / submit / highlight / tag budget was zero, and it took one read-only pass.
 *
 * **Every value below is MEASURED unless its own field says otherwise.** The three provenance classes are kept
 * apart because collapsing them is how this workstream produced three false calibrations: what the apparatus
 * read, what the operator saw, and what we *think* explains a reading are different kinds of thing.
 */
export interface WingStage2ReconEvidence {
  readonly observedOn: string;
  readonly gitSha: string;
  readonly runId: string;
  readonly recordId: string;
  readonly precondition: "OK";
  /** MEASURED: painting + enabled choice controls on the purpose screen. */
  readonly visibleChoiceControlCount: 2;
  /**
   * MEASURED: matched the choice-control selector but were excluded (not painting, or disabled). It is the
   * LARGER number, and it is recorded because "two radios" alone would misdescribe the DOM.
   */
  readonly hiddenChoiceControlCount: 10;
  /**
   * MEASURED: the closed-vocabulary shape of every VISIBLE choice control. Native radio inputs with no ARIA
   * role — not role-option cards, not a listbox.
   */
  readonly visibleShapes: readonly [{ readonly tag: "INPUT"; readonly inputType: "radio"; readonly role: "none"; readonly count: 2 }];
  /**
   * MEASURED: no painting `fieldset` / `[role=radiogroup]` / `[role=listbox]` in the document.
   *
   * That is NOT "the radios are ungrouped", which an earlier version of this comment claimed. HTML groups radios
   * by their shared `name` attribute, which the census deliberately never reads, and `[role=group]` is not in
   * the selector either. What was measured is the absence of three specific painting container kinds.
   */
  readonly groupContainerCount: 0;
  /**
   * MEASURED, and scoped to the SHAPE CENSUS only: neither of that script's bounds was hit.
   *
   * These flags say nothing about the candidate sweep. The seven absences below come from a different in-page
   * script (`buildFixedLabelLocateScript`), which carries its own 4000-element cap and emits **no truncation
   * flag at all** — see {@link absenceBounds}.
   */
  readonly scanTruncated: false;
  readonly bucketsTruncated: false;
  /**
   * MEASURED: `확인` matched exactly one painting element, with an opaque structural signature.
   *
   * **It is NOT recorded as the final key-issuance control.** That role comes from the product owner's
   * description of the official flow, and nothing has measured it: no press has been performed (and this phase
   * has no tooling that could), so what the control DOES is unmeasured. Locating a button is not learning its
   * effect — the `발급` calibration already made the inverse of that mistake by asserting a role it never read.
   */
  readonly confirmLocated: {
    readonly matchCount: 1;
    readonly verdict: "UNIQUE";
    readonly sig16: "c1b87128024cdec8";
    readonly signatureRole: "EVIDENCE_ONLY";
    readonly pressed: false;
    readonly effectMeasured: false;
    readonly isFinalIssuanceControl: "OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED";
  };
  /**
   * MEASURED absences — seven candidates, each probed and each matching zero painting elements. These are
   * *measured* zeros, not missing rows: `candidatesNotMeasured` is 0 and no probe faulted, so the distinction
   * the recon's `NOT_MEASURED` verdict exists to preserve is intact here.
   */
  readonly absentCandidateIds: readonly [
    "stage2.purpose.operator_reported",
    "stage2.self_dev.direct",
    "stage2.self_dev.baseline",
    "stage2.vendor_info.baseline",
    "stage2.vendor_url.url",
    "stage2.call_ip.ip_addr",
    "stage2.call_ip.baseline",
  ];
  /**
   * **Every candidate id this run actually probed** — the seven absences above plus the one that resolved.
   *
   * A positive statement of coverage, added on 2026-08-10 because the negative one could not survive the set
   * growing. `candidatesNotMeasured: 0` is a fact about the run's OWN sweep, and the only thing tying it to the
   * shipped set was a test asserting `candidatesMeasured === WING_STAGE2_RECON_CANDIDATES.length`. That guard
   * was right to exist and right to fire — but "the record covers today's set" is not a property a record of a
   * past run can keep. What it can keep is which ids it covered; whether the current set has outgrown that is
   * then a question anyone can answer, instead of an equality that has to be edited to stay true.
   */
  readonly measuredCandidateIds: readonly [
    "stage2.purpose.operator_reported",
    "stage2.self_dev.direct",
    "stage2.self_dev.baseline",
    "stage2.vendor_info.baseline",
    "stage2.vendor_url.url",
    "stage2.call_ip.ip_addr",
    "stage2.call_ip.baseline",
    "stage2.confirm.confirm",
  ];
  readonly candidatesMeasured: 8;
  readonly candidatesNotMeasured: 0;
  readonly probeFaults: 0;
  /**
   * **What an ABSENT verdict does and does not bound.** Two limits, both real, neither previously stated:
   *
   *  1. It counts **painting** matches only. The locate script also returns a `hiddenCount`, and the Stage-2
   *     sweep discards it — so "ABSENT" here cannot distinguish "no element carries this text" from "an element
   *     carries it but does not paint". That is the same visible/hidden ambiguity the `issue` locator was burned
   *     by, and the shape census carries `hiddenChoiceControlCount` precisely because of it.
   *  2. The locate script caps its candidate scan at 4000 elements and reports no truncation, so an absence is
   *     not provably a whole-document absence.
   *
   * Recorded rather than fixed: carrying `hiddenCount` through the sweep is a capability change, and this unit
   * lands evidence. It is the first thing the label-calibration unit should close.
   */
  readonly absenceBounds: {
    readonly countsPaintingMatchesOnly: true;
    readonly hiddenMatchCountCarried: false;
    readonly candidateScanTruncationReported: false;
  };
  /** ONE capture. No stability claim, no cross-run anchor. */
  readonly captureCount: 1;
  readonly signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED";
  /**
   * **UNMEASURED, and the reason the next unit exists.** Two radios were counted; what either of them MEANS was
   * not read. No label, no accessible name, no association. Guessing that one is 자체개발 would be inventing a
   * product decision from a count.
   */
  readonly purposeOptionSemanticsMeasured: false;
  /**
   * **INFERRED, not measured.** `exactText` compares an element's WHOLE normalized text, so a sentence rendered
   * across nested nodes matches nothing — the same shape as `발급` failing against `API Key 발급 받기`. It is the
   * leading explanation for seven absences and it is a hypothesis: no apparatus has tested it.
   */
  readonly absenceExplanation: {
    readonly hypothesis: "WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT";
    readonly provenance: "INFERRED";
    readonly tested: false;
  };
  /** OPERATOR_REPORTED: the screen was visibly open and persistent, and the sentence read as transcribed. */
  readonly surfaceVisibility: "OPERATOR_REPORTED";
  /** Operator actions on the marketplace. Nothing was selected and no 확인 was pressed. */
  readonly operatorSelectedPurpose: false;
  readonly operatorPressedConfirm: false;
  /** Unchanged and unchangeable by this evidence. */
  readonly keyCreationRuledOut: false;
  readonly issuedStateReason: "NO_DISCRIMINATING_SIGNAL";
  /**
   * The attempt immediately before this one, kept on the record. The operator signalled ready BEFORE pressing
   * 발급; the precondition read `choiceControlCountBucket: none` and refused, sweeping nothing.
   *
   * Retained because it is the only evidence that the gate does its job on a real surface: without it the run
   * would have produced eight confident ABSENT verdicts for a screen nobody was looking at — indistinguishable,
   * in the record, from the seven REAL absences measured above.
   */
  readonly precedingRefusal: {
    readonly recordId: "wingrec_d799c7b60ec5";
    readonly precondition: "NO_VISIBLE_CHOICE_CONTROL";
    readonly candidatesMeasured: 0;
    readonly cause: "OPERATOR_SIGNALLED_READY_BEFORE_PRESSING_발급";
  };
}

export const WING_STAGE2_RECON_EVIDENCE: WingStage2ReconEvidence = Object.freeze({
  observedOn: "2026-08-09",
  gitSha: "277220f7",
  runId: "wt-2b984a46c298",
  recordId: "wingrec_0f296204926c",
  precondition: "OK",
  visibleChoiceControlCount: 2,
  hiddenChoiceControlCount: 10,
  visibleShapes: Object.freeze([
    Object.freeze({ tag: "INPUT", inputType: "radio", role: "none", count: 2 }),
  ]) as WingStage2ReconEvidence["visibleShapes"],
  groupContainerCount: 0,
  scanTruncated: false,
  bucketsTruncated: false,
  confirmLocated: Object.freeze({
    matchCount: 1,
    verdict: "UNIQUE",
    sig16: "c1b87128024cdec8",
    signatureRole: "EVIDENCE_ONLY",
    pressed: false,
    effectMeasured: false,
    isFinalIssuanceControl: "OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED",
  }) as WingStage2ReconEvidence["confirmLocated"],
  absentCandidateIds: Object.freeze([
    "stage2.purpose.operator_reported",
    "stage2.self_dev.direct",
    "stage2.self_dev.baseline",
    "stage2.vendor_info.baseline",
    "stage2.vendor_url.url",
    "stage2.call_ip.ip_addr",
    "stage2.call_ip.baseline",
  ]) as WingStage2ReconEvidence["absentCandidateIds"],
  measuredCandidateIds: Object.freeze([
    "stage2.purpose.operator_reported",
    "stage2.self_dev.direct",
    "stage2.self_dev.baseline",
    "stage2.vendor_info.baseline",
    "stage2.vendor_url.url",
    "stage2.call_ip.ip_addr",
    "stage2.call_ip.baseline",
    "stage2.confirm.confirm",
  ]) as WingStage2ReconEvidence["measuredCandidateIds"],
  candidatesMeasured: 8,
  candidatesNotMeasured: 0,
  probeFaults: 0,
  absenceBounds: Object.freeze({
    countsPaintingMatchesOnly: true,
    hiddenMatchCountCarried: false,
    candidateScanTruncationReported: false,
  }) as WingStage2ReconEvidence["absenceBounds"],
  captureCount: 1,
  signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED",
  purposeOptionSemanticsMeasured: false,
  absenceExplanation: Object.freeze({
    hypothesis: "WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT",
    provenance: "INFERRED",
    tested: false,
  }) as WingStage2ReconEvidence["absenceExplanation"],
  surfaceVisibility: "OPERATOR_REPORTED",
  operatorSelectedPurpose: false,
  operatorPressedConfirm: false,
  keyCreationRuledOut: false,
  issuedStateReason: "NO_DISCRIMINATING_SIGNAL",
  precedingRefusal: Object.freeze({
    recordId: "wingrec_d799c7b60ec5",
    precondition: "NO_VISIBLE_CHOICE_CONTROL",
    candidatesMeasured: 0,
    cause: "OPERATOR_SIGNALLED_READY_BEFORE_PRESSING_발급",
  }) as WingStage2ReconEvidence["precedingRefusal"],
});

/* ──────────────── STAGE-2 LABEL CALIBRATION evidence (2026-08-09, live) ──────────────── */

/**
 * One candidate's full containment reading, verbatim, plus the presence verdict the fold derived from it.
 *
 * The four integers are on the record because **the summary below is derived from them and must be
 * re-derivable**. The first version of this record carried the presence verdicts alone and drew a cause split
 * from them — and got it backwards, because `presence` answers WHERE a label is, not WHY the recon missed it.
 * With the quad present, any reader (and the test) can recompute the split instead of trusting it.
 */
export interface WingStage2ContainmentRow {
  readonly exactVisible: number;
  readonly exactHidden: number;
  readonly deepestContainsVisible: number;
  readonly deepestContainsHidden: number;
  readonly hiddenMatchCount: number;
  readonly presence: WingStage2Presence;
}

/**
 * **Why the recon missed a label — derived from the quad, not from the presence verdict.**
 *
 * `presence` is a LOCATION vocabulary and its precedence puts a hidden whole-text match ahead of a painting
 * partial one. So the one candidate the whole-text hypothesis actually explains reads `PRESENT_HIDDEN_ONLY`,
 * and reading causes off the enum credits the hypothesis to candidates whose text is not on screen at all.
 * These three predicates are disjoint, total over a non-matching candidate, and computed from the integers.
 */
export const WING_STAGE2_MISS_CAUSES = [
  /** A PAINTING element contains the label, but no painting element's whole text equals it. THE hypothesis. */
  "WHOLE_TEXT_MISMATCH_ON_PAINTING_ELEMENT",
  /** The label occurs only in non-painting nodes — whole-text or not. Visibility, not the matcher. */
  "PRESENT_ONLY_IN_NON_PAINTING_NODES",
  /** The label does not occur on the page in any form, painting or not. */
  "NOT_PRESENT_IN_ANY_FORM",
] as const;
export type WingStage2MissCause = (typeof WING_STAGE2_MISS_CAUSES)[number];

/**
 * Classify why a candidate produced no painting whole-text match. Returns `null` for a candidate that DID
 * match — a matched candidate has no miss to explain, and giving it a cause would pad the split.
 */
export function wingStage2MissCause(q: {
  readonly exactVisible: number;
  readonly exactHidden: number;
  readonly deepestContainsVisible: number;
  readonly deepestContainsHidden: number;
}): WingStage2MissCause | null {
  if (q.exactVisible > 0) return null;
  if (q.deepestContainsVisible > 0) return "WHOLE_TEXT_MISMATCH_ON_PAINTING_ELEMENT";
  if (q.exactHidden + q.deepestContainsHidden > 0) return "PRESENT_ONLY_IN_NON_PAINTING_NODES";
  return "NOT_PRESENT_IN_ANY_FORM";
}

/**
 * **What each Stage-2 choice control IS — the association measurement, and what it did NOT establish.**
 *
 * Run `wt-1e2ab6816bcc` / `wingrec_5497afb9eec4`, grant `apr-848e2cfd06f2`, git `ce733f78`, phase
 * `COUPANG_WING_STAGE2_LABEL_CALIBRATION`. The operator pressed `API Key 발급 받기` themselves, left the purpose
 * screen untouched, and signalled ready. Agent click / type / submit / highlight / tag / selection budget: zero.
 * Eight candidates measured, eight containment readings, no fault, one capture.
 *
 * Sibling of {@link WingStage2ReconEvidence}, which counted the controls. This one reads how they are LABELLED.
 * It does not read what they SAY — {@link purposeOptionSemanticsMeasured} is still false, which is why no radio
 * may be selected yet.
 */
export interface WingStage2LabelCalibrationEvidence {
  readonly observedOn: string;
  readonly gitSha: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly recordId: string;
  readonly precondition: "OK";
  /**
   * MEASURED: the bucket the precondition actually turned on. Recorded because `precondition: "OK"` asserted
   * with no trace of the reading behind it is a verdict standing in for its own evidence.
   */
  readonly choiceControlCountBucket: "few";
  /** MEASURED: the shape census, re-read on this run. Tied to the recon's by test, not by assertion in prose. */
  readonly visibleChoiceControlCount: 2;
  /**
   * MEASURED. The UNION of not-painting and disabled, as on both censuses — a painting-but-disabled radio lands
   * here, so this must not be read as "not on screen".
   */
  readonly hiddenChoiceControlCount: 10;
  readonly groupContainerCount: 0;
  readonly visibleShapes: readonly [{ readonly tag: "INPUT"; readonly inputType: "radio"; readonly role: "none"; readonly count: 2 }];
  /**
   * **MEASURED: the two radios share one `name` group.** The fact the recon could not obtain — HTML groups
   * radios by their shared `name`, and the shape census deliberately never reads that attribute, so the earlier
   * record could say only that no painting `fieldset` / `[role=radiogroup]` / `[role=listbox]` existed. A code
   * comment over-claimed that as "the radios are ungrouped"; the correction runs the other way.
   *
   * The `name` VALUE was read in-page to bucket by and never left; only the ordinal did.
   */
  readonly nameGroupCount: 1;
  readonly largestNameGroupSize: 2;
  readonly ungroupedCount: 0;
  /**
   * MEASURED, per visible control, in document order. Both derive their name from a `label[for]`, one each,
   * with no wrapping `<label>` and no `aria-labelledby` reference.
   *
   * **Read as exactly that, and no further.** Three things this does NOT establish, each of which an earlier
   * draft asserted:
   *
   *  1. *Not "no `aria-label`".* `LABEL_FOR` means `aria-labelledby` and `aria-label` both lost the precedence
   *     race — which a whitespace-only `aria-label` also produces. Absence was never measured.
   *  2. *Not "the association resolves".* "Resolves" is the instrument's word for
   *     `ariaLabelledbyResolvedCount`, which is 0 here because there were no references to resolve.
   *  3. *Not "correctly wired".* Nothing checked that the `label[for]` element PAINTS — the lookup does no
   *     paint test — so a label element that exists is not yet a label a seller can read.
   *
   * `nameLengthBucket` differs between them, so the two options are not equal-length wording. That bounds each
   * label's SIZE and nothing else; no character of either is recorded.
   */
  readonly rows: readonly [
    {
      readonly index: 0;
      readonly nameSource: "LABEL_FOR";
      readonly nameLengthBucket: "short";
      readonly labelForCount: 1;
      readonly ancestorLabelCount: 0;
      readonly ariaLabelledbyRefCount: 0;
      readonly ariaLabelledbyResolvedCount: 0;
      readonly labelElementPaintMeasured: false;
      readonly hasIdAttr: true;
      readonly groupIndex: 0;
      readonly exactCandidateIndex: -1;
      readonly containsCandidateIndex: -1;
    },
    {
      readonly index: 1;
      readonly nameSource: "LABEL_FOR";
      readonly nameLengthBucket: "medium";
      readonly labelForCount: 1;
      readonly ancestorLabelCount: 0;
      readonly ariaLabelledbyRefCount: 0;
      readonly ariaLabelledbyResolvedCount: 0;
      readonly labelElementPaintMeasured: false;
      readonly hasIdAttr: true;
      readonly groupIndex: 0;
      readonly exactCandidateIndex: -1;
      readonly containsCandidateIndex: -1;
    },
  ];
  /**
   * **MEASURED: neither radio's derived name equals OR contains any of the four candidates.** All four were
   * sent, so this is a measured non-match across the whole set, not a partial sweep. What the labels DO say is
   * unmeasured.
   */
  readonly purposeCandidatesMatched: 0;
  readonly candidatesCompared: 4;
  /**
   * **WHICH four** — the same correction as {@link WingStage2ReconEvidence.measuredCandidateIds}, for the same
   * reason and on the same day. `candidatesCompared: 4` was tied to `WING_STAGE2_PURPOSE_OPTION_CANDIDATES.length`
   * by a test, and the transcription unit added the fifth and sixth entries. The run's own coverage is a fact
   * about the run; naming it keeps that fact true while the shipped set moves.
   *
   * That the list has since grown is not a defect in this record — it is the point. Every id here is a
   * flow-description entry or a spacing variant of one, and all four missed. The two entries that postdate this
   * run are the operator's transcription of what the radios actually say, which is why the non-match below is a
   * finding about the flow description rather than about the instrument.
   */
  readonly comparedCandidateIds: readonly [
    "purpose_option.self_dev",
    "purpose_option.self_dev_spaced",
    "purpose_option.direct_input",
    "purpose_option.direct_input_spaced",
  ];
  /**
   * **INFERRED, not measured:** that the operator-visible option wording differs from the product owner's flow
   * description (자체개발(직접입력)). Measured: neither label matches those words, and those words occur only in
   * non-painting nodes. The step to "the options are called something else" assumes the `LABEL_FOR`-derived
   * name is what a sighted seller reads — very likely, and not a measurement. `tested: false`.
   */
  readonly visibleWordingDiffersFromFlowDescription: {
    readonly provenance: "INFERRED";
    readonly tested: false;
  };
  /** MEASURED per candidate, keyed by OUR candidate id so it maps mechanically onto the recon's absence list. */
  readonly candidates: Readonly<Record<string, WingStage2ContainmentRow>>;
  /**
   * **The recon's single INFERRED explanation holds for ONE of its seven absences — and not the one an earlier
   * draft credited.**
   *
   * `WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT` is about the MATCHER failing on text that is on screen
   * but split across nodes. Exactly one candidate reads that way: `업체명`, with a painting element containing
   * it (`deepestContainsVisible: 1`) and no painting whole-text match. Four occur only in non-painting nodes —
   * visibility, not the matcher — and two do not occur at all.
   *
   * The first version of this record said "two", naming `자체개발` and `직접입력`, and it was wrong in a way
   * worth keeping on the page: both read `PRESENT_NOT_WHOLE_TEXT`, and that verdict names a LOCATION, not a
   * CAUSE. Their painting-container count is zero — the text is not on screen in any form — so the matcher was
   * never the reason. Meanwhile `업체명`, the one case the hypothesis does explain, is filed
   * `PRESENT_HIDDEN_ONLY` because the fold ranks a hidden whole-text match above a painting partial one.
   * Reading causes off the presence enum is the house defect: a guard one layer from the thing it guards.
   *
   * Every count here is derived from {@link candidates} by {@link wingStage2MissCause}, and a test recomputes
   * it rather than re-stating it — so a swapped verdict fails instead of preserving the arithmetic.
   *
   * None of this rewrites {@link WING_STAGE2_RECON_EVIDENCE}. Its `absenceBounds` correctly said its absences
   * counted painting matches only, which is exactly why six of the seven turn out to be about paint.
   */
  readonly absenceExplanationOutcome: {
    readonly hypothesis: "WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT";
    readonly verdict: "CONFIRMED_FOR_ONE_OF_SEVEN";
    readonly wholeTextMismatchOnPaintingElement: 1;
    readonly presentOnlyInNonPaintingNodes: 4;
    readonly notPresentInAnyForm: 2;
  };
  /**
   * **MEASURED: `확인` matched one PAINTING element and twenty non-painting ones.**
   *
   * The recon recorded `matchCount: 1, verdict: UNIQUE` and carried no hidden count. Its uniqueness was, and
   * remains, uniqueness *among painting elements*: if any of the twenty ever painted, the locator resolves to
   * many. A property of the page, recorded; not a decision about the locator, which is promoted to nothing.
   *
   * Still NOT the final key-issuance control. Nothing pressed it, this phase has no tooling that could, and its
   * role continues to come from the product owner's description of the flow.
   */
  readonly confirmLocated: {
    readonly visibleExactMatchCount: 1;
    readonly hiddenExactMatchCount: 20;
    readonly verdict: "UNIQUE";
    readonly uniquenessScope: "PAINTING_ELEMENTS_ONLY";
    readonly sig16: "c1b87128024cdec8";
    readonly signatureRole: "EVIDENCE_ONLY";
    readonly pressed: false;
    readonly effectMeasured: false;
    readonly isFinalIssuanceControl: "OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED";
  };
  /**
   * MEASURED: the signature is byte-identical to the one the recon run recorded (`wingrec_0f296204926c`, git
   * `277220f7`) — a different run on a different commit.
   *
   * The value says agreement with ONE earlier run and explicitly not established stability, because that is all
   * two captures support. The `issue` calibration's original defect was a stability claim built on captures that
   * were never independent; the fix is not to make the same claim off a smaller number. The signature stays
   * `EVIDENCE_ONLY`. (Not "two grants" — the recon record carries no `approvalId`, so that is unverifiable here.)
   */
  readonly signatureStability: "AGREES_WITH_ONE_EARLIER_RUN_NOT_ESTABLISHED";
  /** Captures taken BY THIS RUN. One. The agreement above is with a different run's capture, not a second here. */
  readonly captureCount: 1;
  /** MEASURED integrity of the sweep: every candidate probed, every containment read, nothing faulted. */
  readonly candidatesMeasured: 8;
  readonly candidatesNotMeasured: 0;
  readonly containmentMeasured: 8;
  readonly probeFaults: 0;
  readonly containmentFaults: 0;
  readonly associationFault: null;
  /**
   * MEASURED, and named per instrument — three different scripts have three different caps, and the earlier
   * draft collapsed them into one flag while reasoning about the wrong one. **The absences above are bounded by
   * {@link containmentScanTruncated}**, not by either census flag.
   */
  readonly shapeCensusScanTruncated: false;
  readonly shapeCensusBucketsTruncated: false;
  readonly associationScanTruncated: false;
  readonly associationRowsTruncated: false;
  readonly containmentScanTruncated: false;
  /**
   * MEASURED, and it explains itself: the open-API marker did not fire, and the surface still classified as
   * `open_api_issuance` because `credentialAnchorPresent` is the OTHER disjunct the classifier accepts. An
   * earlier draft called this "not explained by this run" while omitting the reading that explains it — which
   * is the selectivity the note claimed to be avoiding.
   */
  readonly openApiMarkerPresent: false;
  readonly credentialAnchorPresent: true;
  /**
   * **STILL FALSE, and the point of the record.** Shape, association, group membership and a length band are
   * known for both radios. What either one MEANS is not. Deciding which is 자체개발 from "one is short and one
   * is medium" would be inventing a product decision from a bucket.
   */
  readonly purposeOptionSemanticsMeasured: false;
  /** Operator actions on the marketplace. Nothing was selected and no 확인 was pressed. */
  readonly operatorSelectedPurpose: false;
  readonly operatorPressedConfirm: false;
  /** Unchanged and unchangeable by this evidence. */
  readonly keyCreationRuledOut: false;
  readonly issuedStateReason: "NO_DISCRIMINATING_SIGNAL";
  /** The structural measurement this one builds on, kept on the record rather than restated or overwritten. */
  readonly refines: WingStage2ReconEvidence;
}

function containmentRow(
  exactVisible: number,
  exactHidden: number,
  deepestContainsVisible: number,
  deepestContainsHidden: number,
  hiddenMatchCount: number,
): WingStage2ContainmentRow {
  return Object.freeze({
    exactVisible,
    exactHidden,
    deepestContainsVisible,
    deepestContainsHidden,
    hiddenMatchCount,
    // Derived by the SHIPPED fold, not transcribed: a hand-written verdict beside its own inputs is a place for
    // the two to disagree, and this record already shipped one wrong summary read off these verdicts.
    presence: wingStage2PresenceFrom({
      exactVisible,
      exactHidden,
      deepestContainsVisible,
      deepestContainsHidden,
      scanTruncated: false,
    }),
  });
}

export const WING_STAGE2_LABEL_CALIBRATION_EVIDENCE: WingStage2LabelCalibrationEvidence = Object.freeze({
  observedOn: "2026-08-09",
  gitSha: "ce733f78",
  runId: "wt-1e2ab6816bcc",
  approvalId: "apr-848e2cfd06f2",
  recordId: "wingrec_5497afb9eec4",
  precondition: "OK",
  choiceControlCountBucket: "few",
  visibleChoiceControlCount: 2,
  hiddenChoiceControlCount: 10,
  groupContainerCount: 0,
  visibleShapes: Object.freeze([
    Object.freeze({ tag: "INPUT", inputType: "radio", role: "none", count: 2 }),
  ]) as WingStage2LabelCalibrationEvidence["visibleShapes"],
  nameGroupCount: 1,
  largestNameGroupSize: 2,
  ungroupedCount: 0,
  rows: Object.freeze([
    Object.freeze({
      index: 0,
      nameSource: "LABEL_FOR",
      nameLengthBucket: "short",
      labelForCount: 1,
      ancestorLabelCount: 0,
      ariaLabelledbyRefCount: 0,
      ariaLabelledbyResolvedCount: 0,
      labelElementPaintMeasured: false,
      hasIdAttr: true,
      groupIndex: 0,
      exactCandidateIndex: -1,
      containsCandidateIndex: -1,
    }),
    Object.freeze({
      index: 1,
      nameSource: "LABEL_FOR",
      nameLengthBucket: "medium",
      labelForCount: 1,
      ancestorLabelCount: 0,
      ariaLabelledbyRefCount: 0,
      ariaLabelledbyResolvedCount: 0,
      labelElementPaintMeasured: false,
      hasIdAttr: true,
      groupIndex: 0,
      exactCandidateIndex: -1,
      containsCandidateIndex: -1,
    }),
  ]) as WingStage2LabelCalibrationEvidence["rows"],
  purposeCandidatesMatched: 0,
  candidatesCompared: 4,
  comparedCandidateIds: Object.freeze([
    "purpose_option.self_dev",
    "purpose_option.self_dev_spaced",
    "purpose_option.direct_input",
    "purpose_option.direct_input_spaced",
  ]) as WingStage2LabelCalibrationEvidence["comparedCandidateIds"],
  visibleWordingDiffersFromFlowDescription: Object.freeze({
    provenance: "INFERRED",
    tested: false,
  }) as WingStage2LabelCalibrationEvidence["visibleWordingDiffersFromFlowDescription"],
  candidates: Object.freeze({
    "stage2.purpose.operator_reported": containmentRow(0, 0, 0, 0, 0),
    "stage2.self_dev.direct": containmentRow(0, 0, 0, 2, 0),
    "stage2.self_dev.baseline": containmentRow(0, 0, 0, 2, 0),
    "stage2.vendor_info.baseline": containmentRow(0, 4, 1, 6, 4),
    "stage2.vendor_url.url": containmentRow(0, 2, 0, 5, 2),
    "stage2.call_ip.ip_addr": containmentRow(0, 2, 0, 8, 2),
    "stage2.call_ip.baseline": containmentRow(0, 0, 0, 0, 0),
    "stage2.confirm.confirm": containmentRow(1, 20, 1, 22, 20),
  }),
  absenceExplanationOutcome: Object.freeze({
    hypothesis: "WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT",
    verdict: "CONFIRMED_FOR_ONE_OF_SEVEN",
    wholeTextMismatchOnPaintingElement: 1,
    presentOnlyInNonPaintingNodes: 4,
    notPresentInAnyForm: 2,
  }) as WingStage2LabelCalibrationEvidence["absenceExplanationOutcome"],
  confirmLocated: Object.freeze({
    visibleExactMatchCount: 1,
    hiddenExactMatchCount: 20,
    verdict: "UNIQUE",
    uniquenessScope: "PAINTING_ELEMENTS_ONLY",
    sig16: "c1b87128024cdec8",
    signatureRole: "EVIDENCE_ONLY",
    pressed: false,
    effectMeasured: false,
    isFinalIssuanceControl: "OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED",
  }) as WingStage2LabelCalibrationEvidence["confirmLocated"],
  signatureStability: "AGREES_WITH_ONE_EARLIER_RUN_NOT_ESTABLISHED",
  captureCount: 1,
  candidatesMeasured: 8,
  candidatesNotMeasured: 0,
  containmentMeasured: 8,
  probeFaults: 0,
  containmentFaults: 0,
  associationFault: null,
  shapeCensusScanTruncated: false,
  shapeCensusBucketsTruncated: false,
  associationScanTruncated: false,
  associationRowsTruncated: false,
  containmentScanTruncated: false,
  openApiMarkerPresent: false,
  credentialAnchorPresent: true,
  purposeOptionSemanticsMeasured: false,
  operatorSelectedPurpose: false,
  operatorPressedConfirm: false,
  keyCreationRuledOut: false,
  issuedStateReason: "NO_DISCRIMINATING_SIGNAL",
  refines: WING_STAGE2_RECON_EVIDENCE,
});

/* ────────────────────── STAGE-2 purpose-OPTION IDENTIFICATION (the calibration re-run) ────────────────────── */

/**
 * **MEASURED on 2026-08-10: which radio is which.**
 *
 * The third Stage-2 reading, and the first that answers the question the phase is named for. The two previous
 * records could say how the controls are labelled and that no candidate matched; this one says *what they are*,
 * because the candidates it compared against were transcribed off the screen rather than derived from an
 * account of it.
 *
 * **The reading was predicted before it was taken.** A test built a fake Stage-2 as the operator described it
 * and ran the real generated script against the real shipped list; this record is that prediction, field for
 * field, taken from WING. That ordering is the point — a prediction written after the fact is a description.
 *
 * Deliberately compact. This unit does not open a landing per screen: the earlier records already carry the
 * bounds, the caveats and the absences, and repeating them here would create two places for one fact to drift.
 * What is here is what this run added, plus the check that it did not contradict anything.
 */
export interface WingStage2OptionIdentificationEvidence {
  readonly observedOn: "2026-08-10";
  readonly gitSha: "f9189d89";
  readonly runId: "wt-7ecf33125088";
  readonly approvalId: "apr-5ad6d4a1216b";
  readonly recordId: "wingrec_fd5caf3ca4ae";
  readonly precondition: "OK";
  /**
   * **MEASURED: each visible radio's derived name equals one transcribed candidate, and the two do not
   * collide.** `exactCandidateIndex` and `containsCandidateIndex` agree on both rows, which they must when the
   * match is whole-text — a disagreement would mean the label is wrapped in more text than the candidate.
   *
   * The ids are carried beside the indices ON PURPOSE. An index is a position in a list this record does not
   * own; the previous unit's guards exist because a reordering silently re-aims a bare numeral.
   */
  readonly rows: readonly [
    {
      readonly index: 0;
      readonly nameSource: "LABEL_FOR";
      readonly nameLengthBucket: "short";
      readonly exactCandidateIndex: 4;
      readonly containsCandidateIndex: 4;
      readonly candidateId: "purpose_option.open_api";
      readonly labelForCount: 1;
      readonly ancestorLabelCount: 0;
      readonly ariaLabelledbyRefCount: 0;
      readonly groupIndex: 0;
    },
    {
      readonly index: 1;
      readonly nameSource: "LABEL_FOR";
      readonly nameLengthBucket: "medium";
      readonly exactCandidateIndex: 5;
      readonly containsCandidateIndex: 5;
      readonly candidateId: "purpose_option.playauto_web_solution";
      readonly labelForCount: 1;
      readonly ancestorLabelCount: 0;
      readonly ariaLabelledbyRefCount: 0;
      readonly groupIndex: 0;
    },
  ];
  readonly candidatesCompared: 6;
  readonly nameGroupCount: 1;
  readonly largestNameGroupSize: 2;
  readonly ungroupedCount: 0;
  /**
   * **MEASURED: the purpose semantics are now established** — for the two option LABELS, and nothing further.
   *
   * What is settled: radio 0's accessible name is the `OPEN API` candidate's text, radio 1's is the other, and
   * both derive from a single `label[for]`. What is NOT settled by that, and is not a measurement at all: which
   * option SellerOps should use. That is a product decision; the product owner has since made it (`OPEN API`),
   * and a decision is not evidence. Nothing in this module selects, ranks or defaults to either.
   */
  readonly purposeOptionSemanticsMeasured: true;
  readonly purposeOptionChoiceMade: "PRODUCT_OWNER_DECISION_NOT_MEASURED";
  /**
   * **MEASURED: the 08-09 heading report was wrong by exactly two affixes, and the verbatim one resolves.**
   *
   * The report `이제 키의 사용 목적을 골라주세요.` stays `ABSENT_EVERYWHERE` — all four containment integers
   * zero — while the verbatim `키의 사용 목적을 골라주세요` matches one painting element and no hidden ones.
   * This is the whole reason the report was kept rather than replaced.
   */
  readonly headingHypothesis: {
    readonly reportedVerdict: "ABSENT_EVERYWHERE";
    readonly verbatimVerdict: "PRESENT_VISIBLE";
    readonly verbatimMatchCount: 1;
    readonly verbatimHiddenMatchCount: 0;
    readonly verbatimSig16: "f86a70f0cef03140";
    readonly signatureRole: "EVIDENCE_ONLY";
  };
  /**
   * **MEASURED: every containment quad from 2026-08-09 reproduced, integer for integer.**
   *
   * Eight candidates, four integers each, on a different commit and a different run. Recorded as a count rather
   * than a re-listing — the quads live on {@link WING_STAGE2_LABEL_CALIBRATION_EVIDENCE} and copying them here
   * would create a second place for one fact to drift. `0` disagreements is the claim; the test checks it
   * against that record rather than against a transcription of it.
   */
  readonly quadsReproducedFromPreviousRun: 8;
  readonly quadDisagreements: 0;
  readonly structureReproduced: {
    readonly visibleChoiceControlCount: 2;
    readonly hiddenChoiceControlCount: 10;
    readonly groupContainerCount: 0;
    readonly openApiMarkerPresent: false;
    readonly credentialAnchorPresent: true;
  };
  /**
   * **`확인`'s signature now agrees across THREE runs on three commits** — `277220f7`, `ce733f78`, `f9189d89`.
   *
   * Unlike the pair the previous record compared, these are three separate grants and three separate captures,
   * so the agreement is between independent readings. It still promotes nothing: a stable signature says the
   * element's structure did not change between three observations, not that the locator is correct, and
   * `확인`'s role remains the product owner's description. `EVIDENCE_ONLY` stands.
   */
  readonly confirmSig16: "c1b87128024cdec8";
  readonly confirmAgreeingRuns: 3;
  readonly confirmSignatureRole: "EVIDENCE_ONLY";
  readonly confirmIsFinalIssuanceControl: "OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED";
  readonly candidatesMeasured: 9;
  readonly candidatesNotMeasured: 0;
  readonly probeFaults: 0;
  readonly containmentFaults: 0;
  readonly associationFault: null;
  readonly choiceControlFault: null;
  readonly operatorSelectedPurpose: false;
  readonly operatorPressedConfirm: false;
  readonly agentSelections: 0;
  readonly keyCreationRuledOut: false;
  readonly refines: WingStage2LabelCalibrationEvidence;
}

export const WING_STAGE2_OPTION_IDENTIFICATION_EVIDENCE: WingStage2OptionIdentificationEvidence = Object.freeze({
  observedOn: "2026-08-10",
  gitSha: "f9189d89",
  runId: "wt-7ecf33125088",
  approvalId: "apr-5ad6d4a1216b",
  recordId: "wingrec_fd5caf3ca4ae",
  precondition: "OK",
  rows: Object.freeze([
    Object.freeze({
      index: 0, nameSource: "LABEL_FOR", nameLengthBucket: "short",
      exactCandidateIndex: 4, containsCandidateIndex: 4, candidateId: "purpose_option.open_api",
      labelForCount: 1, ancestorLabelCount: 0, ariaLabelledbyRefCount: 0, groupIndex: 0,
    }),
    Object.freeze({
      index: 1, nameSource: "LABEL_FOR", nameLengthBucket: "medium",
      exactCandidateIndex: 5, containsCandidateIndex: 5, candidateId: "purpose_option.playauto_web_solution",
      labelForCount: 1, ancestorLabelCount: 0, ariaLabelledbyRefCount: 0, groupIndex: 0,
    }),
  ]) as WingStage2OptionIdentificationEvidence["rows"],
  candidatesCompared: 6,
  nameGroupCount: 1,
  largestNameGroupSize: 2,
  ungroupedCount: 0,
  purposeOptionSemanticsMeasured: true,
  purposeOptionChoiceMade: "PRODUCT_OWNER_DECISION_NOT_MEASURED",
  headingHypothesis: Object.freeze({
    reportedVerdict: "ABSENT_EVERYWHERE",
    verbatimVerdict: "PRESENT_VISIBLE",
    verbatimMatchCount: 1,
    verbatimHiddenMatchCount: 0,
    verbatimSig16: "f86a70f0cef03140",
    signatureRole: "EVIDENCE_ONLY",
  }) as WingStage2OptionIdentificationEvidence["headingHypothesis"],
  quadsReproducedFromPreviousRun: 8,
  quadDisagreements: 0,
  structureReproduced: Object.freeze({
    visibleChoiceControlCount: 2,
    hiddenChoiceControlCount: 10,
    groupContainerCount: 0,
    openApiMarkerPresent: false,
    credentialAnchorPresent: true,
  }) as WingStage2OptionIdentificationEvidence["structureReproduced"],
  confirmSig16: "c1b87128024cdec8",
  confirmAgreeingRuns: 3,
  confirmSignatureRole: "EVIDENCE_ONLY",
  confirmIsFinalIssuanceControl: "OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED",
  candidatesMeasured: 9,
  candidatesNotMeasured: 0,
  probeFaults: 0,
  containmentFaults: 0,
  associationFault: null,
  choiceControlFault: null,
  operatorSelectedPurpose: false,
  operatorPressedConfirm: false,
  agentSelections: 0,
  keyCreationRuledOut: false,
  refines: WING_STAGE2_LABEL_CALIBRATION_EVIDENCE,
});

/* ────────────────────── ISSUANCE-FLOW DISCOVERY: checkpoints, and the 확인 gate ────────────────────── */

/**
 * **The ordered points in the issuance flow at which a read-only reading is taken.**
 *
 * Every earlier Stage-2 phase took ONE reading of ONE screen the operator had already reached. Discovery takes
 * several, because the evidence it is after is not any single screen but the DIFFERENCE between them: the
 * vendor-form labels already match hidden nodes on the purpose screen, so "did selecting an option reveal
 * them" is answerable by comparing two readings of the same candidates.
 *
 * The names say WHO acted. The operator selects and confirms; the agent's selection budget stays 0, and no
 * checkpoint is reachable without the operator signalling again.
 */
export const WING_FLOW_CHECKPOINTS = [
  "PURPOSE_SCREEN_UNTOUCHED",
  "PURPOSE_OPTION_SELECTED_BY_OPERATOR",
  "AFTER_OPERATOR_CONFIRM",
  "TERMS_CHECKED_BY_OPERATOR",
] as const;

/**
 * **The two checkpoints PAST the terms screen** — the vendor-method screen, and it selected.
 *
 * They are a separate list, not four more entries above, because {@link WING_FLOW_CHECKPOINTS} is the plan of a
 * phase whose approved manifest says the run stops at the terms screen. Appending to it would silently widen
 * every grant already described in those terms. What binds these two to a manifest is
 * {@link WING_VENDOR_METHOD_PLAN}, which is its own plan, reachable only from its own phase.
 */
export const WING_VENDOR_METHOD_CHECKPOINTS = [
  "VENDOR_METHOD_SCREEN_UNTOUCHED",
  "VENDOR_METHOD_SELECTED_BY_OPERATOR",
] as const;

export type WingFlowCheckpoint =
  | (typeof WING_FLOW_CHECKPOINTS)[number]
  | (typeof WING_VENDOR_METHOD_CHECKPOINTS)[number];

/**
 * **The list ends at the terms screen, and that is a safety property, not a coincidence.**
 *
 * `TERMS_CHECKED_BY_OPERATOR` is last because the only thing left to do on that screen is press
 * `약관 동의 및 Key 발급받기` — {@link WING_KEY_CREATION_CONTROL_ID}. That press does NOT create the key
 * ({@link WING_KEY_CREATION_CONTROL_REFUTATION}), and the list ending here is if anything MORE load-bearing for
 * it: what the press opens is an integration-method screen nothing has read, and the key is issued somewhere
 * past it. There is no checkpoint after this one and there must not be — discovery cannot reach key issuance by
 * adding one more step, and it now cannot reach it by adding two either. Issuance is a separate phase, with its
 * own manifest and its own single-use grant.
 *
 * Stated as a checked constant rather than a comment, because "the list happens to stop here" and "the list
 * stops here on purpose" look identical in a diff.
 *
 * **2026-08-12: "issuance is a separate phase" is now literal rather than aspirational** — that phase exists, and
 * it is {@link WING_VENDOR_METHOD_PLAN}. Nothing above is relaxed by its existence: this plan still ends here, and
 * a run under it still cannot reach the vendor screen by adding a checkpoint. What changed is that the sentence
 * naming the escape hatch now names something real, which is the only honest way to keep writing it.
 */
export const WING_FLOW_LAST_CHECKPOINT = "TERMS_CHECKED_BY_OPERATOR" as const;

/**
 * **The control that ISSUES THE KEY, named once.** The vendor-method screen's `확인`.
 *
 * Deliberately not a candidate id. Naming a candidate would say a locator for it exists and has been measured;
 * nothing has read this screen. What is established is weaker and worth stating exactly: the operator pressed
 * `약관 동의 및 Key 발급받기`, no key was issued, this screen appeared, and the operator reports its `확인` is
 * where the key comes from ({@link WING_KEY_CREATION_CONTROL_REFUTATION}). That is an operator report about an
 * unmeasured screen — the same standing the refuted claim had, held to the same bar.
 */
export const WING_KEY_ISSUING_CONTROL = "THE_VENDOR_METHOD_SCREENS_CONFIRM_OPERATOR_REPORTED_NOT_MEASURED" as const;

/**
 * **A discovery PLAN: which checkpoints a phase runs, and what it is stopping short of.**
 *
 * Two plans exist, and the pair is the point. The reason a plan ends used to live in one constant and one comment
 * — which was survivable while there was one plan, and stops being survivable the moment a second one ends
 * somewhere else for a different reason. A loop that enforced `WING_FLOW_LAST_CHECKPOINT` for every caller would
 * either refuse the vendor plan outright or have to be told to make an exception, and "make an exception to the
 * hard stop" is not a shape this file should be able to express.
 *
 * So the stop travels WITH the plan: each one carries its own last checkpoint and its own account of what the
 * operator would be being asked to press if it ran one longer.
 */
export const WING_FLOW_PLAN_IDS = ["ISSUANCE_FLOW", "VENDOR_METHOD"] as const;
export type WingFlowPlanId = (typeof WING_FLOW_PLAN_IDS)[number];

export interface WingFlowPlan {
  readonly id: WingFlowPlanId;
  readonly checkpoints: readonly WingFlowCheckpoint[];
  readonly lastCheckpoint: WingFlowCheckpoint;
  /** What the operator's NEXT act would be. The plan's reason for ending, in the plan. */
  readonly nextControl: string;
  /**
   * Whether that next act mutates marketplace state irreversibly. `false` here does NOT mean "safe to add a
   * checkpoint" — both plans end, and the flag says what kind of boundary each end is.
   */
  readonly nextControlIsIrreversible: boolean;
}

export const WING_ISSUANCE_FLOW_PLAN: WingFlowPlan = Object.freeze({
  id: "ISSUANCE_FLOW" as const,
  checkpoints: WING_FLOW_CHECKPOINTS,
  lastCheckpoint: WING_FLOW_LAST_CHECKPOINT,
  nextControl: WING_KEY_CREATION_CONTROL_ID,
  // Reversible on the OPERATOR's report, twice, and NOT on a measurement: the apparatus cannot discriminate an
  // issued surface from a no-key one ({@link WING_KEY_ABSENCE_ATTRIBUTION}). That report is why a second plan
  // may continue past this control at all — a fact about this control, on this evidence, and never a licence
  // for the next one.
  nextControlIsIrreversible: false,
});

/**
 * **The VENDOR-METHOD plan.** The whole issuance flow, plus the screen past `약관 동의 및 Key 발급받기`, and it
 * stops with the seller looking at a `확인` that issues a real API key.
 *
 * It runs the earlier checkpoints rather than starting at the vendor screen because a plan may only be a PREFIX
 * of a flow: each checkpoint describes a screen the ones before it reach, and there is no way to be standing on
 * this screen without having advanced through them. The cost is a longer sitting; the alternative is a first
 * reading whose starting state nobody established.
 *
 * **Where it ends is the boundary this unit exists to respect.** The next press issues a key — irreversibly, on a
 * real marketplace account. No checkpoint may follow, and no phase may reach that press by continuing this plan;
 * it needs its own manifest, its own mode-WRITE grant, and its own explicit single-use approval.
 */
export const WING_VENDOR_METHOD_PLAN: WingFlowPlan = Object.freeze({
  id: "VENDOR_METHOD" as const,
  checkpoints: Object.freeze([...WING_FLOW_CHECKPOINTS, ...WING_VENDOR_METHOD_CHECKPOINTS]),
  lastCheckpoint: "VENDOR_METHOD_SELECTED_BY_OPERATOR" as const,
  nextControl: WING_KEY_ISSUING_CONTROL,
  nextControlIsIrreversible: true,
});

export const WING_FLOW_PLANS: Readonly<Record<WingFlowPlanId, WingFlowPlan>> = Object.freeze({
  ISSUANCE_FLOW: WING_ISSUANCE_FLOW_PLAN,
  VENDOR_METHOD: WING_VENDOR_METHOD_PLAN,
});

/**
 * **The candidates whose visibility decides what `확인` IS.**
 *
 * The product owner's account of the flow puts 확인 *after* 업체명 · URL · IP 주소 are filled in, which would
 * make it a submission. Every measurement puts those three labels in NON-painting nodes on the purpose screen
 * — consistent with a form that exists in the DOM and is not yet shown, which is exactly what it turned out to
 * be: the vendor form is real and sits PAST the terms screen (2026-08-12, operator-reported). The account was
 * right about the form and wrong only about where it sits, so this gate is still the right question to ask on
 * the purpose screen and its answer there is still "not yet shown".
 *
 * So the question is decidable by reading, and it is the one question that must be decided before anyone
 * presses anything: if the vendor form is ALREADY on screen when the operator has selected an option, then
 * 확인 submits it, and pressing it may issue a key.
 */
export const WING_VENDOR_FORM_CANDIDATE_IDS = [
  "stage2.vendor_info.baseline",
  "stage2.vendor_url.url",
  "stage2.call_ip.ip_addr",
] as const;

/**
 * **WHICH SCREEN a reading is of.** Answered before anything is decided about what to press on it.
 *
 * The 2026-08-10 discovery run is why this exists. Its gate asked only "are the vendor fields visible?", and
 * those fields are hidden on EVERY screen in this flow — so it answered "advance" while the operator was
 * already looking at the terms screen, and the run printed "press 확인" for a screen whose visible control was
 * `약관 동의 및 Key 발급받기`. Nothing was pressed, because 확인 was no longer there to press. That is luck.
 *
 * A guard that reasons about what is on a screen without first establishing WHICH screen is this workstream's
 * recurring defect, and this is its ninth instance.
 */
export const WING_FLOW_SCREENS = ["PURPOSE", "TERMS", "VENDOR_METHOD", "UNRECOGNIZED", "NOT_MEASURED"] as const;
export type WingFlowScreen = (typeof WING_FLOW_SCREENS)[number];

/** The candidate whose visibility identifies the purpose screen. */
export const WING_PURPOSE_SCREEN_MARKER_ID = "stage2.purpose.operator_verbatim" as const;
/** The candidates whose visibility identifies the TERMS screen. Either one is sufficient. */
export const WING_TERMS_SCREEN_MARKER_IDS = ["stage3.terms.heading", WING_KEY_CREATION_CONTROL_ID] as const;
/**
 * **The candidates whose visibility identifies the VENDOR-METHOD screen. Either one is sufficient.**
 *
 * **These are MEASURED, and the first attempt was not.** The marker shipped on 2026-08-12 was a single
 * transcribed string, `업체 입력 방식`, chosen because a marker that paints on an EARLIER screen would make every
 * reading of the whole flow report `VENDOR_METHOD` — this screen sorts first — and one hypothesis seemed a
 * smaller bet than two. It never matched anything: on `wingrec_c7d61cd70f63` — the six-checkpoint run whose
 * every sentinel the operator created directly — it read `PRESENT_NOT_WHOLE_TEXT` on all SIX readings,
 * **including both of the vendor screen's own**, and the earlier `wingrec_d5dc00c2486c` agrees. The phrase is in the DOM
 * and is not any element's whole text, anywhere. The run halted at the last checkpoint and kept the vendor
 * sweep, which is what that halt was designed to cost.
 *
 * The two below come from that sweep, and they are the opposite kind of thing: hidden on all four earlier
 * readings, `visible: 1` with a measured `LABEL` tag on the vendor screen. Two rather than one now, because the
 * argument for one was about UNMEASURED hypotheses — an unmeasured marker's false-positive risk is unbounded,
 * and these two have a measured absence on every screen that precedes them. What two buys is the case where a
 * method selection hides one of the options: they are the two arms of the same choice, so a selection that
 * removed both would have removed the screen.
 *
 * `OPEN API 키 발급` stays excluded, and now for a measured reason rather than a suspected one: it paints on
 * EVERY screen in the flow (1, 1, 1, 1, and 2 on the vendor screen). That was the collision the exclusion was
 * guessing at, and the guess was right.
 */
export const WING_VENDOR_METHOD_SCREEN_MARKER_IDS = [
  "stage4.vendor.partner.label",
  "stage4.vendor.self_dev.label",
] as const;

/**
 * Whether {@link WING_VENDOR_METHOD_SCREEN_MARKER_IDS} have been MATCHED by an apparatus. `true` since
 * 2026-08-12 — see {@link WING_VENDOR_METHOD_SCREEN_EVIDENCE} for the reading.
 *
 * Stated as a flag rather than left to prose because the markers gate a screen identity that a checkpoint
 * expectation is enforced against. What an unmatched marker costs, learned by paying it: the vendor screen's own
 * sweep still lands (that checkpoint expects `TERMS`, the screen the seller was on before), and only the
 * checkpoint AFTER it halts. So it loses the second vendor reading and keeps the first — the one carrying the
 * screen's full candidate sweep, and therefore the one the sitting is for.
 */
export const WING_VENDOR_METHOD_SCREEN_MARKER_MEASURED = true as const;

/**
 * **The refuted marker hypothesis, kept.** `업체 입력 방식` was transcribed off the live screen by the operator
 * and matched nothing as whole text on any of five readings.
 *
 * The candidate stays in the sweep and this constant stays beside it, because the absence is the evidence: a
 * later reader looking at `stage4.vendor.method_prompt` needs to know it was tried as the screen's identity and
 * why it failed, or the same short distinctive-looking phrase is available to be chosen again. `PRESENT_NOT_
 * WHOLE_TEXT` on the screen it was transcribed from is the specific shape — the phrase is on the page and split
 * across nodes, which whole-text matching cannot see and a human reading the screen cannot tell.
 */
export const WING_VENDOR_METHOD_PROMPT_MARKER_REFUTED = "PRESENT_NOT_WHOLE_TEXT_ON_ITS_OWN_SCREEN_2026_08_12" as const;

/**
 * **The first reading of the vendor-method screen, and the whole of what is established about it.**
 *
 * Taken 2026-08-12 under the granted `COUPANG_WING_VENDOR_METHOD_DISCOVERY` sitting `apr-b65060f5857e` /
 * `wt-48fb1454662d` at git `0dfb6929` (sanitized record `wingrec_d5dc00c2486c`). Five checkpoints, screens
 * `PURPOSE → PURPOSE → TERMS → TERMS → (the vendor screen)`, zero probe faults, zero agent selections.
 *
 * **`checkpointsAgreeing: 1` on every vendor row, and nothing here is promoted.** The bar is a reading
 * reproduced on two checkpoints of the same screen; the sixth checkpoint halted on the refuted marker, so this
 * screen was read once. The rows are recorded as evidence for a promotion a SECOND sitting can make — the
 * temptation to read four clean `visible: 1` rows as sufficient is exactly what the bar is for.
 *
 * **Two instruments agreed, from opposite directions.** The fixed-label locate walks IN from a query to whatever
 * carries the text; the association census walks OUT from each control to whatever names it. They met: the two
 * visible radios are one group, both named by `label[for]`, and their derived names are the same two strings the
 * locate resolved (`vendor_method_option.partner` at index 8, `vendor_method_option.self_dev` at 9). That is a
 * stronger pairing than either instrument alone, and it is still one checkpoint.
 */
export interface WingVendorMethodScreenEvidence {
  readonly measuredOn: string;
  readonly gitSha: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly recordId: string;
  /** How many checkpoints of this run read the vendor screen. `1` is why nothing below is promoted. */
  readonly vendorCheckpointsRead: number;
  readonly readings: readonly WingGuidedHighlightReading[];
  /**
   * The two visible radios, as the association census saw them. Indices into {@link WING_CHOICE_LABEL_CANDIDATES}
   * — never wording, which is the whole point of storing an index.
   */
  readonly choiceAssociation: {
    readonly visibleChoiceControlCount: number;
    readonly nameGroupCount: number;
    readonly rows: readonly { readonly index: number; readonly nameSource: string; readonly exactCandidateIndex: number }[];
  };
  /** What is NOT established, stated rather than left to the absence of a field. */
  readonly notEstablished: readonly string[];
}

export const WING_VENDOR_METHOD_SCREEN_EVIDENCE: WingVendorMethodScreenEvidence = Object.freeze({
  measuredOn: "2026-08-12",
  gitSha: "7049af08",
  runId: "wt-203deafd017f",
  approvalId: "apr-5f58409446fd",
  recordId: "wingrec_c7d61cd70f63",
  // BOTH vendor checkpoints — the screen untouched, and the screen with a method selected. Six checkpoints, no
  // halt. The sitting before this one (`wingrec_d5dc00c2486c`, `apr-b65060f5857e`) read this screen ONCE and is
  // deliberately not folded in: its marker was refuted, so its sixth checkpoint never ran.
  vendorCheckpointsRead: 2,
  readings: Object.freeze([
    Object.freeze({
      candidateId: "stage4.vendor.partner.label",
      screen: "VENDOR_METHOD" as const,
      visibleCount: 1,
      hiddenCount: 1,
      observedTag: "LABEL",
      checkpointsAgreeing: 2,
    }),
    // The broad sibling: TWO painting elements carry the string. The narrowing is doing work here, exactly as it
    // was for the purpose option — and unlike `확인`, where the broad query found the same element.
    Object.freeze({
      candidateId: "stage4.vendor.partner.broad",
      screen: "VENDOR_METHOD" as const,
      visibleCount: 2,
      hiddenCount: 2,
      checkpointsAgreeing: 2,
    }),
    Object.freeze({
      candidateId: "stage4.vendor.self_dev.label",
      screen: "VENDOR_METHOD" as const,
      visibleCount: 1,
      hiddenCount: 1,
      observedTag: "LABEL",
      checkpointsAgreeing: 2,
    }),
    Object.freeze({
      candidateId: "stage4.vendor.self_dev.broad",
      screen: "VENDOR_METHOD" as const,
      visibleCount: 2,
      hiddenCount: 2,
      checkpointsAgreeing: 2,
    }),
    // 업체명 — hidden on every screen of every earlier run, and the reason `wingConfirmAdvisory` reads it. It
    // paints here, which is the first time any apparatus has seen the vendor form.
    Object.freeze({
      candidateId: "stage2.vendor_info.baseline",
      screen: "VENDOR_METHOD" as const,
      visibleCount: 1,
      hiddenCount: 3,
      observedTag: "DT",
      checkpointsAgreeing: 2,
    }),
    // The screen's own 확인 — the control that ISSUES THE KEY. Measured to be locatable; never pressed by any
    // phase. Its spec is the SAME candidate the purpose screen's 확인 uses, which is exactly why a reading
    // carries the screen it was taken on: on TERMS this same candidate reads hidden.
    Object.freeze({
      candidateId: "stage2.confirm.actionable",
      screen: "VENDOR_METHOD" as const,
      visibleCount: 1,
      hiddenCount: 12,
      observedTag: "BUTTON",
      checkpointsAgreeing: 2,
    }),
  ]),
  choiceAssociation: Object.freeze({
    visibleChoiceControlCount: 2,
    nameGroupCount: 1,
    rows: Object.freeze([
      Object.freeze({ index: 0, nameSource: "LABEL_FOR", exactCandidateIndex: 8 }),
      Object.freeze({ index: 1, nameSource: "LABEL_FOR", exactCandidateIndex: 9 }),
    ]),
  }),
  notEstablished: Object.freeze([
    // Each of these is a sentence someone could otherwise read INTO the rows above.
    "WHAT_THE_VENDOR_SCREENS_CONFIRM_DOES_NEVER_PRESSED",
    "WHICH_OF_THE_TWO_METHODS_THE_OPERATOR_SELECTED",
    "WHETHER_URL_AND_IP_APPEAR_UNDER_BOTH_METHODS",
  ]),
});

/**
 * **The last piece of the product owner's original flow description, measured.**
 *
 * That description ran `발급 → 연동 방식 선택 → 자체개발(직접입력) → 업체명 · URL · IP 주소 → 확인`. It was judged
 * "wrong about the ordering" on 2026-08-10, corrected to "right about the form, wrong about where it sits" on
 * 2026-08-12 — and the three fields were still the part nothing had ever seen. `URL` and `IP 주소` read hidden on
 * every screen of every run for three days.
 *
 * On the sixth checkpoint, after a method was selected, both painted for the first time (`visible: 1`, tag `DT`,
 * beside the already-visible `업체명`). The account was right end to end.
 *
 * **ONE checkpoint, and it is not enough to promote either.** The reveal is the finding; the locators are not.
 * `stage2.vendor_info.baseline` was visible on BOTH vendor checkpoints and clears the bar; `URL` and `IP 주소`
 * appeared only on the second and do not, which is why they are recorded here rather than in the readings above.
 * Nor is it established that the reveal belongs to the method that was chosen — only one method was ever
 * selected, and which one is not measured.
 */
export const WING_VENDOR_FORM_REVEAL = Object.freeze({
  revealedOn: "2026-08-12",
  recordId: "wingrec_c7d61cd70f63",
  atCheckpoint: "VENDOR_METHOD_SELECTED_BY_OPERATOR" as const,
  candidateIds: Object.freeze(["stage2.vendor_url.url", "stage2.call_ip.ip_addr"]),
  checkpointsAgreeing: 1,
  promotable: false,
});

/**
 * **WHICH input method a SellerOps seller picks — a PRODUCT DECISION, recorded as one.**
 *
 * Decided by the product owner on 2026-08-12, with the measurement in front of them and explicitly separated
 * from it. Nothing in the sweep recommends a method and nothing could: the screen offers two radios in one group
 * and both resolve identically well.
 *
 * What the measurement DOES say, and the whole of it: selecting a method revealed `URL` and `IP 주소`. TWO
 * fields, not three — `업체명` was ALREADY painting on the untouched vendor screen, and "selecting revealed
 * 업체명 · URL · IP 주소" reads the reveal one field wider than it was. The three together are what the product
 * owner's flow description attaches to the 자체개발 path, so this corroborates the description; it does not
 * derive the decision, and the run never recorded which radio was selected.
 *
 * What is NOT established and would have to be, for the other option: whether SellerOps appears in Coupang's
 * 연동업체 list. No apparatus has read that dropdown, and it is an external fact rather than a measurable one.
 */
export const WING_VENDOR_METHOD_PRODUCT_DECISION = Object.freeze({
  decidedOn: "2026-08-12",
  decidedBy: "PRODUCT_OWNER" as const,
  basis: "PRODUCT_DECISION_NOT_A_MEASUREMENT" as const,
  method: "자체개발(직접입력)",
  /** The candidate the walk rings for it. Resolves through {@link wingCandidateSpecById}; never re-typed. */
  candidateId: "stage4.vendor.self_dev.label",
  /** The option the walk does NOT ring. Measured to the same standard; not chosen. */
  notChosenCandidateId: "stage4.vendor.partner.label",
  unmeasuredForTheAlternative: "WHETHER_SELLEROPS_IS_IN_COUPANGS_VENDOR_LIST",
});

export interface WingScreenReading {
  readonly precondition: WingStage2Precondition;
  readonly faultCount: number;
  readonly candidates: readonly { readonly id: string; readonly presence: WingStage2Presence }[];
}

/**
 * Identify the screen from its markers. **The LATEST screen wins** when several families read visible:
 * `VENDOR_METHOD` over `TERMS` over `PURPOSE`.
 *
 * That precedence is not arbitrary, and the rule behind it has not changed — a reading that could be several
 * screens resolves to the one where stopping is correct. It used to be the terms screen because that is where the
 * control believed to create the key sat. It does not create the key; the vendor screen's own `확인` does. So the
 * ordering follows the same rule to its new answer rather than being re-derived, and the vendor screen sorts
 * first because it is both the latest and the only one carrying an irreversible control.
 *
 * **The reason it was ordered this way turned out to be wrong, and the ordering is kept anyway.** It was written
 * expecting the vendor screen to be a DIALOG over the terms screen, with the terms markers still painting behind
 * it — so a precedence answering `TERMS` would have put the walk one screen behind the seller. Measured
 * 2026-08-12: the vendor screen REPLACES the terms screen, and both terms markers go back to hidden on it. So no
 * reading has ever been ambiguous between the two, and this ordering has never yet decided anything.
 *
 * It stays because the rule it follows is the one that has been right every time: resolve to the screen where
 * stopping is correct. What changed is that this is now a precaution rather than a fix for an observed overlap —
 * and a precaution whose stated reason has been falsified is worth relabelling rather than quietly keeping.
 *
 * `UNRECOGNIZED` when no marker paints — a screen we have never measured is not a screen to act on.
 */
export function wingFlowScreenFrom(reading: WingScreenReading): WingFlowScreen {
  if (reading.precondition !== "OK" || reading.faultCount > 0) return "NOT_MEASURED";
  const byId = new Map(reading.candidates.map((c) => [c.id, c.presence]));
  const seen = (id: string): WingStage2Presence | undefined => byId.get(id);
  const markers = [WING_PURPOSE_SCREEN_MARKER_ID, ...WING_TERMS_SCREEN_MARKER_IDS, ...WING_VENDOR_METHOD_SCREEN_MARKER_IDS];
  // Every marker must have been PROBED. A missing row cannot distinguish "not on this screen" from "not asked
  // about", and screen identity is the one question that must not be answered from an absence of data.
  for (const id of markers) {
    const p = seen(id);
    if (p === undefined || p === "NOT_MEASURED") return "NOT_MEASURED";
  }
  if (WING_VENDOR_METHOD_SCREEN_MARKER_IDS.some((id) => seen(id) === "PRESENT_VISIBLE")) return "VENDOR_METHOD";
  if (WING_TERMS_SCREEN_MARKER_IDS.some((id) => seen(id) === "PRESENT_VISIBLE")) return "TERMS";
  if (seen(WING_PURPOSE_SCREEN_MARKER_ID) === "PRESENT_VISIBLE") return "PURPOSE";
  return "UNRECOGNIZED";
}

/**
 * Whether the run may INVITE the operator to press 확인. Closed, and fail-closed: four of the five values stop.
 *
 * **Screen identity first.** The vendor-field question is only meaningful on the purpose screen; asked anywhere
 * else it returns a confident answer about an irrelevant fact. So the order is: is this measured, is this the
 * purpose screen, and only then — is 확인 a step or a submission.
 */
export const WING_CONFIRM_ADVISORIES = [
  "ADVANCE_FORM_NOT_YET_REVEALED",
  "STOP_FORM_ALREADY_VISIBLE",
  "STOP_ALREADY_PAST_THE_PURPOSE_SCREEN",
  "STOP_SCREEN_UNRECOGNIZED",
  "STOP_NOT_MEASURED",
] as const;
export type WingConfirmAdvisory = (typeof WING_CONFIRM_ADVISORIES)[number];

export function wingConfirmAdvisory(reading: WingScreenReading): WingConfirmAdvisory {
  const screen = wingFlowScreenFrom(reading);
  if (screen === "NOT_MEASURED") return "STOP_NOT_MEASURED";
  // The terms screen is PAST the point 확인 belongs to, and it is where the key-creating control lives. Being
  // here at all means the flow moved without us; continuing would issue an instruction for a screen that is
  // not on the glass.
  // Both of the screens PAST this one. The vendor screen would also have stopped on the vendor-form check below
  // (업체명 paints there, which is the whole point of that screen) — but it would have stopped saying "the form is
  // already visible on the purpose screen", which is a true sentence about the wrong screen. Naming the screen we
  // are actually on is the difference between a gate that holds and a gate that holds by luck.
  if (screen === "TERMS" || screen === "VENDOR_METHOD") return "STOP_ALREADY_PAST_THE_PURPOSE_SCREEN";
  if (screen === "UNRECOGNIZED") return "STOP_SCREEN_UNRECOGNIZED";
  const byId = new Map(reading.candidates.map((c) => [c.id, c.presence]));
  for (const id of WING_VENDOR_FORM_CANDIDATE_IDS) {
    const presence = byId.get(id);
    // Absent from the reading is NOT "absent from the page". A candidate that was never probed tells us
    // nothing about whether its field is on screen, and nothing is exactly what we must not act on.
    if (presence === undefined || presence === "NOT_MEASURED") return "STOP_NOT_MEASURED";
    if (presence === "PRESENT_VISIBLE") return "STOP_FORM_ALREADY_VISIBLE";
  }
  return "ADVANCE_FORM_NOT_YET_REVEALED";
}

/**
 * **Which screen each checkpoint expects to be looking at when it is ANNOUNCED.**
 *
 * The generalisation of the gate. A checkpoint's instruction describes an action on a specific screen, so
 * printing it while the browser is somewhere else tells the operator to do something they cannot do — and in
 * the one case that matters, to press a control that is not there while a key-creating one is.
 *
 * The FIRST checkpoint has no expectation: nothing has been read yet, and the operator is still navigating.
 */
export const WING_CHECKPOINT_EXPECTED_SCREEN: Readonly<Record<WingFlowCheckpoint, WingFlowScreen | null>> =
  Object.freeze({
    PURPOSE_SCREEN_UNTOUCHED: null,
    PURPOSE_OPTION_SELECTED_BY_OPERATOR: "PURPOSE",
    AFTER_OPERATOR_CONFIRM: "PURPOSE",
    TERMS_CHECKED_BY_OPERATOR: "TERMS",
    // The expectation is checked against the PREVIOUS reading — the screen the seller was on when they were given
    // this checkpoint's instruction. So the checkpoint that ASKS them to press `약관 동의 및 Key 발급받기` expects
    // TERMS, and only the one after it expects the screen that press opens. That asymmetry is what keeps an
    // unmatched vendor marker from costing the vendor screen's own sweep: the sweep happens first, and the
    // expectation that depends on the marker is evaluated one checkpoint later.
    VENDOR_METHOD_SCREEN_UNTOUCHED: "TERMS",
    VENDOR_METHOD_SELECTED_BY_OPERATOR: "VENDOR_METHOD",
  });

/**
 * **The terms checkboxes have NO accessible name, so nothing about them may be promoted.**
 *
 * MEASURED 2026-08-10 on the live terms screen: both visible checkboxes read `nameSource: NONE`,
 * `labelForCount: 0`, `ancestorLabelCount: 0`, `ariaLabelledbyRefCount: 0`, and no shared `name` group. The two
 * consent sentences ARE on the page and painting — but they are not associated with the inputs by any
 * mechanism the accname subset can follow, and neither sentence is unique (2 painting matches each).
 *
 * So a checkbox cannot be tied to its own consent text by association, and a consent sentence cannot be tied to
 * a checkbox by uniqueness. Guessing the pairing from DOM order would be inventing the one fact that matters:
 * WHICH box the seller is ticking. Until a reading establishes the relationship structurally, no locator, no
 * tutorial step, and no ordering may depend on it.
 */
export const WING_TERMS_CHECKBOX_PROMOTION_BLOCKED = "NO_ACCESSIBLE_ASSOCIATION_MEASURED_2026_08_10" as const;

/** Env var carrying the per-run checkpoint PLAN. Its own name; a scope must never shorten a flow. */
export const WING_FLOW_CHECKPOINTS_ENV = "SELLEROPS_WING_FLOW_CHECKPOINTS" as const;

/**
 * Resolve a per-run checkpoint PLAN, fail-closed. Absent/empty ⇒ the whole of {@code plan}.
 *
 * A request may only be a PREFIX of the plan's own checkpoints. Not a subset, not a reordering: each checkpoint
 * describes a screen reached by the ones before it, so "start at the terms screen" is not a shorter run, it is
 * a different one whose first reading nobody has established. A prefix ends the flow early, which is the only
 * narrowing that stays true to what the operator is asked to do.
 *
 * **The plan is a PARAMETER, not a default.** A caller resolving vendor checkpoints against the issuance flow's
 * list would silently reject them as unrecognized, and a caller resolving issuance checkpoints against the vendor
 * list would ACCEPT a prefix that runs two checkpoints further than its manifest describes. The second is the
 * dangerous direction, and neither is reachable when the plan has to be named.
 */
export function resolveWingFlowCheckpoints(
  raw: string | undefined | null,
  plan: WingFlowPlan,
): { ok: true; checkpoints: WingFlowCheckpoint[] } | { ok: false; reason: string } {
  const all = plan.checkpoints;
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, checkpoints: [...all] };
  const requested = trimmed.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  if (requested.length === 0) return { ok: true, checkpoints: [...all] };
  const unknown = requested.filter((t) => !(all as readonly string[]).includes(t));
  // A COUNT, never the tokens: this reason reaches stderr and the env value is whatever was typed.
  if (unknown.length > 0) return { ok: false, reason: `${unknown.length} checkpoint name(s) not in the ${plan.id} plan` };
  const prefix = all.slice(0, requested.length);
  if (requested.join(",") !== prefix.join(",")) {
    return { ok: false, reason: "a checkpoint plan must be a PREFIX of the flow, in order" };
  }
  return { ok: true, checkpoints: [...prefix] };
}

/** Why a discovery run stopped early. `null` means it ran every checkpoint. */
export const WING_FLOW_HALT_REASONS = [
  "OPERATOR_ABORTED",
  "OPERATOR_SIGNAL_TIMEOUT",
  "CONFIRM_ADVISORY_STOP",
  "PRECONDITION_FAILED",
  // The flow is not where the next instruction assumes it is. Halting beats guessing: the 2026-08-10 run
  // printed a purpose-screen instruction against the terms screen, and only the absence of the named control
  // kept that from mattering.
  "SCREEN_NOT_AS_EXPECTED",
] as const;
export type WingFlowHaltReason = (typeof WING_FLOW_HALT_REASONS)[number];

/**
 * Which candidates became VISIBLE between two readings — the reveal, stated as a set rather than left to a
 * reader comparing two tables.
 *
 * "Became visible" is `PRESENT_VISIBLE` now and something else before. A candidate that was already visible is
 * not a reveal, and a candidate missing from either reading is not one either: an unmeasured row cannot
 * contribute to a claim that a form appeared.
 */
export function wingRevealedBetween(
  before: readonly { readonly id: string; readonly presence: WingStage2Presence }[],
  after: readonly { readonly id: string; readonly presence: WingStage2Presence }[],
): string[] {
  const prior = new Map(before.map((c) => [c.id, c.presence]));
  return after
    .filter((c) => {
      const was = prior.get(c.id);
      if (was === undefined || was === "NOT_MEASURED" || c.presence === "NOT_MEASURED") return false;
      return c.presence === "PRESENT_VISIBLE" && was !== "PRESENT_VISIBLE";
    })
    .map((c) => c.id);
}

/* ─────────────────── flow-screen MARKER SPECS (auto-advance observation) ─────────────────── */

/**
 * The marker specs behind {@link wingFlowScreenFrom}, resolved from the recon candidate map by id.
 *
 * Exported so the guided-walk driver can OBSERVE the screen the seller has reached without the strings being
 * written down a second time. A duplicated `exactText` is how the purpose heading's 이제/period drift got
 * measured as absent in the first place; there is exactly one copy of each of these, here.
 *
 * These are hypotheses with different standing, and the difference matters to anything built on them:
 *
 *  - the TERMS markers were transcribed VERBATIM off the real screen on 2026-08-10;
 *  - the PURPOSE marker was transcribed the same day but **has never been matched by any apparatus**
 *    ({@link WING_PURPOSE_SCREEN_MARKER_MEASURED}). Auto-advance built on it must degrade to the seller's own
 *    advance rather than stall — the marker not firing is the EXPECTED case until a live run says otherwise.
 */
export interface WingFlowScreenMarkerSpec {
  readonly id: string;
  readonly candidateQuery: string;
  readonly exactText: string;
}

function markerSpecById(id: string): WingFlowScreenMarkerSpec {
  for (const candidates of Object.values(WING_STAGE2_RECON_CANDIDATES)) {
    for (const c of candidates) {
      if (c.id === id) return Object.freeze({ id: c.id, candidateQuery: c.candidateQuery, exactText: c.exactText });
    }
  }
  // A marker id with no candidate behind it would make the screen observation silently blind, which reads
  // exactly like "the seller has not got there yet" — the one failure this must not produce quietly.
  throw new Error(`coupang-wing-label-recon: no candidate for flow-screen marker ${id}`);
}

/**
 * **Which recon TARGETS a discovery run has to have in scope for the screen to be identifiable at all.**
 *
 * `wingFlowScreenFrom` derives the screen from the SWEEP's own candidate rows, and it requires every marker to
 * have been probed — a missing row cannot distinguish "not on this screen" from "not asked about". That is the
 * right answer, and it arrives one layer downstream of where it can still save anything: a scope that omits a
 * marker's target produces `NOT_MEASURED` for every reading, the checkpoint gate halts on
 * `SCREEN_NOT_AS_EXPECTED` at the second checkpoint, and the operator has already logged in, navigated and
 * pressed a real control by then.
 *
 * So the same fact is available here as a set, before anyone is seated. Derived from the marker ids rather than
 * listed, because a hand-written list is what would drift when a marker moves between targets.
 */
function targetsCarrying(ids: readonly string[]): WingStage2ReconTarget[] {
  const wanted = new Set<string>(ids);
  const out: WingStage2ReconTarget[] = [];
  for (const target of WING_STAGE2_RECON_TARGETS) {
    if (WING_STAGE2_RECON_CANDIDATES[target].some((c) => wanted.has(c.id))) out.push(target);
  }
  return out;
}

export function wingScreenMarkerTargets(): WingStage2ReconTarget[] {
  // The VENDOR marker is required of EVERY discovery scope, including the phase that stops at the terms screen.
  // `wingFlowScreenFrom` needs every marker probed before it will name any screen, so omitting it would return
  // `NOT_MEASURED` for every reading of every run — and the alternative (a per-screen probed-ness rule) would let
  // a run standing on the vendor screen report TERMS because it never asked. A scope that cannot tell the seller
  // has moved on is worse than a scope that is one target wider.
  return targetsCarrying([WING_PURPOSE_SCREEN_MARKER_ID, ...WING_TERMS_SCREEN_MARKER_IDS, ...WING_VENDOR_METHOD_SCREEN_MARKER_IDS]);
}

/**
 * The targets carrying the VENDOR-FORM candidates, which {@link wingConfirmAdvisory} requires for the same
 * reason: a candidate that was never probed cannot say whether its field is on screen, so the advisory answers
 * `STOP_NOT_MEASURED` and the run halts before the 확인 checkpoint.
 */
export function wingConfirmGateTargets(): WingStage2ReconTarget[] {
  return targetsCarrying([...WING_VENDOR_FORM_CANDIDATE_IDS]);
}

/**
 * **Everything a discovery run must have in scope to finish.** The screen markers AND the vendor-form
 * candidates — two separate downstream gates, both of which fail closed on an unprobed row.
 *
 * The second half was learned the expensive way. A scope narrowed to the screen markers plus the four controls
 * being calibrated passed the marker check and then halted at `CONFIRM_ADVISORY_STOP / STOP_NOT_MEASURED` on
 * 2026-08-11, after the operator had logged in, pressed 발급 and confirmed the purpose option — because
 * `wingConfirmAdvisory` reads the vendor-form rows and they were not in the sweep. The guard that had just been
 * added covered the marker gate and not its sibling, which is the shape this workstream keeps repeating: a rule
 * fixed in one place and left standing in the next one along. So the requirement is a UNION derived from both
 * gates, not a list either of them owns.
 */
export function wingDiscoveryRequiredTargets(): WingStage2ReconTarget[] {
  const required = new Set<WingStage2ReconTarget>([...wingScreenMarkerTargets(), ...wingConfirmGateTargets()]);
  return WING_STAGE2_RECON_TARGETS.filter((t) => required.has(t));
}

/** The required targets a requested discovery scope is MISSING. Empty ⇒ the run can reach its last checkpoint. */
export function wingDiscoveryScopeGap(targets: readonly WingStage2ReconTarget[]): WingStage2ReconTarget[] {
  return wingDiscoveryRequiredTargets().filter((t) => !targets.includes(t));
}

/** The PURPOSE screen's marker spec. Visible ⇒ the seller is on the purpose screen. */
export const WING_PURPOSE_SCREEN_MARKER_SPEC: WingFlowScreenMarkerSpec = markerSpecById(WING_PURPOSE_SCREEN_MARKER_ID);

/** The TERMS screen's marker specs. EITHER visible ⇒ the seller is on the terms screen. */
export const WING_TERMS_SCREEN_MARKER_SPECS: readonly WingFlowScreenMarkerSpec[] = Object.freeze(
  WING_TERMS_SCREEN_MARKER_IDS.map(markerSpecById),
);

/**
 * The VENDOR-METHOD screen's marker spec. Visible ⇒ the seller has reached the screen that issues the key.
 *
 * Exported for the guided walk's screen observation, on the same terms as the two above and with one difference
 * that matters: this one has never matched anything ({@link WING_VENDOR_METHOD_SCREEN_MARKER_MEASURED}). Anything
 * auto-advancing on it must degrade to the seller's own advance rather than stall — not firing is the EXPECTED
 * case until a live run says otherwise.
 */
export const WING_VENDOR_METHOD_SCREEN_MARKER_SPECS: readonly WingFlowScreenMarkerSpec[] = Object.freeze(
  WING_VENDOR_METHOD_SCREEN_MARKER_IDS.map(markerSpecById),
);

/**
 * The live readings that flipped the two flags below. Recorded rather than summarized, because "measured" is a
 * claim about a specific observation and the next person has to be able to check which one.
 *
 * Taken on 2026-08-10 during the granted `COUPANG_WING_GUIDED_ISSUANCE_WALK` run (git `30760554`), from the
 * READ-ONLY fixed-label locate the auto-advance already runs — no extra apparatus, no extra sitting.
 */
export interface WingFlowScreenMarkerReading {
  /** The recon candidate id that was read. */
  readonly id: string;
  /** Which measured screen the seller was on when it was read — a reading is only evidence about one screen. */
  readonly screen: WingFlowScreen;
  readonly visibleCount: number;
  readonly hiddenCount: number;
  /** The tag as OBSERVED. Absent when nothing painted — never an expected value. */
  readonly observedTag?: string;
}

export interface WingFlowScreenMarkerEvidence {
  readonly measuredOn: string;
  readonly phase: string;
  readonly readings: readonly WingFlowScreenMarkerReading[];
}

export const WING_FLOW_SCREEN_MARKER_EVIDENCE: WingFlowScreenMarkerEvidence = Object.freeze({
  measuredOn: "2026-08-10",
  phase: "COUPANG_WING_GUIDED_ISSUANCE_WALK",
  readings: Object.freeze([
    // On the PURPOSE screen, repeatedly, across the whole time the seller sat on it.
    Object.freeze({ id: WING_PURPOSE_SCREEN_MARKER_ID, screen: "PURPOSE", visibleCount: 1, hiddenCount: 0, observedTag: "DIV" }),
    // Hidden on PURPOSE, visible the moment the seller reached TERMS — the transition itself, observed.
    Object.freeze({ id: "stage3.terms.heading", screen: "PURPOSE", visibleCount: 0, hiddenCount: 1 }),
    Object.freeze({ id: "stage3.terms.heading", screen: "TERMS", visibleCount: 1, hiddenCount: 0, observedTag: "DIV" }),
    // 2026-08-11, git `7fc18eac`. The reading the short-circuit had been hiding: on TERMS the key-creation
    // control resolves to exactly ONE PAINTING element, and its tag was OBSERVED as BUTTON — not assumed.
    // Read in the same pass as the heading above (both at 07:33:31), which is what confirms the `button,a`
    // narrowing actually separates the control from the heading that carries the identical text.
    Object.freeze({ id: WING_KEY_CREATION_CONTROL_ID, screen: "PURPOSE", visibleCount: 0, hiddenCount: 1 }),
    Object.freeze({ id: WING_KEY_CREATION_CONTROL_ID, screen: "TERMS", visibleCount: 1, hiddenCount: 0, observedTag: "BUTTON" }),
  ]),
});

/**
 * Whether the PURPOSE marker has ever been MATCHED on a real screen. **TRUE** as of 2026-08-10 — see
 * {@link WING_FLOW_SCREEN_MARKER_EVIDENCE}: `visibleCount: 1`, `hiddenCount: 0`, `observedTag: "DIV"`, read
 * repeatedly while the seller was on the purpose screen.
 *
 * It was a hypothesis for a day and a half. The 08-09 transcription (`이제 …골라주세요.`) measured absent
 * everywhere; the 08-10 verbatim re-transcription was a guess at why, and stayed marked as one until an
 * apparatus resolved it. Editing this line from anything other than a recorded reading is the move that
 * produced the refuted 발급 record.
 */
export const WING_PURPOSE_SCREEN_MARKER_MEASURED = true as const;

/**
 * Whether the TERMS markers have been MATCHED on a real screen. **TRUE** as of 2026-08-10 for
 * `stage3.terms.heading`, which is sufficient: `wingFlowScreenFrom` treats EITHER terms marker as identifying
 * the screen, and the heading was read `hiddenCount: 1` on PURPOSE and `visibleCount: 1, observedTag: "DIV"`
 * the moment the seller reached TERMS.
 *
 * This asserts SCREEN IDENTIFICATION only. It says nothing about {@link WING_KEY_CREATION_CONTROL_ID}, which is
 * the other terms marker and is NOT promotable on this evidence — every reading of it came from the purpose
 * screen, where it matches one HIDDEN node. See {@link WING_KEY_CREATION_SELECTOR_CALIBRATED}.
 */
export const WING_TERMS_SCREEN_MARKERS_MEASURED = true as const;

/**
 * Whether the key-creation control has a locator good enough to HIGHLIGHT. **TRUE** as of 2026-08-11.
 *
 * The reading that flipped it is in {@link WING_FLOW_SCREEN_MARKER_EVIDENCE}: on the TERMS screen the
 * `button,a` query resolved to `visibleCount: 1`, `hiddenCount: 0`, `observedTag: "BUTTON"`. Every condition
 * this flag demanded when it was false is met, and each is load-bearing:
 *
 *  - **on TERMS.** The earlier readings were all from PURPOSE, where the same query matches one HIDDEN node.
 *    A hidden unique match is what invalidated the 삭제 record; it is not evidence about the screen the seller
 *    actually presses the control on.
 *  - **unique.** The screen's heading carries character-for-character the same text, which is why the query is
 *    narrowed to actionable elements — and whether that narrowing was enough was the open question, not an
 *    assumption. Both markers were read in the SAME pass and came back distinct (heading `DIV`, control
 *    `BUTTON`), so the narrowing is confirmed rather than argued.
 *  - **observed tag.** `BUTTON` was measured, not expected. A tag that was expected rather than observed is
 *    precisely how the 발급 record went wrong.
 *
 * This asserts SELECTOR readiness only. It is not an authorization and says nothing about the press: the agent
 * highlights this control and never touches it, `keyCreationAutoAdvances` stays false, and pressing it remains
 * the seller's own act behind its own approval. Any edit to the candidate's `candidateQuery` or `exactText`
 * invalidates this flag and requires a fresh reading.
 */
export const WING_KEY_CREATION_SELECTOR_CALIBRATED = true as const;

/* ──────────────── GUIDED-CONTROL HIGHLIGHT calibration (the purpose option, 확인, the two consents) ──────────────── */

/**
 * **The four controls the guided walk NAMES but cannot point at.**
 *
 * Steps 3 and 4 of the walk describe controls in prose — "사용 목적이 'OPEN API'인지 확인하고 … '확인'을 직접
 * 누르세요", "동의 체크박스 2개를 선택하세요" — while the seller looks at a screen with no ring anywhere on it.
 * Every one of these has been MEASURED in some sense already, and not one of them has been measured in the sense
 * a ring requires, which is the distinction this whole constant exists to keep:
 *
 *  - `purpose_open_api` — its accessible NAME is established (`WING_STAGE2_OPTION_IDENTIFICATION_EVIDENCE`).
 *    A name is produced by walking OUT from a control; a ring needs a walk IN from a query. Never done.
 *  - `confirm` — its structural signature agrees across three runs, under a `button,a,span,div` query that is
 *    character-for-character the shape behind the withdrawn 삭제 record. Stability is not identity.
 *  - `consent_api` / `consent_category` — the consent SENTENCES measured **2 painting matches each**, and the
 *    checkboxes measured no accessible association at all ({@link WING_TERMS_CHECKBOX_PROMOTION_BLOCKED}).
 *
 * A separate namespace from {@link WingStage2ReconTarget} deliberately: a recon target is something a sweep may
 * be pointed at, and this is the much smaller set something may be RINGED for. The 삭제 record was withdrawn
 * while its target sat in a hand-written list, and keeping the two vocabularies apart is what stops a
 * measurement scope from reading as a promotion scope.
 */
export const WING_GUIDED_HIGHLIGHT_TARGETS = [
  "purpose_open_api",
  "confirm",
  "consent_api",
  "consent_category",
  // The VENDOR-METHOD screen, added 2026-08-12. `vendor_self_dev` is the option the product owner chose
  // ({@link WING_VENDOR_METHOD_PRODUCT_DECISION}); `vendor_confirm` is the control that ISSUES THE KEY — ringed,
  // never pressed, exactly as the walk has always treated the control it rests on.
  //
  // `연동업체 선택` is deliberately ABSENT. It was measured to the same standard as its sibling and clears the
  // same bar; it is not here because the walk names ONE method, and that is a product decision rather than a
  // missing measurement. Recording it as an unpromoted entry would say the opposite — that something is still
  // owed on it — so it is left out of the ringable vocabulary entirely and the decision carries the reason.
  "vendor_self_dev",
  "vendor_confirm",
] as const;
export type WingGuidedHighlightTarget = (typeof WING_GUIDED_HIGHLIGHT_TARGETS)[number];

/**
 * One live locate reading. **Every field is something `buildFixedLabelLocateScript` returns** — there is no room
 * here for a property the apparatus cannot produce, which is the single defect that produced both the refuted
 * 발급 record (`role: "button"`, never measured) and the withdrawn 삭제 one.
 */
export interface WingGuidedHighlightReading {
  /** The recon candidate id that was read. Resolves through {@link wingCandidateSpecById}; never a re-typed query. */
  readonly candidateId: string;
  /** WHICH screen the reading was taken on. A locate is evidence about one screen and no other. */
  readonly screen: WingFlowScreen;
  /** Candidates matching the fixed label that PAINT. `1` is the whole promotion bar; see the note below. */
  readonly visibleCount: number;
  /**
   * Text-matching elements that do NOT paint. **Recorded as FRAGILITY, never as a bar** — see
   * {@link WING_GUIDED_HIGHLIGHT_HIDDEN_TWIN_POLICY} for why, and for what happens if one appears.
   */
  readonly hiddenCount: number;
  /** The MEASURED tag of a unique match. Absent when nothing painted — never an expected value. */
  readonly observedTag?: string;
  /** Opaque 16-hex structural signature of the unique match. Provenance and cross-query identity; never a gate. */
  readonly sig16?: string;
  /** How many of the run's checkpoints produced this reading, integer for integer. `1` is a single observation. */
  readonly checkpointsAgreeing: number;
}

/**
 * **A non-zero `hiddenCount` does not block a promotion, and the reason is worth stating once.**
 *
 * The bar this workstream actually needs is `visibleCount === 1` plus a MEASURED tag. A hidden twin — an element
 * carrying the same whole text that does not render — is excluded from the candidate set before the count is
 * taken, so it cannot be what the ring lands on. What stopped the 발급 decoy was the visibility filter itself;
 * `hiddenCount` is the diagnostic that made that failure legible, not the guard.
 *
 * The bar briefly read `hiddenCount === 0`, which was an over-generalisation from one reading:
 * `WING_KEY_CREATION_CONTROL_ID` happened to measure `hidden: 0` on TERMS — and measures `hidden: 1` on PURPOSE,
 * so the same clause would have refused it on the other screen. WING's purpose screen carries 12 non-painting
 * `확인` controls and its terms screen one hidden twin of each consent sentence; that is template markup, not
 * ambiguity.
 *
 * **What it IS.** If a hidden twin ever paints, the locate returns 2, the step fails closed with
 * `target_not_found`, and the seller's own on-page control remains — a recoverable park, not a misplaced ring.
 * So the count is recorded on every reading and a reviewer can see which promotions carry that exposure.
 */
export const WING_GUIDED_HIGHLIGHT_HIDDEN_TWIN_POLICY = "RECORDED_AS_FRAGILITY_NOT_A_PROMOTION_BAR" as const;

/**
 * The promotion decision for one target, and the reading it rests on.
 *
 * `candidateId: null` + `promoted: false` is the honest pre-measurement state, and it is the state every entry
 * ships in until a live run says otherwise. Naming a candidate BEFORE the reading would be the "arbitrary
 * selector promotion" this unit is forbidden to make — so the id is written down by the same edit that writes
 * down the reading, and `guided-control-highlight-calibration.test.ts` refuses a `promoted: true` entry whose
 * `candidateId` has no matching reading in {@link WING_GUIDED_HIGHLIGHT_EVIDENCE}.
 */
export interface WingGuidedHighlightPromotion {
  readonly target: WingGuidedHighlightTarget;
  readonly candidateId: string | null;
  /** The screen the ring would be drawn on. Fixed by the walk's own step, not chosen by the reading. */
  readonly screen: WingFlowScreen;
  readonly promoted: boolean;
  /** Why it is not promoted yet, or `null` once it is. Prose for a reviewer; never sent to a page. */
  readonly blockedReason: string | null;
}

/**
 * **NOT MEASURED — every entry is `promoted: false`.** The live calibration that fills these in is a
 * `COUPANG_WING_ISSUANCE_FLOW_DISCOVERY` sitting; until it has run, the walk keeps guiding these four steps by
 * TEXT exactly as it does today, and the driver draws no ring at any of them.
 *
 * Flipping an entry requires three things in the same edit, and the test enforces all three: a `candidateId`
 * that resolves in {@link WING_STAGE2_RECON_CANDIDATES}, a reading of THAT id on THAT screen in
 * {@link WING_GUIDED_HIGHLIGHT_EVIDENCE} with `visibleCount: 1` and `hiddenCount: 0`, and `blockedReason: null`.
 */
export const WING_GUIDED_HIGHLIGHT_PROMOTIONS: readonly WingGuidedHighlightPromotion[] = Object.freeze([
  // The `label` narrowing, and the narrowing is the finding: the broad query measured TWO painting elements for
  // the same string on the same screen in the same pass, so `OPEN API` is repeated on the purpose screen and
  // only the single-tag query separates the option's own label from the other one.
  Object.freeze({
    target: "purpose_open_api" as const,
    candidateId: "stage2.purpose_open_api.label",
    screen: "PURPOSE" as const,
    promoted: true,
    blockedReason: null,
  }),
  // The actionable-only narrowing. Its broad sibling resolved to the SAME signature in the same pass, so unlike
  // the key-creation control there was no identically-worded decoy to separate — the narrowing is a constraint
  // on what a future page may match, not a disambiguation of this one.
  Object.freeze({
    target: "confirm" as const,
    candidateId: "stage2.confirm.actionable",
    screen: "PURPOSE" as const,
    promoted: true,
    blockedReason: null,
  }),
  // The consent SENTENCES, not the boxes. `WING_TERMS_CHECKBOX_PROMOTION_BLOCKED` still holds — the inputs have
  // no accessible association and nothing here claims to know where an individual box is. What ties each ring to
  // its own consent is the per-row block census on the same run: each sentence's nearest ancestor block holds
  // exactly that one consent and exactly one visible checkbox.
  Object.freeze({
    target: "consent_api" as const,
    candidateId: "stage3.terms.api_agree.label",
    screen: "TERMS" as const,
    promoted: true,
    blockedReason: null,
  }),
  Object.freeze({
    target: "consent_category" as const,
    candidateId: "stage3.terms.category_agree.label",
    screen: "TERMS" as const,
    promoted: true,
    blockedReason: null,
  }),
  // ── the VENDOR-METHOD screen (2026-08-12) ──
  //
  // Both rest on `WING_VENDOR_METHOD_SCREEN_EVIDENCE`: two checkpoints of the same screen, agreeing integer for
  // integer and tag for tag, with a broad sibling measuring 2 for the option label — so the `label` narrowing is
  // a disambiguation here, not a coincidence.
  Object.freeze({
    target: "vendor_self_dev" as const,
    candidateId: "stage4.vendor.self_dev.label",
    screen: "VENDOR_METHOD" as const,
    promoted: true,
    blockedReason: null,
  }),
  // The control that ISSUES THE KEY. Its candidate is the SAME one `confirm` uses on the purpose screen — a
  // promotion is per (target, screen), and this row is what says the ring was measured on the screen it is drawn
  // on. A promotion resting on the purpose-screen reading would be pointing at this control with evidence about
  // a different one; on the terms screen between them, that same candidate reads hidden.
  Object.freeze({
    target: "vendor_confirm" as const,
    candidateId: "stage2.confirm.actionable",
    screen: "VENDOR_METHOD" as const,
    promoted: true,
    blockedReason: null,
  }),
]);

export function wingGuidedHighlightPromotion(target: WingGuidedHighlightTarget): WingGuidedHighlightPromotion {
  const found = WING_GUIDED_HIGHLIGHT_PROMOTIONS.find((p) => p.target === target);
  // A target with no entry would fall through to "not promoted" and look exactly like a deliberate refusal.
  if (!found) throw new Error(`coupang-wing-label-recon: no guided-highlight promotion entry for ${target}`);
  return found;
}

/**
 * **The consent pairing this unit is allowed to rest on, and what it actually says.**
 *
 * The 2026-08-11 guided walk advanced step 4 on `buildWingConsentCompleteScript`, which is fail-closed: it
 * returns `true` only when EVERY consent resolved to exactly one visible checkbox inside the nearest ancestor
 * holding exactly that one consent sentence, and that box was ticked. So the structural 1:1 pairing held on a
 * real terms screen — that much is live, and it is the pairing the user's instruction points at.
 *
 * **What it is not.** It is an aggregate boolean by construction: the per-row verdicts, depths and block
 * checkbox counts never crossed the page boundary, so nothing knows WHICH box paired with which consent or how
 * far up the block sat. The per-row census (`buildWingConsentBlockScript`) has never been run live. A ring
 * drawn from this evidence alone would be pointing with a fact the evidence deliberately does not carry.
 */
export const WING_CONSENT_PAIRING_LIVE_BASIS = "AGGREGATE_CONJUNCTION_TRUE_2026_08_11_PER_ROW_CENSUS_NEVER_RUN" as const;

/** See {@link WingGuidedHighlightEvidence.phase} — a literal, pinned to the CLI's constant by test. */
export const WING_GUIDED_HIGHLIGHT_PHASE = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" as const;
export type WingGuidedHighlightPhase = typeof WING_GUIDED_HIGHLIGHT_PHASE;

export interface WingGuidedHighlightEvidence {
  /** `null` until a live calibration has run — never an empty object that reads like a completed measurement. */
  readonly measuredOn: string | null;
  readonly gitSha: string | null;
  readonly runId: string | null;
  readonly approvalId: string | null;
  /**
   * The phase that takes this measurement, as a literal. It is NOT imported from
   * `cli/probe-wing-issuance-selectors.ts`, which owns the canonical constant: this is a leaf module and the CLI
   * imports it, so the dependency only runs one way. `guided-control-highlight-calibration.test.ts` pins the two
   * strings equal, which is the same thing the import would have bought without the cycle.
   */
  readonly phase: WingGuidedHighlightPhase;
  readonly readings: readonly WingGuidedHighlightReading[];
  /** The per-row consent-block census, once one exists. `null` means the instrument has not been run. */
  readonly consentPairing: {
    readonly visibleCheckboxCount: number;
    readonly consentsMatchedExactlyOnce: number;
    readonly consentsCompared: number;
    /** The nearest-block depths, in row order. Structural integers; no text, no identity. */
    readonly ancestorDepths: readonly number[];
  } | null;
  /** What the pairing claim rests on TODAY. Stays on the record after the census runs, as the prior state. */
  readonly priorBasis: typeof WING_CONSENT_PAIRING_LIVE_BASIS;
}

/**
 * **LIVE-MEASURED 2026-08-11**, under the granted `COUPANG_WING_ISSUANCE_FLOW_DISCOVERY` sitting
 * `apr-c13e4ee4a7c3` / `wt-27f2e9010f82` at git `9c314ca0` (sanitized record `wingrec_cdbf40748fe2`). Four
 * checkpoints, no halt, screens `PURPOSE → PURPOSE → TERMS → TERMS`, zero probe faults, zero agent selections,
 * and `약관 동의 및 Key 발급받기` never pressed.
 *
 * **Every promotable reading was taken TWICE**, on two checkpoints of the same screen, and agreed integer for
 * integer including the signature. `checkpointsAgreeing` records that rather than asserting stability: two
 * readings minutes apart in one session are not a cross-session claim, and none is made.
 *
 * **The broad siblings are on the record deliberately.** They promote nothing, and they are what makes each
 * narrowing legible: `.broad` measuring 2 on the purpose screen is why the `label` query is a disambiguation,
 * and the two consent sentences measuring 2 visible each is why their narrowings are a nesting rather than an
 * ambiguity. Dropping them would leave four bare `visibleCount: 1` rows with nothing to compare against.
 *
 * **An earlier sitting the same day is NOT folded in.** `wingrec_936303e29551` measured the same purpose-screen
 * counts and signatures, and emitted `observedTag: null` for all of them — the record emitter dropped the field
 * (the fourth seam it was dropped at). Those readings are not cited here: a promotion resting partly on a
 * reading that could not carry the property the bar asks for is the shape this file exists to refuse.
 */
export const WING_GUIDED_HIGHLIGHT_EVIDENCE: WingGuidedHighlightEvidence = Object.freeze({
  measuredOn: "2026-08-11",
  gitSha: "9c314ca0",
  runId: "wt-27f2e9010f82",
  approvalId: "apr-c13e4ee4a7c3",
  phase: WING_GUIDED_HIGHLIGHT_PHASE,
  readings: Object.freeze([
    // ── PURPOSE ──
    Object.freeze({
      candidateId: "stage2.purpose_open_api.label",
      screen: "PURPOSE" as const,
      visibleCount: 1,
      hiddenCount: 0,
      observedTag: "LABEL",
      sig16: "188162181dc87310",
      checkpointsAgreeing: 2,
    }),
    // The broad sibling: TWO painting elements carry `OPEN API` on this screen. This is the row that makes the
    // one above a narrowing rather than a coincidence.
    Object.freeze({
      candidateId: "stage2.purpose_open_api.broad",
      screen: "PURPOSE" as const,
      visibleCount: 2,
      hiddenCount: 0,
      checkpointsAgreeing: 2,
    }),
    Object.freeze({
      candidateId: "stage2.confirm.actionable",
      screen: "PURPOSE" as const,
      visibleCount: 1,
      // Twelve non-painting `확인` controls — template markup, not ambiguity. See the hidden-twin policy.
      hiddenCount: 12,
      observedTag: "BUTTON",
      sig16: "6e49bb88190a65f8",
      checkpointsAgreeing: 2,
    }),
    // The broad sibling resolved to the SAME element (identical signature), which is what says the narrowing
    // did not pick a different one. Unlike the key-creation control, there was no decoy here to separate.
    Object.freeze({
      candidateId: "stage2.confirm.confirm",
      screen: "PURPOSE" as const,
      visibleCount: 1,
      hiddenCount: 20,
      observedTag: "BUTTON",
      sig16: "6e49bb88190a65f8",
      checkpointsAgreeing: 2,
    }),
    // ── TERMS ──
    Object.freeze({
      candidateId: "stage3.terms.api_agree.label",
      screen: "TERMS" as const,
      visibleCount: 1,
      hiddenCount: 1,
      observedTag: "LABEL",
      sig16: "58d56b6060c57050",
      checkpointsAgreeing: 2,
    }),
    Object.freeze({
      candidateId: "stage3.terms.api_agree",
      screen: "TERMS" as const,
      visibleCount: 2,
      hiddenCount: 2,
      checkpointsAgreeing: 2,
    }),
    Object.freeze({
      candidateId: "stage3.terms.category_agree.label",
      screen: "TERMS" as const,
      visibleCount: 1,
      hiddenCount: 1,
      observedTag: "LABEL",
      sig16: "25a572e0e8a91c20",
      checkpointsAgreeing: 2,
    }),
    Object.freeze({
      candidateId: "stage3.terms.category_agree",
      screen: "TERMS" as const,
      visibleCount: 2,
      hiddenCount: 3,
      checkpointsAgreeing: 2,
    }),
  ]),
  // The per-row census, run live for the FIRST time. Both boxes resolved: each one's nearest ancestor block
  // holds exactly one consent sentence and exactly one visible checkbox, at depth 1. This is what ties a ring
  // drawn on a SENTENCE to the box beside it without claiming to know where the box is.
  consentPairing: Object.freeze({
    visibleCheckboxCount: 2,
    consentsMatchedExactlyOnce: 2,
    consentsCompared: 2,
    ancestorDepths: Object.freeze([1, 1]),
  }),
  priorBasis: WING_CONSENT_PAIRING_LIVE_BASIS,
});

/**
 * **Every live reading a promotion may cite, from whichever sitting took it.**
 *
 * Two evidence records exist because two sittings measured two different screens, and neither should be edited
 * to hold the other's rows — a record names a run, an approval and a git sha, and folding a second run into it
 * would make those fields describe only part of what they appear to cover.
 *
 * What must NOT be two things is the question "is there a reading behind this promotion". So the lookup is here,
 * once, and the promotion gate asks it rather than picking a record. Adding a third sitting means adding it to
 * this list and nowhere else; forgetting to means its promotions fail the gate, which is the right direction to
 * fail in.
 */
export function wingGuidedHighlightReadings(): readonly WingGuidedHighlightReading[] {
  return [...WING_GUIDED_HIGHLIGHT_EVIDENCE.readings, ...WING_VENDOR_METHOD_SCREEN_EVIDENCE.readings];
}

/** The reading behind one promotion, or `undefined` — which is a promotion the gate must refuse. */
export function wingGuidedHighlightReadingFor(
  candidateId: string,
  screen: WingFlowScreen,
): WingGuidedHighlightReading | undefined {
  return wingGuidedHighlightReadings().find((r) => r.candidateId === candidateId && r.screen === screen);
}

/**
 * Resolve ANY recon candidate to its spec by id — the one door between a promotion record and a query string.
 *
 * Exported for the same reason {@link WING_PURPOSE_SCREEN_MARKER_SPEC} is: the driver must be able to ring a
 * promoted control without a second hand-written copy of its query. A duplicate `exactText` is how the purpose
 * heading's 이제/period drift got measured as absent, and a duplicate `candidateQuery` is how a ring could end
 * up pointing with a string the calibration no longer covers.
 */
export function wingCandidateSpecById(id: string): WingFlowScreenMarkerSpec {
  for (const candidates of Object.values(WING_STAGE2_RECON_CANDIDATES)) {
    for (const c of candidates) {
      if (c.id === id) return Object.freeze({ id: c.id, candidateQuery: c.candidateQuery, exactText: c.exactText });
    }
  }
  throw new Error(`coupang-wing-label-recon: no candidate for id ${id}`);
}
