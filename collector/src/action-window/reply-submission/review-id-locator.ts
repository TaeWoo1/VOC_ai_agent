/**
 * **The exact review-row locator** — resolves a live review row by *identity*, keyed by
 * `(channel, sellerAccountId, channelReviewId)`.
 *
 * This is the strongest of the three row-match modes the runtime has (see {@link ROW_MATCH_MODES}). Everything
 * here is **pure**: no browser, no fs, no network, no clock. Candidates arrive already reduced by the in-page
 * discovery ladder, carrying **one-way fingerprints only** — never a raw id, never review text.
 *
 * Two rules are absolute:
 *
 * 1. **Exactly one match, or nothing.** Zero matches and two-or-more matches both fail closed. There is no
 *    "best" match, no first-wins, no nearest-neighbour. A wrong row is far worse than no row.
 * 2. **Secondary facts are asserted *after* an id match, never instead of one.** They are non-identifying
 *    (rating, recency bucket, an opaque product reference) and exist only to catch a fingerprint collision or a
 *    stale candidate set. A mismatch fails the whole locate closed.
 */
import { channelReviewIdFingerprint } from "./review-id-fingerprint";

/** Where on the row a candidate identifier was read from. The ladder is attempted in this order. */
export type ReviewIdSource =
  | "visible-text"
  | "anchor-href"
  | "input-value"
  | "data-attribute"
  | "page-state"
  | "network-response";

/** The fixed inspection order of the discovery ladder — earlier rungs are preferred and stop the search. */
export const REVIEW_ID_SOURCE_ORDER: readonly ReviewIdSource[] = [
  "visible-text",
  "anchor-href",
  "input-value",
  "data-attribute",
  "page-state",
  "network-response",
] as const;

/**
 * The three ways the runtime can decide "this is the row" — **deliberately not equivalent**, listed strongest
 * first. Only `channel-review-id` is an identity match; the other two are the pre-existing fallbacks and must
 * never be reported as if they proved identity.
 */
export const ROW_MATCH_MODES = {
  /** Identity: the channel's own review id, proven equal across the imported record and the live row. */
  "channel-review-id": {
    strength: "identity",
    caveat: "",
  },
  /** Fallback: a human clicked the row this session and the element was retained in memory (D-033). */
  "operator-calibrated": {
    strength: "operator-asserted",
    caveat:
      "Correct by construction for this session only. Asserts nothing about review identity — it is the operator's click that is trusted, not a matched id.",
  },
  /** Fallback: (rating, recencyBucket, bodyFingerprint) narrowed the list to one row. */
  "target-hint": {
    strength: "attribute-narrowed",
    caveat:
      "A uniqueness argument over coarse attributes, not an identity match. Two reviews sharing rating, date bucket and body would be indistinguishable.",
  },
} as const;

export type RowMatchMode = keyof typeof ROW_MATCH_MODES;

/** Non-identifying facts asserted only after an id match. Every field is optional on both sides. */
export interface SecondaryFacts {
  rating?: number | null;
  recencyBucket?: string | null;
  /** An opaque one-way reference to the product, never a product name or number. */
  productRefFingerprint?: string | null;
}

/** A live row reduced by the in-page ladder. Carries fingerprints only — no raw id, no review text. */
export interface LiveRowCandidate {
  /** Position within the candidate set the ladder produced. Used only for reporting and highlighting. */
  rowIndex: number;
  /** Every id-shaped value found on this row, already fingerprinted **in the page**. */
  idFingerprints: readonly { source: ReviewIdSource; fingerprint: string }[];
  secondary?: SecondaryFacts;
}

/** The identity key. Built only via {@link buildReviewIdLocatorKey} so a malformed id can never form one. */
export interface ReviewIdLocatorKey {
  channel: string;
  sellerAccountId: string;
  channelReviewIdFingerprint: string;
}

/** The runtime connection context the run is actually executing under. */
export interface LocatorContext {
  channel: string;
  sellerAccountId: string;
}

export type LocateFailureReason =
  /** The expected id, channel, or account was absent or unusable — no key could be formed. */
  | "MALFORMED_KEY"
  /** The key belongs to a different channel/account than the run is executing under. */
  | "CONTEXT_MISMATCH"
  /** No candidate row carried a matching id fingerprint. */
  | "ZERO_MATCH"
  /** More than one candidate row carried a matching id fingerprint. */
  | "MULTIPLE_MATCH"
  /** Exactly one row matched by id, but an asserted secondary fact disagreed. */
  | "SECONDARY_MISMATCH";

export interface SecondaryAssertionReport {
  /** Facts compared because both sides supplied them. */
  asserted: readonly ("rating" | "recencyBucket" | "productRefFingerprint")[];
  /** Facts skipped because one side did not supply them — skipping is never a mismatch. */
  unavailable: readonly ("rating" | "recencyBucket" | "productRefFingerprint")[];
  /** Facts that were compared and disagreed. */
  mismatched: readonly ("rating" | "recencyBucket" | "productRefFingerprint")[];
}

export type LocateOutcome =
  | {
      matched: true;
      mode: "channel-review-id";
      rowIndex: number;
      source: ReviewIdSource;
      matchCount: 1;
      secondary: SecondaryAssertionReport;
    }
  | {
      matched: false;
      reason: LocateFailureReason;
      /** How many candidate rows carried a matching id fingerprint (0 unless the failure came after matching). */
      matchCount: number;
      secondary?: SecondaryAssertionReport;
    };

const HEX64 = /^[0-9a-f]{64}$/;

/** Channel/account identifiers are compared after trimming; empty is never usable. */
function normalizeKeyPart(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Builds the identity key from a **raw** channel review id, fingerprinting it immediately. Returns `null` when
 * the channel, account, or id is missing or malformed — a malformed id must never become a key.
 *
 * The raw id is consumed here and never stored: only its fingerprint enters the returned key.
 */
export function buildReviewIdLocatorKey(
  channel: string | null | undefined,
  sellerAccountId: string | null | undefined,
  rawChannelReviewId: string | null | undefined,
): ReviewIdLocatorKey | null {
  const ch = normalizeKeyPart(channel);
  const account = normalizeKeyPart(sellerAccountId);
  if (!ch || !account) {
    return null;
  }
  const fingerprint = channelReviewIdFingerprint(rawChannelReviewId);
  return fingerprint === null ? null : { channel: ch, sellerAccountId: account, channelReviewIdFingerprint: fingerprint };
}

/**
 * Builds the identity key from an **already-fingerprinted** id — the normal path, since the backend hands the
 * runtime a `channelReviewIdFingerprint` and never the id itself. Rejects anything that is not lowercase 64-hex.
 */
export function reviewIdLocatorKeyFromFingerprint(
  channel: string | null | undefined,
  sellerAccountId: string | null | undefined,
  fingerprint: string | null | undefined,
): ReviewIdLocatorKey | null {
  const ch = normalizeKeyPart(channel);
  const account = normalizeKeyPart(sellerAccountId);
  const fp = (fingerprint ?? "").trim();
  if (!ch || !account || !HEX64.test(fp)) {
    return null;
  }
  return { channel: ch, sellerAccountId: account, channelReviewIdFingerprint: fp };
}

function compareSecondary(expected: SecondaryFacts | undefined, actual: SecondaryFacts | undefined): SecondaryAssertionReport {
  const asserted: ("rating" | "recencyBucket" | "productRefFingerprint")[] = [];
  const unavailable: ("rating" | "recencyBucket" | "productRefFingerprint")[] = [];
  const mismatched: ("rating" | "recencyBucket" | "productRefFingerprint")[] = [];
  const fields = ["rating", "recencyBucket", "productRefFingerprint"] as const;
  for (const field of fields) {
    const want = expected?.[field];
    const got = actual?.[field];
    if (want === undefined || want === null || got === undefined || got === null) {
      unavailable.push(field);
      continue;
    }
    asserted.push(field);
    if (want !== got) {
      mismatched.push(field);
    }
  }
  return { asserted, unavailable, mismatched };
}

/**
 * Resolves the one row whose channel review id matches the key.
 *
 * **Cardinality is decided across ALL rungs at once; rung precedence only chooses the label.** Every row
 * carrying the identity anywhere counts as a rival, no matter which rung exposed it — so a page where a
 * summary panel prints the review number as text while the real list row carries it in a `data-*` attribute
 * resolves to `MULTIPLE_MATCH`, not to whichever one a rung-first search happened to reach.
 *
 * Getting this backwards is the exact failure this milestone exists to prevent, so it is worth stating twice:
 * {@link REVIEW_ID_SOURCE_ORDER} determines the reported `source` for the single surviving row, and nothing
 * else. It never narrows the candidate set.
 */
export function locateRowByReviewId(
  key: ReviewIdLocatorKey,
  context: LocatorContext,
  candidates: readonly LiveRowCandidate[],
  expectedSecondary?: SecondaryFacts,
): LocateOutcome {
  if (!HEX64.test(key.channelReviewIdFingerprint) || !key.channel.trim() || !key.sellerAccountId.trim()) {
    return { matched: false, reason: "MALFORMED_KEY", matchCount: 0 };
  }
  if (
    normalizeKeyPart(context.channel) !== key.channel.trim() ||
    normalizeKeyPart(context.sellerAccountId) !== key.sellerAccountId.trim()
  ) {
    return { matched: false, reason: "CONTEXT_MISMATCH", matchCount: 0 };
  }

  // One pass over every rung: a row is a rival if it carries the identity ANYWHERE.
  const carriesIdentity = (row: LiveRowCandidate): boolean =>
    row.idFingerprints.some((f) => f.fingerprint === key.channelReviewIdFingerprint);
  const hits = candidates.filter(carriesIdentity);

  if (hits.length === 0) {
    return { matched: false, reason: "ZERO_MATCH", matchCount: 0 };
  }
  if (hits.length > 1) {
    return { matched: false, reason: "MULTIPLE_MATCH", matchCount: hits.length };
  }

  const row = hits[0]!;
  // Only now does the ladder order matter: it names where this row's identity came from.
  const source = REVIEW_ID_SOURCE_ORDER.find((candidateSource) =>
    row.idFingerprints.some(
      (f) => f.source === candidateSource && f.fingerprint === key.channelReviewIdFingerprint,
    ),
  );
  if (!source) {
    // Unreachable while `carriesIdentity` and this search read the same list, but a fabricated source would
    // otherwise leave `source` undefined — fail closed rather than report a match with no provenance.
    return { matched: false, reason: "ZERO_MATCH", matchCount: 0 };
  }

  const secondary = compareSecondary(expectedSecondary, row.secondary);
  if (secondary.mismatched.length > 0) {
    return { matched: false, reason: "SECONDARY_MISMATCH", matchCount: 1, secondary };
  }
  return { matched: true, mode: "channel-review-id", rowIndex: row.rowIndex, source, matchCount: 1, secondary };
}
