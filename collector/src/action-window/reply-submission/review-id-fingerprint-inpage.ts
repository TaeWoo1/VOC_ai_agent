/**
 * **In-page (browser) port of `review-id-fingerprint/v1`** — the SAME canonicalization, well-formedness rule,
 * and SHA-256 the Node {@link ./review-id-fingerprint} and the Java `ReviewIdFingerprint` compute, but runnable
 * INSIDE `page.evaluate`.
 *
 * This is the whole point of the port: a candidate review id read off a live NAVER row is fingerprinted **in the
 * page**, and only the 64-hex result crosses back into the collector. **The raw id never leaves the browser**,
 * so it cannot reach a log line, a report, or a persisted artifact even by accident.
 *
 * Exports only STRINGS (browser JS source), so the module stays browser-type-free and source-scannable, and can
 * be concatenated into any `page.evaluate` snippet. Regex sources are **ASCII-only** (`\\u` escapes, never a
 * literal exotic character). `crypto.subtle.digest` is async, so the fingerprint function returns a Promise and
 * callers must `await` it; `crypto.subtle` requires a secure context — live NAVER is https.
 */

/**
 * Source of three in-page functions, byte-identical in behaviour to the Node side:
 *  - `__awCanonicalizeReviewId(raw)` → NFC → drop zero-width → trim ends.
 *  - `__awIsWellFormedReviewId(canonical)` → non-empty, ≤120, no whitespace, no C0/C1 control.
 *  - `__awReviewIdFingerprint(raw)` → `Promise<string|null>` — lowercase 64-hex SHA-256 of
 *    `"review-id-fingerprint/v1\n" + canonical`, or `null` when the value is malformed.
 */
export const IN_PAGE_REVIEW_ID_FINGERPRINT_FN = `
var __AW_ID_WS = "\\t\\n\\u000b\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
function __awCanonicalizeReviewId(raw) {
  var s = (raw == null ? "" : String(raw)).normalize("NFC");
  s = s.replace(new RegExp("[\\u200b\\u200c\\u200d\\ufeff]", "gu"), "");
  s = s.replace(new RegExp("^[" + __AW_ID_WS + "]+|[" + __AW_ID_WS + "]+$", "gu"), "");
  return s;
}
function __awIsWellFormedReviewId(canonical) {
  if (!canonical || canonical.length > 120) { return false; }
  if (new RegExp("[" + __AW_ID_WS + "]", "u").test(canonical)) { return false; }
  return !new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]", "u").test(canonical);
}
async function __awReviewIdFingerprint(raw) {
  var canonical = __awCanonicalizeReviewId(raw);
  if (!__awIsWellFormedReviewId(canonical)) { return null; }
  var bytes = new TextEncoder().encode("review-id-fingerprint/v1\\n" + canonical);
  var digest = await crypto.subtle.digest("SHA-256", bytes);
  var out = "";
  var view = new Uint8Array(digest);
  for (var i = 0; i < view.length; i++) { out += view[i].toString(16).padStart(2, "0"); }
  return out;
}`;
