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
  raw: readonly { targetId: string; matchCount: number; sig?: string }[],
): WingReconTargetResult[] {
  return interpretFor(screenTargets(targets), WING_LABEL_RECON_CANDIDATES, raw);
}

/**
 * Stage-2 reading, folded by the SAME logic — including `NOT_MEASURED` for a missing or self-conflicting row,
 * which is the distinction that stops a partly-failed sweep reading as "these Stage-2 labels are confirmed
 * absent". Sharing the fold rather than copying it is deliberate: a second implementation is a second place for
 * the measured/unmeasured conflation to come back.
 */
export function interpretWingStage2Recon(
  targets: readonly WingStage2ReconTarget[],
  raw: readonly { targetId: string; matchCount: number; sig?: string }[],
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
  raw: readonly { targetId: string; matchCount: number; sig?: string }[],
): { target: K; candidates: WingReconCandidateResult[]; uniqueCandidateIds: string[]; resolvedUnambiguously: boolean }[] {
  const byId = new Map<string, number>();
  const sigById = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const r of raw) {
    if (byId.has(r.targetId) && byId.get(r.targetId) !== r.matchCount) conflicting.add(r.targetId);
    byId.set(r.targetId, r.matchCount);
    if (typeof r.sig === "string" && r.sig.length > 0) sigById.set(r.targetId, r.sig);
  }
  const out: { target: K; candidates: WingReconCandidateResult[]; uniqueCandidateIds: string[]; resolvedUnambiguously: boolean }[] = [];
  for (const target of targets) {
    const candidates = (candidateMap[target] ?? []).map((c): WingReconCandidateResult => {
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
  /** MEASURED: no `fieldset` / `[role=radiogroup]` / `[role=listbox]` painted. The radios are ungrouped. */
  readonly groupContainerCount: 0;
  /** MEASURED: neither bound was hit, so absence here IS absence — not "absent from the part we looked at". */
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
