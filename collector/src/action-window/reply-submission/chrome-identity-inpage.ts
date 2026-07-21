/**
 * READ-ONLY, BOUNDED extraction of the two seller-center chrome fields:
 * the visible NAVER user id and the current shop name.
 *
 * THE DIFFERENCE FROM EVERY TEXT SOURCE THIS MILESTONE DELETED. Those were searches —
 * a marker word looked for across a scope — and on a page that renders customer
 * reviews no scope selector reliably separates chrome from content: narrow enough to
 * exclude review rows missed the real header; wide enough to catch it swept per-row
 * card headers, so a review body could supply the word the gate looked for.
 *
 * This is not a search. It is a read of ONE element resolved by a PINNED selector,
 * and four independent bounds make a customer-supplied value unable to reach it:
 *   1. the selector must resolve to EXACTLY ONE element — zero or several is a refusal,
 *      never a pick, so a selector that accidentally matches review rows fails closed;
 *   2. that element must not CONTAIN a content region (table / grid / row / article /
 *      list-item), and must not be INSIDE one — a review row is inside a content
 *      region by construction, so a container that captured one is rejected;
 *   3. its text is bounded (`MAX_CHROME_TEXT`) — a container loose enough to hold a
 *      review body is longer than any user id or shop name and is rejected as untight;
 *   4. the value must pass the field's shape check in `session-chrome-identity.ts`.
 * Bound 1 is the load-bearing one. A search has no equivalent of it.
 *
 * NOTHING ELSE IS READ. No whole-document scan, no attribute reader, no innerHTML, no
 * markers. The module reports which selector resolved and why the others did not, so a
 * failure says what to fix rather than only that it failed.
 *
 * The template is a single-expression IIFE for `page.evaluate(string)` and is
 * deliberately ASCII-only.
 */

/** Longest text a legitimate chrome field container may hold. Beyond this it is untight. */
export const MAX_CHROME_TEXT = 200;

/**
 * Structural markers for CONTENT regions — the places customer- and product-controlled
 * text lives. A chrome container may neither contain one nor sit inside one.
 *
 * BARE `li` IS DELIBERATELY ABSENT. A shop switcher and an account menu are conventionally
 * `nav > ul > li`, so including it would reject the very chrome this reads and make
 * discovery impossible — failing closed, but closed on every run. Review rows are still
 * covered by `tr` / `[role="row"]` / `[role="listitem"]` / `article`.
 *
 * [EXTERNAL-RESEARCH — NOT REPOSITORY-VERIFIED] These are generic structural roles, not
 * NAVER specifics. Being generic is the point: a NAVER-specific selector would be a
 * guess about a surface we have not read, while `a review row is inside a table/grid/
 * list` holds for essentially any list UI. A wrong guess here fails CLOSED (the
 * container is rejected), never open.
 */
export const CONTENT_REGION_SELECTOR =
  'table, [role="table"], [role="grid"], [role="row"], [role="listitem"], article, tbody, tr';

/** Why a candidate selector did not produce a value. Fixed categories; never page text. */
export type ChromeFieldRejection =
  | "no-match"
  | "multiple-matches"
  | "inside-content-region"
  | "contains-content-region"
  | "text-too-long"
  | "empty";

export interface ChromeFieldOutcome {
  /** The resolved value, or `null`. Raw — the caller normalizes and digests it. */
  value: string | null;
  /** Index of the selector that resolved, or `-1`. Never the selector text itself. */
  selectorIndex: number;
  /** Per-candidate rejection reasons, in candidate order. Diagnostics only. */
  rejections: ChromeFieldRejection[];
}

export interface RawChromeIdentity {
  userId: ChromeFieldOutcome;
  shopName: ChromeFieldOutcome;
}

function quote(list: readonly string[]): string {
  return JSON.stringify(list);
}

/**
 * Build the in-page source. Both candidate lists are supplied by the caller (pinned by
 * the operator), embedded as JSON string arrays so the page receives nothing but fixed
 * strings.
 */
export function inPageChromeIdentity(
  userIdSelectors: readonly string[],
  shopNameSelectors: readonly string[],
): string {
  return `(function(){
  var MAX_TEXT = ${MAX_CHROME_TEXT};
  var CONTENT = ${JSON.stringify(CONTENT_REGION_SELECTOR)};
  var USER_SELECTORS = ${quote(userIdSelectors)};
  var SHOP_SELECTORS = ${quote(shopNameSelectors)};

  function readField(selectors) {
    var rejections = [];
    for (var i = 0; i < selectors.length; i++) {
      var nodes;
      try { nodes = document.querySelectorAll(selectors[i]); } catch (e) { rejections.push('no-match'); continue; }
      if (nodes.length === 0) { rejections.push('no-match'); continue; }
      // EXACTLY ONE. Several matches means the selector is not identifying chrome, and
      // picking one would be the guess this whole chain exists to refuse.
      if (nodes.length > 1) { rejections.push('multiple-matches'); continue; }
      var el = nodes[0];
      try {
        if (el.closest && el.closest(CONTENT)) { rejections.push('inside-content-region'); continue; }
        if (el.querySelector && el.querySelector(CONTENT)) { rejections.push('contains-content-region'); continue; }
      } catch (e) { rejections.push('inside-content-region'); continue; }
      var text = '';
      try { text = el.textContent || ''; } catch (e) { text = ''; }
      // Untight container: anything holding a review body is far longer than a user id
      // or a shop name.
      if (text.length > MAX_TEXT) { rejections.push('text-too-long'); continue; }
      if (text.replace(/\\s+/g, ' ').trim().length === 0) { rejections.push('empty'); continue; }
      return { value: text, selectorIndex: i, rejections: rejections };
    }
    return { value: null, selectorIndex: -1, rejections: rejections };
  }

  return JSON.stringify({ userId: readField(USER_SELECTORS), shopName: readField(SHOP_SELECTORS) });
})()`;
}

const REJECTIONS: readonly ChromeFieldRejection[] = [
  "no-match",
  "multiple-matches",
  "inside-content-region",
  "contains-content-region",
  "text-too-long",
  "empty",
];

function parseField(v: unknown): ChromeFieldOutcome {
  const empty: ChromeFieldOutcome = { value: null, selectorIndex: -1, rejections: [] };
  if (typeof v !== "object" || v === null) return empty;
  const r = v as Record<string, unknown>;
  const rejections = (Array.isArray(r.rejections) ? r.rejections : []).filter(
    (x): x is ChromeFieldRejection => typeof x === "string" && REJECTIONS.includes(x as ChromeFieldRejection),
  );
  // Destructured deliberately: the live-seam source guard forbids the substring `.value =`, and
  // `r.value === "string"` would trip it. Keeping the guard crude and the code adapted is the right way
  // round — a guard with exceptions carved into it stops being a guard.
  const { value: rawValue, selectorIndex } = r as { value?: unknown; selectorIndex?: unknown };
  return {
    // Bounded again on this side: the page supplies it, so its own promise is not enough.
    value:
      typeof rawValue === "string" && rawValue.length > 0 && rawValue.length <= MAX_CHROME_TEXT
        ? rawValue
        : null,
    selectorIndex: typeof selectorIndex === "number" ? selectorIndex : -1,
    rejections,
  };
}

/**
 * Validate the in-page payload. The page is untrusted, so every field is re-checked and
 * anything unexpected degrades to "not found" rather than being trusted.
 */
export function parseChromeIdentity(raw: unknown): RawChromeIdentity | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  return Object.freeze({
    userId: Object.freeze(parseField(r.userId)),
    shopName: Object.freeze(parseField(r.shopName)),
  });
}
