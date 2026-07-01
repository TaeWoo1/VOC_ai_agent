/**
 * Pure, SANITIZED two-export OVERLAP comparator for ESM+ REVIEW composite dedup (Gate 5, Slice 5A).
 *
 * Given the sanitized composite-key sets of two OVERLAPPING exports (built by
 * `esm-review-composite-key.ts` with the SAME salt), this module decides — at each key level
 * (L1 strong / L2 fallback / L3 weak) — how much the exports overlap and whether any shared key
 * maps to CONFLICTING content across the two exports (a false-merge: two different reviews landing
 * on one key). It answers Slice 5's core question: does a review present in both exports produce
 * the SAME key (repeatability), and do different reviews avoid colliding (uniqueness)?
 *
 * It consumes ONLY already-sanitized input (salted hashes / buckets / booleans / the channel
 * literal) and emits ONLY sanitized metadata — no raw value can pass through because none is
 * present in the input. It CONFIRMS nothing: a positive result STRENGTHENS the composite-key
 * direction; it does not ratify a key. `dedupKeyConfirmed`/`schemaMappingConfirmed` stay false;
 * dedup stays NEEDS_VERIFICATION until a separate gate reviews the evidence.
 *
 * replyStatus invariance is a PROPERTY OF THE KEY BUILDER (replyStatus is excluded from every
 * key), not something re-derived here; this module only echoes that both sets excluded the same
 * categories. Comparability fails closed on channel mismatch or slot-provenance drift (the two
 * exports selected different identity columns ⇒ their keys are not meaningfully comparable).
 */

import type { RowCountBucket } from "./esm-review-schema-shape";
import type {
  RowCompositeKeys,
  SanitizedCompositeKeySet,
  SlotProvenance,
} from "./esm-review-composite-key";
import { rowCountBucket } from "./esm-review-schema-shape";

/** Coarse overlap verdict for one key level — ratio of matched keys to the smaller export. */
export type MatchBucket = "none" | "some" | "most" | "all";

/** Sanitized overlap facts for a single key level. */
export interface LevelOverlap {
  /** Distinct non-null keys present in export A / B (bucketed). */
  aKeyBucket: RowCountBucket;
  bKeyBucket: RowCountBucket;
  /** Distinct keys present in BOTH exports (bucketed). */
  overlapBucket: RowCountBucket;
  /** overlap / min(distinctA, distinctB), coarsely bucketed. */
  matchRate: MatchBucket;
  /** Shared keys whose content fingerprint CONFLICTS across the exports (false-merge signal). */
  falseMergeBucket: RowCountBucket;
}

/** The ONLY shape the overlap comparator emits — fully sanitized. */
export interface SanitizedOverlapVerdict {
  /** True only when both sets are readable, same channel, and same slot provenance. */
  comparable: boolean;
  channelMatch: boolean;
  /** The two exports selected the same-hashed header for every identity slot. */
  slotProvenanceMatch: boolean;
  /** Both exports excluded the same categories from identity (replyStatus / PII / review-id / unknown). */
  excludedCategoriesMatch: boolean;
  l1: LevelOverlap;
  l2: LevelOverlap;
  l3: LevelOverlap;
  /** Structural invariant echo — replyStatus never contributes to a key, so it can't change identity. */
  replyStatusExcludedFromIdentity: true;
  risks: string[];
  /** Honest markers — a comparison, never a confirmation. */
  rawCellLeak: false;
  dedupKeyConfirmed: false;
  schemaMappingConfirmed: false;
}

const EMPTY_LEVEL: LevelOverlap = {
  aKeyBucket: "zero",
  bKeyBucket: "zero",
  overlapBucket: "zero",
  matchRate: "none",
  falseMergeBucket: "zero",
};

function slotProvenanceEqual(a: SlotProvenance, b: SlotProvenance): boolean {
  return (
    a.reviewDate === b.reviewDate &&
    a.product === b.product &&
    a.rating === b.rating &&
    a.reviewText === b.reviewText
  );
}

function matchBucketOf(overlap: number, minCount: number): MatchBucket {
  if (minCount === 0 || overlap === 0) return "none";
  const ratio = overlap / minCount;
  if (ratio >= 1) return "all";
  if (ratio >= 0.5) return "most";
  return "some";
}

/** Map each non-null key at a level to the SET of content fingerprints seen for it in one export. */
function keyToContexts(rows: readonly RowCompositeKeys[], pick: (r: RowCompositeKeys) => string | null): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = pick(r);
    if (key === null) continue;
    const set = out.get(key) ?? new Set<string>();
    set.add(r.context);
    out.set(key, set);
  }
  return out;
}

function compareLevel(
  aRows: readonly RowCompositeKeys[],
  bRows: readonly RowCompositeKeys[],
  pick: (r: RowCompositeKeys) => string | null,
): LevelOverlap {
  const a = keyToContexts(aRows, pick);
  const b = keyToContexts(bRows, pick);
  let overlap = 0;
  let falseMerge = 0;
  for (const [key, aCtx] of a) {
    const bCtx = b.get(key);
    if (bCtx === undefined) continue;
    overlap += 1;
    // Same key, but the union of content fingerprints across BOTH exports has >1 distinct value ⇒
    // two different reviews share this key (a false-merge). Impossible for L1 (key includes text).
    const union = new Set<string>([...aCtx, ...bCtx]);
    if (union.size > 1) falseMerge += 1;
  }
  return {
    aKeyBucket: rowCountBucket(a.size),
    bKeyBucket: rowCountBucket(b.size),
    overlapBucket: rowCountBucket(overlap),
    matchRate: matchBucketOf(overlap, Math.min(a.size, b.size)),
    falseMergeBucket: rowCountBucket(falseMerge),
  };
}

function excludedEqual(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const c of sa) if (!sb.has(c)) return false;
  return true;
}

/**
 * Pure: compare two sanitized composite-key sets into a sanitized overlap verdict. Fails closed
 * (comparable:false, empty levels) when either export is unreadable, the channels differ, or the
 * exports selected different identity columns (slot-provenance drift). Otherwise reports per-level
 * overlap + false-merge signals. Confirms nothing.
 */
export function summarizeOverlap(
  a: SanitizedCompositeKeySet,
  b: SanitizedCompositeKeySet,
): SanitizedOverlapVerdict {
  const channelMatch = a.channel === b.channel;
  const slotProvenanceMatch = slotProvenanceEqual(a.slotProvenance, b.slotProvenance);
  const excludedCategoriesMatch = excludedEqual(a.excludedCategories, b.excludedCategories);
  const bothReadable = a.workbookReadable && b.workbookReadable;
  const comparable = bothReadable && channelMatch && slotProvenanceMatch;

  const risks: string[] = [];
  if (!bothReadable) risks.push("export-unreadable");
  if (!channelMatch) risks.push("channel-mismatch");
  if (!slotProvenanceMatch) risks.push("slot-provenance-drift");
  if (!excludedCategoriesMatch) risks.push("excluded-categories-differ");

  const l1 = comparable ? compareLevel(a.rows, b.rows, (r) => r.l1) : EMPTY_LEVEL;
  const l2 = comparable ? compareLevel(a.rows, b.rows, (r) => r.l2) : EMPTY_LEVEL;
  const l3 = comparable ? compareLevel(a.rows, b.rows, (r) => r.l3) : EMPTY_LEVEL;

  if (comparable && l1.overlapBucket === "zero" && l2.overlapBucket === "zero") {
    risks.push("no-overlap-check-ranges");
  }
  if (l2.falseMergeBucket !== "zero" || l3.falseMergeBucket !== "zero") {
    risks.push("weak-key-false-merge-observed");
  }

  return {
    comparable,
    channelMatch,
    slotProvenanceMatch,
    excludedCategoriesMatch,
    l1,
    l2,
    l3,
    replyStatusExcludedFromIdentity: true,
    risks: [...new Set(risks)],
    rawCellLeak: false,
    dedupKeyConfirmed: false,
    schemaMappingConfirmed: false,
  };
}
