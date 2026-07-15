/**
 * Coarse row-count bucketing — the shared vocabulary for reporting "how many rows" without ever
 * emitting the exact number (`CLAUDE.md` §4.3).
 *
 * A zero-import pure leaf (§5) so any layer may depend on it: `upload.ts` needs it for its logs and
 * cannot reach `naver/review-upload-diagnostic.ts` (which imports `../upload`, so that edge would be
 * a cycle). `review-upload-diagnostic.ts` re-exports `rowCountBucket` under its established
 * `countBucket` name.
 *
 * `esm/esm-review-schema-shape.ts` still carries an identical private copy; folding the esm family in
 * is a separate slice.
 */

/** Coarse row-count bucket — never the exact count. */
export type RowCountBucket = "zero" | "one" | "few" | "tens" | "hundreds" | "thousands_plus";

/** Pure: coarse row-count bucket (never the exact count). */
export function rowCountBucket(n: number): RowCountBucket {
  if (!Number.isFinite(n) || n <= 0) return "zero";
  if (n === 1) return "one";
  if (n <= 9) return "few";
  if (n <= 99) return "tens";
  if (n <= 999) return "hundreds";
  return "thousands_plus";
}
