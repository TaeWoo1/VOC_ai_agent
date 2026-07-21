/**
 * **Rung 6 of the discovery ladder — the review-list NETWORK RESPONSE.** Pure, offline, no Playwright: the CLI
 * hands this module a response body it observed passively, and gets back a set of one-way fingerprints.
 *
 * The response body of a review-list call is the most sensitive text in this whole milestone — it is the raw
 * review data. So the contract here is strict: **the body is consumed and discarded inside this function.**
 * Only `review-id-fingerprint/v1` digests and counts are returned. Nothing that comes out of here can be
 * turned back into review text, an order number, or an author.
 *
 * Like rung 5 (`page-state`), a network hit proves the identifier is **exposed by the surface**; it does not
 * say which rendered row it belongs to. The locator never consumes it as a row candidate — it is presence
 * evidence, reported as such.
 */
import { channelReviewIdFingerprint } from "./review-id-fingerprint";

/**
 * Id-shaped token patterns, kept byte-identical in meaning to the in-page rungs in
 * `review-id-probe-inpage.ts` (a parity test pins the two together): digit runs of 6..20, and
 * alphanumeric/`-`/`_` runs of 8..40.
 */
export const DIGIT_TOKEN = /[0-9]{6,20}/g;
export const ALNUM_TOKEN = /[A-Za-z0-9][A-Za-z0-9_-]{7,39}/g;

/** Caps so an enormous or hostile response can never turn the scan into an unbounded job. */
export const MAX_SCANNED_CHARS = 4_000_000;
export const MAX_SCANNED_TOKENS = 20_000;

export interface NetworkScanResult {
  /** Distinct one-way fingerprints of every id-shaped token found. Never the tokens themselves. */
  fingerprints: ReadonlySet<string>;
  /** How many distinct tokens were fingerprinted — a size signal for the run record, not a value. */
  tokenCount: number;
  /** Whether the cap truncated the scan, so a negative result is never reported as conclusive. */
  truncated: boolean;
}

/**
 * Fingerprints every id-shaped token in `text`. The input is never returned, logged, or retained.
 *
 * `truncated` matters: if the caps clipped the scan, "not found" means "not found in what was scanned", and
 * the caller must report it that way rather than as an absence.
 */
export function scanTextForReviewIdFingerprints(text: string | null | undefined): NetworkScanResult {
  const source = text ?? "";
  const truncatedByLength = source.length > MAX_SCANNED_CHARS;
  const scanned = truncatedByLength ? source.slice(0, MAX_SCANNED_CHARS) : source;

  const tokens = new Set<string>();
  let cappedByCount = false;
  for (const pattern of [DIGIT_TOKEN, ALNUM_TOKEN]) {
    // Fresh lastIndex per use — these are module-level /g regexes and must not carry state between calls.
    pattern.lastIndex = 0;
    for (const match of scanned.matchAll(pattern)) {
      if (tokens.size >= MAX_SCANNED_TOKENS) {
        cappedByCount = true;
        break;
      }
      tokens.add(match[0]);
    }
  }

  const fingerprints = new Set<string>();
  for (const token of tokens) {
    const fingerprint = channelReviewIdFingerprint(token);
    if (fingerprint !== null) {
      fingerprints.add(fingerprint);
    }
  }
  return { fingerprints, tokenCount: fingerprints.size, truncated: truncatedByLength || cappedByCount };
}

/**
 * Whether the target identity appears in an observed response body. Returns the scan alongside the verdict so
 * the caller can report a truncated scan honestly instead of claiming an absence it did not establish.
 */
export function networkResponseExposesReviewId(
  targetFingerprint: string,
  text: string | null | undefined,
): { present: boolean; scan: NetworkScanResult } {
  const scan = scanTextForReviewIdFingerprints(text);
  return { present: scan.fingerprints.has(targetFingerprint), scan };
}
