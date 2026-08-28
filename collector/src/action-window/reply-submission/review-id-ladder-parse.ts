/**
 * **Parsing what the in-page review-id ladder returns** — validated into typed candidates, never trusted.
 *
 * Moved out of `instruments/live-runs/run-review-id-reconciliation-live-naver.ts` (2026-08-28) so the resident
 * reply carrier's composer-fill gate can reuse the SAME parser the live reconciliation proof used, rather than a
 * second one. The instrument re-exports these names unchanged.
 *
 * Every field is validated to its exact shape: an id fingerprint that is not 64 lowercase hex is dropped, a
 * row whose index disagrees with its position is dropped, and anything other than an explicit `false` on the
 * truncation flags reads as "possibly truncated" — an unknown must never read as a clean scan.
 */
import { REVIEW_ID_SOURCE_ORDER, type LiveRowCandidate, type ReviewIdSource } from "./review-id-locator";

/** `YYYY-MM-DD` → the civil parts the in-page recency bucket is computed against. Null if unparseable. */
export function civilDateParts(kstDate: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(kstDate);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** The raw shape the in-page ladder returns, before it is validated into typed candidates. */
interface RawLadderResult {
  rows?: unknown;
  pageStateFingerprints?: unknown;
  rowCount?: unknown;
  rowsTruncated?: unknown;
  tokensTruncated?: unknown;
  scopeExpandedRows?: unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;
const SOURCES = new Set<string>(REVIEW_ID_SOURCE_ORDER);

/**
 * Validates the in-page result into typed candidates. The page is untrusted input: a hostile or merely broken
 * surface must not be able to inject an arbitrary shape into the locator, and — because `rowIndex` is what the
 * outline step later addresses — it must not be able to point the outline at a row of its choosing.
 *
 * So `rowIndex` is **not taken from the page at all**: it is the entry's own array position, and any entry
 * whose claimed index disagrees is dropped. A page can still lie about what a row contains (that is what the
 * exactly-one rule and the outline re-verification are for), but it cannot redirect the highlight.
 */
export function parseLadderResult(raw: unknown): {
  candidates: LiveRowCandidate[];
  pageStateFingerprints: string[];
  rowCount: number;
  rowsTruncated: boolean;
  tokensTruncated: boolean;
  scopeExpandedRows: number;
} {
  const result = (raw ?? {}) as RawLadderResult;
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const candidates: LiveRowCandidate[] = [];
  for (const [position, entry] of rows.entries()) {
    const row = (entry ?? {}) as {
      rowIndex?: unknown;
      idFingerprints?: unknown;
      secondary?: { rating?: unknown; recencyBucket?: unknown };
    };
    // The index must be the position it actually occupies — nothing else is addressable later.
    if (row.rowIndex !== position) continue;
    const fingerprints: { source: ReviewIdSource; fingerprint: string }[] = [];
    for (const item of Array.isArray(row.idFingerprints) ? row.idFingerprints : []) {
      const f = (item ?? {}) as { source?: unknown; fingerprint?: unknown };
      if (typeof f.source !== "string" || !SOURCES.has(f.source)) continue;
      if (typeof f.fingerprint !== "string" || !HEX64.test(f.fingerprint)) continue;
      fingerprints.push({ source: f.source as ReviewIdSource, fingerprint: f.fingerprint });
    }
    const rating = row.secondary?.rating;
    const bucket = row.secondary?.recencyBucket;
    candidates.push({
      rowIndex: position,
      idFingerprints: fingerprints,
      secondary: {
        rating: typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
        recencyBucket: typeof bucket === "string" ? bucket : null,
      },
    });
  }
  const pageState = (Array.isArray(result.pageStateFingerprints) ? result.pageStateFingerprints : []).filter(
    (f): f is string => typeof f === "string" && HEX64.test(f),
  );
  const rowCount = typeof result.rowCount === "number" && result.rowCount >= 0 ? result.rowCount : candidates.length;
  return {
    candidates,
    pageStateFingerprints: pageState,
    rowCount,
    // Anything other than an explicit `false` is treated as "possibly truncated" — an unknown must never
    // read as a clean scan, because the whole point of the flag is to stop a miss becoming a claim.
    rowsTruncated: result.rowsTruncated !== false || candidates.length !== rows.length,
    tokensTruncated: result.tokensTruncated !== false,
    scopeExpandedRows:
      typeof result.scopeExpandedRows === "number" && result.scopeExpandedRows >= 0 ? result.scopeExpandedRows : 0,
  };
}

