/**
 * One-way fingerprint for the SellerOps **seller-account id** that a connection is
 * bound to. This is the link the connection registry has never had: the reply
 * request bundle carries `accountId` (a SellerOps backend UUID) while the registry
 * is keyed by `connectionId`, and nothing connected the two. Without it, "which
 * connection is this run about?" can only be asserted by the operator on every run,
 * which is exactly the weakness session verification exists to remove.
 *
 * WHY A FINGERPRINT AND NOT THE RAW ID:
 *  - `src/connection/types.ts` states the standing invariant that a connection
 *    record stores no raw identifier. A SellerOps UUID is not NAVER identity, but
 *    keeping one rule beats keeping two.
 *  - The digest is domain-separated, so a value from this contract can never be
 *    mistaken for — or collide with — a `review-id-fingerprint/v1` digest.
 *
 * HONEST LIMITATION: a UUID is not enumerable, so this digest genuinely conceals
 * the id. That is a property of the input, not of this function; do not reuse it
 * for small or guessable identifier spaces.
 *
 * Pure: no fs, no browser, no network, no clock.
 */

import { createHash } from "node:crypto";

/** Matches the reply request bundle's own `accountId` length ceiling. */
export const MAX_SELLER_ACCOUNT_ID_LENGTH = 64;

const DOMAIN = "seller-account-binding/v1\n";

// Deliberately narrow: an opaque backend identifier (a UUID today), not free text.
// Only printable ASCII qualifies — anything else means the caller handed us
// something other than an id, and the right answer is to refuse rather than to
// digest it. Every rejection fails CLOSED at the call site, never silently wrong.
const PRINTABLE_ASCII_ONLY = new RegExp("^[\\u0021-\\u007e]+$", "u");

/**
 * True when `raw` is a well-formed seller-account id: non-empty, within the length
 * ceiling, and printable ASCII only (no whitespace, no control characters).
 */
export function isWellFormedSellerAccountId(raw: string): boolean {
  return raw.length <= MAX_SELLER_ACCOUNT_ID_LENGTH && PRINTABLE_ASCII_ONLY.test(raw);
}

/**
 * Domain-separated SHA-256 of a seller-account id, lowercase hex. Returns `null`
 * for a malformed id rather than digesting garbage — a caller must not be able to
 * bind or compare against a value derived from an unvalidated input.
 */
export function sellerAccountFingerprint(raw: string | null | undefined): string | null {
  const value = (raw ?? "").normalize("NFC");
  if (!isWellFormedSellerAccountId(value)) return null;
  return createHash("sha256").update(DOMAIN + value, "utf8").digest("hex");
}
