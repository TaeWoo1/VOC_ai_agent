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
 * **It builds no new browser tooling.** The in-page script is the existing audited
 * {@link buildFixedLabelProbeScript} from the NAVER visual-recon calibration, whose output is
 * `{ targetId, matchCount }` and nothing else — no text, no value, no selector, no DOM, no attributes, no
 * geometry. That is also why the heavier `EXTRACT_VISUAL_CONTROLS` census is NOT reused here: it returns raw
 * attribute values and bounding boxes that then need a screening gate, which is a larger sanitization surface
 * than this question needs.
 *
 * A candidate label carries no operator data by construction: these are WING's own generic UI words. Nothing
 * derived from the page — no placeholder, no input value, no company or account text — may be added to a
 * candidate list, and the guard test asserts the shape that keeps it that way.
 */
import { buildFixedLabelProbeScript } from "./api-issuance-calibration/visual-recon-inpage";
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
export const WING_LABEL_RECON_CANDIDATES: Readonly<Record<WingReconTarget, readonly WingLabelCandidate[]>> =
  Object.freeze({
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

/** What a single candidate's measurement means. Closed enum — no free text, no partial credit. */
export const WING_RECON_VERDICTS = ["UNIQUE", "ABSENT", "AMBIGUOUS"] as const;
export type WingReconVerdict = (typeof WING_RECON_VERDICTS)[number];

export interface WingReconCandidateResult {
  readonly id: string;
  readonly matchCount: number;
  readonly verdict: WingReconVerdict;
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

/** The probe descriptors for one or more targets, in the shape {@link buildFixedLabelProbeScript} consumes. */
export function wingReconProbes(
  targets: readonly WingReconTarget[],
): { targetId: string; candidateQuery: string; exactText: string }[] {
  const seen = new Set<WingReconTarget>();
  const out: { targetId: string; candidateQuery: string; exactText: string }[] = [];
  for (const t of targets) {
    if (seen.has(t)) continue; // a repeated target would double-count and inflate nothing useful
    seen.add(t);
    for (const c of WING_LABEL_RECON_CANDIDATES[t]) {
      out.push({ targetId: c.id, candidateQuery: c.candidateQuery, exactText: c.exactText });
    }
  }
  return out;
}

/** The in-page script for a recon pass. Read-only, value-free output, no mutation, no highlight. */
export function buildWingReconScript(targets: readonly WingReconTarget[]): string {
  return buildFixedLabelProbeScript(wingReconProbes(targets));
}

function verdictFor(matchCount: number): WingReconVerdict {
  if (matchCount === 1) return "UNIQUE";
  if (matchCount === 0) return "ABSENT";
  return "AMBIGUOUS";
}

/**
 * Fold a raw `{ targetId, matchCount }[]` reading into per-target results.
 *
 * A candidate the page never reported is recorded as `ABSENT` rather than dropped: a silently missing row would
 * make a partial reading look like a complete one. Unknown ids in the input are ignored — they cannot belong to
 * any target, and inventing a target for them would be worse than saying nothing.
 */
export function interpretWingRecon(
  targets: readonly WingReconTarget[],
  raw: readonly { targetId: string; matchCount: number }[],
): WingReconTargetResult[] {
  const byId = new Map(raw.map((r) => [r.targetId, r.matchCount]));
  const out: WingReconTargetResult[] = [];
  const seen = new Set<WingReconTarget>();
  for (const target of targets) {
    if (seen.has(target)) continue;
    seen.add(target);
    const candidates = WING_LABEL_RECON_CANDIDATES[target].map((c) => {
      const matchCount = byId.get(c.id) ?? 0;
      return { id: c.id, matchCount, verdict: verdictFor(matchCount) };
    });
    const uniqueCandidateIds = candidates.filter((c) => c.verdict === "UNIQUE").map((c) => c.id);
    out.push({
      target,
      candidates,
      uniqueCandidateIds,
      resolvedUnambiguously: uniqueCandidateIds.length === 1,
    });
  }
  return out;
}

/** The probe scope a live recon run would need approving — the three unresolved targets and nothing else. */
export const WING_RECON_APPROVED_SCOPE: readonly WingProbeTargetName[] = Object.freeze([
  "self_dev",
  "vendor_info",
  "call_ip",
]);
