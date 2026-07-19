/**
 * **`review-body-fingerprint/v1`** (pure, offline) — the collector half of the shared review-body fingerprint.
 *
 * A deterministic one-way fingerprint of a review body, byte-identical to the Java
 * `com.sellerops.common.ReviewBodyFingerprint`, proven by the shared
 * `contracts/review-fingerprint/v1/golden-vectors.json`. It is NOT the display redactor and NOT the reply-draft
 * fingerprint; this contract **owns its own regexes** (no `PiiMasker` reuse) so it can never drift when display
 * redaction changes. See `contracts/review-fingerprint/v1/SPEC.md`. `node:crypto` only; no clock, no I/O, and it
 * never logs its input.
 */
import { createHash } from "node:crypto";

/**
 * Explicit Unicode White_Space class — pinned literally rather than JS `\s`, because JS `\s` (which includes
 * U+FEFF) and Java `(?U)\s` (which includes U+0085) disagree and would silently diverge the two sides. U+FEFF
 * and zero-width U+200B are deliberately excluded, matching Java `(?U)\s`.
 */
const WHITESPACE = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
// Spec-owned volatile-span patterns (order-sensitive — see SPEC.md). After the collapse step the only
// whitespace is a single ASCII space, so `[^ ]+` and the `[-. ]?` separators are cross-language trivial.
const URL = /(?:https?:\/\/|www\.)[^ ]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MOBILE = /01[016789][-. ]?\d{3,4}[-. ]?\d{4}/g;
const LANDLINE = /0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}/g;
const LONG_NUMBER = /(?<!\d)\d{7,}(?!\d)/g;

/** Steps 1–5 of the spec: NFC → CRLF→\n → collapse → trim → tokenize volatile spans. Null/empty safe. */
export function normalizeForFingerprint(text: string): string {
  let s = (text ?? "").normalize("NFC").replace(/\r\n?/g, "\n");
  s = s.replace(WHITESPACE, " ");
  s = s.replace(/^ /, "").replace(/ $/, ""); // trim the single leading/trailing space
  s = s.replace(URL, "[링크]");
  s = s.replace(EMAIL, "[이메일]");
  s = s.replace(MOBILE, "[전화번호]");
  s = s.replace(LANDLINE, "[전화번호]");
  s = s.replace(LONG_NUMBER, "[번호]");
  return s;
}

/** Step 6: SHA-256 of the UTF-8 normalized form → lowercase hex (64). A one-way fingerprint, never the text. */
export function reviewBodyFingerprint(text: string): string {
  return createHash("sha256").update(normalizeForFingerprint(text), "utf8").digest("hex");
}
