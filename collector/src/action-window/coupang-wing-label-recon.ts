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
  const containmentById = new Map<string, FixedLabelContainmentReading>();
  const conflicting = new Set<string>();
  for (const r of raw) {
    // A repeated candidate id is a conflict when ANY of its readings differ, not just the count. Comparing the
    // count alone let two rows with the same count but different containment through, and the last one silently
    // won — which is the same "reported twice, differently" case, one field over.
    const shape = JSON.stringify([r.matchCount, r.sig ?? null, r.hiddenCount ?? null, r.containment ?? null]);
    if (shapeById.has(r.targetId) && shapeById.get(r.targetId) !== shape) conflicting.add(r.targetId);
    shapeById.set(r.targetId, shape);
    byId.set(r.targetId, r.matchCount);
    if (typeof r.sig === "string" && r.sig.length > 0) sigById.set(r.targetId, r.sig);
    // Optional readings: only a real number is recorded. `undefined` leaves the map empty and the row null —
    // the same measured-vs-unmeasured line the count itself draws, one field over.
    if (typeof r.hiddenCount === "number" && Number.isSafeInteger(r.hiddenCount) && r.hiddenCount >= 0)
      hiddenById.set(r.targetId, r.hiddenCount);
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
export const WING_STAGE2_RECON_TARGETS = ["purpose", "self_dev", "vendor_info", "vendor_url", "call_ip", "confirm"] as const;
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
 * Every entry traces to something already on the record — the product owner's description of the official flow
 * (발급 → 연동 방식 선택 → 자체개발(직접입력) → 업체명 · URL · IP 주소 → 확인) or a mechanical spacing variant of
 * one. Nothing here is invented wording, and nothing here is measured wording.
 *
 * **What this set deliberately does NOT contain: the second radio's label.** Two visible radios were measured on
 * 2026-08-09 and only one of them has a described counterpart in the flow account. Guessing the other — 업체연동,
 * 대행, whatever seems plausible — is precisely the speculative retuning `collector/CLAUDE.md` §6 forbids, and it
 * would put a fabricated string into the live page as a query. So the second option is measured *structurally*
 * (derivation, association, group, length bucket) and its wording stays unknown until an operator transcribes it
 * or an instrument reads it. A row reading `exactCandidateIndex: -1` against a `short` name is the honest
 * outcome, and it is a finding, not a gap.
 *
 * Ordered self-developed-first only because that is the order the flow description names them; ordering here
 * carries no claim about the screen. The comparison is exhaustive, so it is order-insensitive by construction.
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
]);

/**
 * **Fail-closed capability check, run BEFORE the operator is asked for anything.**
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
 * **What each Stage-2 choice control IS — the association measurement, and what it did NOT establish.**
 *
 * Run `wt-1e2ab6816bcc` / `wingrec_5497afb9eec4`, grant `apr-848e2cfd06f2`, git `ce733f78`, phase
 * `COUPANG_WING_STAGE2_LABEL_CALIBRATION`. The operator pressed `API Key 발급 받기` themselves, left the purpose
 * screen untouched, and signalled ready. Agent click / type / submit / highlight / tag / selection budget: zero.
 * Eight candidates measured, eight containment readings, no probe fault, one capture.
 *
 * This is the sibling of {@link WingStage2ReconEvidence}, which counted the controls. This one reads how they
 * are LABELLED. It does not read what they SAY — see {@link purposeOptionSemanticsMeasured}, still false, which
 * is why the next unit exists and why no radio may be selected yet.
 */
export interface WingStage2LabelCalibrationEvidence {
  readonly observedOn: string;
  readonly gitSha: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly recordId: string;
  readonly precondition: "OK";
  /**
   * MEASURED: the shape census, re-read on this run. Identical to the recon's, which is a same-conditions
   * agreement between two separate captures and nothing stronger — neither run can speak for the other's page.
   */
  readonly visibleChoiceControlCount: 2;
  /**
   * MEASURED. The UNION of not-painting and disabled, as on both censuses — a painting-but-disabled radio lands
   * here, so this must not be read as "not on screen".
   */
  readonly hiddenChoiceControlCount: 10;
  readonly groupContainerCount: 0;
  /**
   * **MEASURED: the two radios share one `name` group.** This is the fact the recon could not obtain — HTML
   * groups radios by their shared `name`, and the shape census deliberately never reads that attribute, so the
   * earlier record could say only that no painting `fieldset` / `[role=radiogroup]` / `[role=listbox]` existed.
   * A code comment over-claimed that as "the radios are ungrouped", and the correction turns out to run the
   * other way: they ARE grouped, by the attribute nobody had read.
   *
   * The `name` VALUE was read in-page to bucket by and never left; only the ordinal did.
   */
  readonly nameGroupCount: 1;
  readonly largestNameGroupSize: 2;
  readonly ungroupedCount: 0;
  /**
   * MEASURED, per visible control, in document order. Both are labelled by a `label[for]` — exactly one each,
   * no `aria-label`, no `aria-labelledby`, no wrapping `<label>`. **The association is correctly wired on both.**
   *
   * `nameLengthBucket` differs between them, so the two options are not symmetric wording. That is a bound on
   * the label's SIZE and nothing else: no character of either label is recorded.
   */
  readonly rows: readonly [
    {
      readonly index: 0;
      readonly nameSource: "LABEL_FOR";
      readonly nameLengthBucket: "short";
      readonly labelForCount: 1;
      readonly ancestorLabelCount: 0;
      readonly ariaLabelledbyRefCount: 0;
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
      readonly hasIdAttr: true;
      readonly groupIndex: 0;
      readonly exactCandidateIndex: -1;
      readonly containsCandidateIndex: -1;
    },
  ];
  /**
   * **MEASURED: neither radio's derived name equals OR contains any of the four candidates.** All four were
   * sent (`candidatesCompared: 4`), so this is a measured non-match across the whole set, not a partial sweep.
   *
   * Stated as a non-match and nothing more. What the labels DO say is unmeasured.
   */
  readonly purposeCandidatesMatched: 0;
  readonly candidatesCompared: 4;
  /**
   * **INFERRED, not measured:** that the operator-visible option wording differs from the product owner's flow
   * description (자체개발(직접입력)). The measured facts are two — neither label matches those words, and those
   * words exist on the page only in non-painting nodes. The step from there to "the options are called something
   * else" assumes the `LABEL_FOR`-derived name is what a sighted seller reads, which is very likely and is not
   * a measurement. `tested: false`.
   */
  readonly visibleWordingDiffersFromFlowDescription: {
    readonly provenance: "INFERRED";
    readonly tested: false;
  };
  /**
   * MEASURED per candidate: where each fixed label actually is. The recon could produce only `ABSENT`, bounded
   * by `absenceBounds` to painting whole-text matches; this splits every one of those absences.
   */
  readonly presence: {
    readonly confirm: "PRESENT_VISIBLE";
    readonly vendor_info: "PRESENT_HIDDEN_ONLY";
    readonly vendor_url: "PRESENT_HIDDEN_ONLY";
    readonly call_ip_ip_addr: "PRESENT_HIDDEN_ONLY";
    readonly self_dev_baseline: "PRESENT_NOT_WHOLE_TEXT";
    readonly self_dev_direct: "PRESENT_NOT_WHOLE_TEXT";
    readonly call_ip_baseline: "ABSENT_EVERYWHERE";
    readonly purpose_transcribed_sentence: "ABSENT_EVERYWHERE";
  };
  /**
   * **The recon's single INFERRED explanation was TOO SIMPLE, and this is the measurement that says so.**
   *
   * `WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT` was offered for all seven absences. It holds for two
   * (`자체개발`, `직접입력` — nested text, no painting whole-text match). Three were hidden whole-text matches,
   * which is a different cause entirely. Two are absent by any reading. So the hypothesis is confirmed as ONE
   * cause among three, not as THE cause — and the earlier record's `absenceExplanation.tested: false` was the
   * honest label for it.
   *
   * This does not rewrite {@link WING_STAGE2_RECON_EVIDENCE}. That record describes what that run measured, and
   * its `absenceBounds` correctly said its absences counted painting matches only — which is exactly why three
   * of them turn out to be hidden matches rather than absences. The bound did its job.
   */
  readonly absenceExplanationOutcome: {
    readonly hypothesis: "WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT";
    readonly verdict: "CONFIRMED_FOR_SOME_REFUTED_AS_SOLE_CAUSE";
    readonly nestedTextCandidates: 2;
    readonly hiddenWholeTextCandidates: 3;
    readonly absentByAnyReadingCandidates: 2;
  };
  /**
   * **MEASURED: `확인` matched one PAINTING element and twenty non-painting ones.**
   *
   * The recon recorded `matchCount: 1, verdict: UNIQUE` and carried no hidden count — it could not have seen
   * the twenty. Its uniqueness was, and remains, uniqueness *among painting elements*: if any of those twenty
   * ever painted, the locator resolves to many. That is a property of the page, recorded; it is not a decision
   * about the locator, which is still not promoted to anything.
   *
   * Still NOT the final key-issuance control on this record. Nothing pressed it, this phase has no tooling that
   * could, and its role continues to come from the product owner's description of the flow.
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
   * `277220f7`) — two separate runs, two separate captures, two separate grants.
   *
   * Two is not many. It is stated as agreement across exactly two captures and nothing more, and the signature
   * stays `EVIDENCE_ONLY`: the `issue` calibration's original defect was a stability claim built on captures
   * that were never independent, and the fix is not to make the same claim off a smaller number.
   */
  readonly signatureStability: "AGREED_ACROSS_TWO_CAPTURES";
  readonly captureCount: 1;
  /** MEASURED integrity of the sweep: every candidate probed, every containment read, nothing faulted. */
  readonly candidatesMeasured: 8;
  readonly candidatesNotMeasured: 0;
  readonly containmentMeasured: 8;
  readonly probeFaults: 0;
  readonly containmentFaults: 0;
  readonly associationFault: null;
  /** MEASURED: neither scan hit its cap, so every absence above is a whole-scan absence. */
  readonly scanTruncated: false;
  readonly containmentScanTruncated: false;
  readonly rowsTruncated: false;
  /**
   * MEASURED on this run and NOT explained by it: the open-API marker did not fire, while the surface still
   * classified as `open_api_issuance` (which the precondition requires). Recorded because omitting a signal
   * that reads oddly is how a record becomes selective; no conclusion is drawn, and the recon record carried
   * no such field to compare against.
   */
  readonly openApiMarkerPresent: false;
  /**
   * **STILL FALSE, and this is the point of the record.** Shape, association, group membership and a length
   * band are known for both radios. What either one MEANS is not. Deciding which is 자체개발 from "one is short
   * and one is medium" would be inventing a product decision from a bucket.
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

export const WING_STAGE2_LABEL_CALIBRATION_EVIDENCE: WingStage2LabelCalibrationEvidence = Object.freeze({
  observedOn: "2026-08-09",
  gitSha: "ce733f78",
  runId: "wt-1e2ab6816bcc",
  approvalId: "apr-848e2cfd06f2",
  recordId: "wingrec_5497afb9eec4",
  precondition: "OK",
  visibleChoiceControlCount: 2,
  hiddenChoiceControlCount: 10,
  groupContainerCount: 0,
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
      hasIdAttr: true,
      groupIndex: 0,
      exactCandidateIndex: -1,
      containsCandidateIndex: -1,
    }),
  ]) as WingStage2LabelCalibrationEvidence["rows"],
  purposeCandidatesMatched: 0,
  candidatesCompared: 4,
  visibleWordingDiffersFromFlowDescription: Object.freeze({
    provenance: "INFERRED",
    tested: false,
  }) as WingStage2LabelCalibrationEvidence["visibleWordingDiffersFromFlowDescription"],
  presence: Object.freeze({
    confirm: "PRESENT_VISIBLE",
    vendor_info: "PRESENT_HIDDEN_ONLY",
    vendor_url: "PRESENT_HIDDEN_ONLY",
    call_ip_ip_addr: "PRESENT_HIDDEN_ONLY",
    self_dev_baseline: "PRESENT_NOT_WHOLE_TEXT",
    self_dev_direct: "PRESENT_NOT_WHOLE_TEXT",
    call_ip_baseline: "ABSENT_EVERYWHERE",
    purpose_transcribed_sentence: "ABSENT_EVERYWHERE",
  }) as WingStage2LabelCalibrationEvidence["presence"],
  absenceExplanationOutcome: Object.freeze({
    hypothesis: "WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT",
    verdict: "CONFIRMED_FOR_SOME_REFUTED_AS_SOLE_CAUSE",
    nestedTextCandidates: 2,
    hiddenWholeTextCandidates: 3,
    absentByAnyReadingCandidates: 2,
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
  signatureStability: "AGREED_ACROSS_TWO_CAPTURES",
  captureCount: 1,
  candidatesMeasured: 8,
  candidatesNotMeasured: 0,
  containmentMeasured: 8,
  probeFaults: 0,
  containmentFaults: 0,
  associationFault: null,
  scanTruncated: false,
  containmentScanTruncated: false,
  rowsTruncated: false,
  openApiMarkerPresent: false,
  purposeOptionSemanticsMeasured: false,
  operatorSelectedPurpose: false,
  operatorPressedConfirm: false,
  keyCreationRuledOut: false,
  issuedStateReason: "NO_DISCRIMINATING_SIGNAL",
  refines: WING_STAGE2_RECON_EVIDENCE,
});
