/**
 * **In-page (browser) port of `review-body-fingerprint/v1`** — the SAME normalization + SHA-256 the Node
 * {@link ./review-body-fingerprint.reviewBodyFingerprint} and the Java `ReviewBodyFingerprint` compute, but
 * runnable INSIDE `page.evaluate` so a live review row's body is fingerprinted in the page and only the 64-hex
 * result crosses back — the raw text NEVER leaves the page. Byte-parity to the Node/Java sides is proven by the
 * shared `contracts/review-fingerprint/v1/golden-vectors.json` in the real-browser rung.
 *
 * This module exports only STRINGS (browser JS source), so it stays browser-type-free and source-scannable, and
 * it can be concatenated into any census `page.evaluate` snippet. The regex sources are **ASCII-only** (`\\u`
 * escapes, never a literal exotic-whitespace character) so nothing is mangled in transport; the four PII
 * replacement tokens are literal Korean, exactly as the Node side emits them. In-page crypto is
 * `crypto.subtle.digest` (async), so the fingerprint function returns a Promise and callers must `await` it.
 * `crypto.subtle` requires a secure context (https / localhost / about:blank) — live NAVER is https.
 */

/**
 * Source of two in-page functions, byte-identical in behaviour to the Node normalizer/fingerprint:
 *  - `__awNormalizeForFingerprint(text)` → the normalized form (NFC → CRLF→\n → explicit-whitespace-collapse →
 *    trim → tokenize URL/email/mobile/landline/long-number). Uses a constructed `RegExp` for the whitespace
 *    class so the exotic code points are ASCII `\\u` escapes in this source, never literal characters.
 *  - `__awReviewBodyFingerprint(text)` → `Promise<string>` lowercase 64-hex SHA-256 of the UTF-8 normalized form.
 * Concatenate this into a `page.evaluate` string, then call the functions.
 */
export const IN_PAGE_FINGERPRINT_FN = `
function __awNormalizeForFingerprint(text) {
  var s = (text == null ? "" : String(text)).normalize("NFC").replace(/\\r\\n?/g, "\\n");
  s = s.replace(new RegExp("[\\t\\n\\u000b\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+", "gu"), " ");
  s = s.replace(/^ /, "").replace(/ $/, "");
  s = s.replace(/(?:https?:\\/\\/|www\\.)[^ ]+/gi, "[링크]");
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g, "[이메일]");
  s = s.replace(/01[016789][-. ]?\\d{3,4}[-. ]?\\d{4}/g, "[전화번호]");
  s = s.replace(/0\\d{1,2}[-. ]?\\d{3,4}[-. ]?\\d{4}/g, "[전화번호]");
  s = s.replace(/(?<!\\d)\\d{7,}(?!\\d)/g, "[번호]");
  return s;
}
async function __awReviewBodyFingerprint(text) {
  var norm = __awNormalizeForFingerprint(text);
  var bytes = new TextEncoder().encode(norm);
  var digest = await crypto.subtle.digest("SHA-256", bytes);
  var out = "";
  var view = new Uint8Array(digest);
  for (var i = 0; i < view.length; i++) { out += view[i].toString(16).padStart(2, "0"); }
  return out;
}`;
