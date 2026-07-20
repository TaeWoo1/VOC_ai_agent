/**
 * **`review-id-fingerprint/v1`** (pure, offline) — the collector half of the shared **channel review id**
 * fingerprint.
 *
 * A deterministic one-way fingerprint of a channel-side review identifier (for NAVER SmartStore: the
 * `리뷰글번호` column of the review export, which lands untransformed in `reviews.external_id`). It exists for
 * exactly one reason: **so two sources can be proven to hold the same review id without the raw id ever being
 * printed, logged, or persisted outside the row it already belongs to.**
 *
 * Byte-identical to the Java `com.sellerops.common.ReviewIdFingerprint` and to the in-page port
 * {@link ./review-id-fingerprint-inpage}, proven by `contracts/review-id-fingerprint/v1/golden-vectors.json`.
 *
 * **This is NOT the review-*body* fingerprint** (`review-body-fingerprint/v1`) and NOT the reply-draft
 * fingerprint (`review-reply-v1`). The domain-separation prefix guarantees the same string can never produce
 * the same digest under two contracts.
 *
 * **Honest limitation (do not overstate).** A NAVER `리뷰글번호` is a 10-digit number — a space small enough to
 * enumerate. This fingerprint is therefore a **leak-hygiene** device (a raw id can never escape by accident
 * through a log line, a report, or a persisted artifact), **not** a privacy guarantee against someone who
 * already holds the id space. It is stated here so no caller mistakes it for one.
 *
 * `node:crypto` only; no clock, no I/O; never logs its input.
 */
import { createHash } from "node:crypto";

/**
 * Explicit Unicode White_Space class — pinned literally rather than JS `\s`, for the same Java/JS parity reason
 * as `review-body-fingerprint/v1`. Used only to trim the ends and to reject ids containing whitespace. Every
 * exotic code point below is a `\u` escape, never a literal character, so this source stays ASCII-only and
 * cannot be mangled in transport (the same rule the in-page port must follow).
 */
const WHITESPACE_CLASS = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const TRIM = new RegExp(`^[${WHITESPACE_CLASS}]+|[${WHITESPACE_CLASS}]+$`, "gu");
const ANY_WHITESPACE = new RegExp(`[${WHITESPACE_CLASS}]`, "u");
/** Zero-width joiners/marks: invisible in a DOM read, so they must not change identity. */
const ZERO_WIDTH = new RegExp("[\\u200b\\u200c\\u200d\\ufeff]", "gu");
/** C0/C1 controls — never legitimate in an identifier; their presence means the value was mis-read. */
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]", "u");

/** `reviews.external_id` is `varchar(120)`; anything longer cannot be the imported id. */
export const MAX_CHANNEL_REVIEW_ID_LENGTH = 120;

/** Domain separation — the same bytes under another contract can never collide with this one. */
const DOMAIN = "review-id-fingerprint/v1\n";

/**
 * Canonical form: NFC → drop zero-width marks → trim the ends. Deliberately **no** case folding, **no**
 * internal-whitespace collapsing, and **no** numeric coercion — an identifier is compared as written, and a
 * value that needs more than this is treated as malformed rather than quietly repaired.
 */
export function canonicalizeChannelReviewId(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFC").replace(ZERO_WIDTH, "").replace(TRIM, "");
}

/**
 * Whether a canonicalized value is usable as an identity key: non-empty, within the persisted column width, no
 * embedded whitespace, no control characters. Fails **closed** — an unusable id must never be fingerprinted and
 * compared, because a match on a mis-read value is worse than no match at all.
 */
export function isWellFormedChannelReviewId(canonical: string): boolean {
  return (
    canonical.length > 0 &&
    canonical.length <= MAX_CHANNEL_REVIEW_ID_LENGTH &&
    !ANY_WHITESPACE.test(canonical) &&
    !CONTROL.test(canonical)
  );
}

/**
 * SHA-256 of the UTF-8 bytes of `DOMAIN + canonical` → lowercase 64-hex. Returns `null` for a malformed id, so
 * a caller can never accidentally fingerprint-and-match garbage.
 */
export function channelReviewIdFingerprint(raw: string | null | undefined): string | null {
  const canonical = canonicalizeChannelReviewId(raw);
  if (!isWellFormedChannelReviewId(canonical)) {
    return null;
  }
  return createHash("sha256").update(DOMAIN + canonical, "utf8").digest("hex");
}
