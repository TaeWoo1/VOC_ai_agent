/**
 * **The in-page half of the WING seller-identity assertion** — the one thing acquisition must know before it
 * reads a single review: *whose store is this browser logged into?*
 *
 * `docs/review_acquisition_aside_v2.md` §6 (PD-4) is the rule this implements: a display name alone is not
 * proof, so what is read here is the channel-native **업체코드** — Coupang's own vendor code, the same value a
 * seller types into SellerOps when they issue API credentials (`CredentialTemplates` `vendor_id`). Observed
 * 2026-09-12 in the WING shell chrome on both the front door and the review list, rendered as one span whose
 * own text is `업체코드 <code>`.
 *
 * ## Why a scan and not a selector
 *
 * The label appears MORE THAN ONCE (twice, both sittings), which is exactly what made the issuance walk park
 * on `LABEL_NOT_UNIQUE` when it needed a unique element to point at. Pointing is not what this does: it
 * collects every occurrence and requires them to **agree on one value**. Two elements printing the same code
 * is agreement, not ambiguity; two elements printing different codes is a screen this unit refuses to read.
 *
 * ## What crosses
 *
 * The raw code crosses to the Runner, which immediately digests it and compares (`wing-store-identity.ts`).
 * It is never logged, never stored, and never reaches an event, a view or the handoff. `distinct` and
 * `occurrences` are the log-safe counts. Nothing here clicks, types, navigates, or mutates the page.
 *
 * ES5 only and exported as a STRING, for the same reason `review-row-inpage.ts` is: the bundler's `keepNames`
 * rewrites arrow functions into a `__name(...)` call that does not exist inside the page.
 */

/** The label words that introduce the vendor code. Supplied generously; one more `indexOf` per element is free. */
export const WING_IDENTITY_LABELS: readonly string[] = Object.freeze(["업체코드", "업체 코드", "판매자ID", "판매자 ID"]);

/** What the page returned. `values` is raw and short-lived; everything else is log-safe. */
export interface WingIdentityReading {
  readonly labelHits: number;
  readonly distinct: number;
  /** The distinct codes found, in page order. Digested by the caller and dropped — never logged or stored. */
  readonly values: readonly string[];
}

/**
 * The scan. Every string it compares against is supplied here and JSON-embedded, so the page contributes
 * nothing but the code itself.
 */
export function buildWingIdentityScript(labels: readonly string[] = WING_IDENTITY_LABELS): string {
  return [
    "(function () {",
    "  var LABELS = " + JSON.stringify(labels) + ";",
    "  var all = document.querySelectorAll('*');",
    "  var hits = 0; var seen = []; ",
    "  for (var i = 0; i < all.length; i++) {",
    "    var el = all[i]; var own = ''; var cn = el.childNodes;",
    "    for (var c = 0; c < cn.length; c++) { if (cn[c].nodeType === 3) { own += cn[c].nodeValue; } }",
    "    own = own.replace(/\\s+/g, ' ').trim();",
    "    if (own.length === 0 || own.length > 60) { continue; }",
    "    for (var L = 0; L < LABELS.length; L++) {",
    "      var at = own.indexOf(LABELS[L]);",
    "      if (at < 0) { continue; }",
    "      hits++;",
    "      var rest = own.slice(at + LABELS[L].length).replace(/^[\\s:：]+/, '').trim();",
    "      if (rest.length === 0) { break; }",
    "      var token = rest.split(' ')[0];",
    "      if (token.length > 0 && seen.indexOf(token) < 0) { seen.push(token); }",
    "      break;",
    "    }",
    "  }",
    "  return { labelHits: hits, distinct: seen.length, values: seen };",
    "})()",
  ].join("\n");
}

/** Defensive shaping of whatever the page returned. An off-shape reading is an empty one, never a guess. */
export function sanitizeWingIdentityReading(raw: unknown): WingIdentityReading {
  const r = (raw ?? {}) as Record<string, unknown>;
  const values = Array.isArray(r["values"])
    ? (r["values"] as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
    : [];
  const n = (k: string): number => (typeof r[k] === "number" && Number.isFinite(r[k] as number) ? Math.max(0, Math.trunc(r[k] as number)) : 0);
  return { labelHits: n("labelHits"), distinct: values.length, values };
}

/**
 * **The sign-in wall check**, in the same family and for the same reason: it is page code, so it lives with
 * the other page code and is exported as a string.
 *
 * Measured on the real shell (2026-09-12): a signed-in WING prints 로그아웃 and holds no password input; a
 * sign-in wall is the inverse. Both halves are required — a page that merely lacks the sign-out word may
 * simply not have rendered its chrome yet, and calling that "signed out" would send a seller to log in when
 * they already are.
 */
export function buildWingAuthScript(): string {
  return [
    "(function () {",
    "  var d = document;",
    "  var pw = d.querySelectorAll('input[type=\"password\"]').length;",
    "  var all = d.querySelectorAll('*');",
    "  var out = 0; var inn = 0;",
    "  for (var i = 0; i < all.length; i++) {",
    "    var own = ''; var cn = all[i].childNodes;",
    "    for (var c = 0; c < cn.length; c++) { if (cn[c].nodeType === 3) { own += cn[c].nodeValue; } }",
    "    own = own.replace(/\\s+/g, ' ').trim();",
    "    if (own.length === 0 || own.length > 20) { continue; }",
    "    if (own.indexOf('로그아웃') >= 0) { out++; }",
    "    else if (own.indexOf('로그인') >= 0) { inn++; }",
    "  }",
    "  return { signedIn: pw === 0 && out > 0, passwordInputs: pw, signOutWords: out, signInWords: inn };",
    "})()",
  ].join("\n");
}
