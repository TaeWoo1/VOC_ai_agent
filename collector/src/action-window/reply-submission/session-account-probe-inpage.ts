/**
 * READ-ONLY in-page store-identity probe — the live filler for the seam
 * `naver/account-signal-page.ts` has always described as "the seam a FUTURE live
 * Playwright boundary will fill". Until now the only filler was operator-typed
 * probe JSON.
 *
 * WHAT IT DOES: walks a bounded set of SPA state roots and inline JSON script tags
 * looking for allow-listed identity KEYS. That is
 * all. It does not click, focus, scroll, navigate, submit, mutate the DOM, or read
 * page text, form values, cookies, or storage.
 *
 * IT READS NO PAGE TEXT AT ALL, and that is a decision rather than an omission. An
 * earlier version derived the session gates from a bounded scan of the page CHROME's
 * text. On a page that renders customer-written reviews there is no scope selector
 * that reliably separates chrome from content: widening it to catch real seller
 * headers (`[class*="header"]`) also swept per-row card headers, so a review body
 * could supply the very word the gate looked for - fail-OPEN on the gate that guards
 * a PERMANENT binding, and fail-closed (an undiagnosable run-killer) in the other
 * direction. A signal an attacker can write is not a safety signal.
 *
 * WHY `ld+json` IS NOT READ AT ALL: an SEO blob is the weakest evidence on the page,
 * and telling it apart from a real `application/json` payload required reading the
 * tag's `type` attribute — which this module's own guard forbids, because an
 * attribute reader is one edit away from a text reader. Rather than carve an
 * exception into the guard, the source was dropped. It could never have counted as
 * trusted evidence anyway.
 *
 * WHY A BOUNDED WALK: SPA state can be enormous and self-referential. Node, depth,
 * and hit ceilings mean a hostile or merely huge page cannot hang the probe or
 * flood the caller; when a ceiling is hit the result says so, so a miss is never
 * silently reported as an absence (the [D-036] lesson, applied here before it can
 * bite).
 *
 * SAFETY CONTRACT: values leave the page ONLY inside `hits`, which the caller
 * consumes straight into `chooseAccountIdentity` -> `fingerprintHash`. Nothing here
 * is logged. The evidence view exposes key names and counts only.
 *
 * The template is a single-expression IIFE so it can be passed to
 * `page.evaluate(string)`, and it is deliberately ASCII-only.
 */

import { ACCOUNT_ID_KEYS, type AccountIdHit } from "./session-account-identity";

/** Ceilings for the in-page walk. Exported so tests pin them. */
export const MAX_STATE_NODES = 20_000;
// Deep enough for real SPA state. Cycles are already handled by the WeakSet and total
// work by MAX_STATE_NODES, so this ceiling only needs to stay under the engine's
// recursion limit — set at 12 it flipped `truncated` on ordinary Next.js/Apollo trees,
// and truncation fails the whole run closed.
export const MAX_STATE_DEPTH = 64;
export const MAX_PROBE_HITS = 200;
/** Inline JSON scripts larger than this are skipped rather than parsed. */
export const MAX_INLINE_JSON_CHARS = 4_000_000;

/**
 * SPA state roots — the trusted sources. A key found here is real application state.
 * `inline-json` / `inline-ld-json` are page markup and are deliberately NOT in this set.
 */
export const TRUSTED_ROOT_LABELS: readonly string[] = [
  "__PRELOADED_STATE__",
  "__NEXT_DATA__",
  "__NUXT__",
  "__INITIAL_STATE__",
  "__APOLLO_STATE__",
];

/** Every label the probe may legitimately emit. Anything else is page-supplied and dropped. */
export const ROOT_LABELS: readonly string[] = [...TRUSTED_ROOT_LABELS, "inline-json"];

/** Raw shape the in-page script returns (as JSON text). */
export interface RawAccountProbeResult {
  hits: AccountIdHit[];
  /** True when a node/depth/hit ceiling stopped the walk early. */
  truncated: boolean;
  /** How many state roots were found and walked. Diagnostics only. */
  rootsWalked: number;
  /**
   * Which roots were walked, in order. Non-sensitive: these are global variable names
   * and the literal `inline-json`, never page content. Load-bearing for judging a
   * diagnostic run — a key found in `__PRELOADED_STATE__` is very different evidence
   * from the same key in an SEO `ld+json` tag.
   */
  rootLabels: string[];
}

/**
 * Build the in-page probe source. The allow-listed key names are embedded as a
 * JSON literal so the page never receives anything but a fixed string list.
 */
export function inPageAccountIdentityProbe(): string {
  const keys = JSON.stringify(ACCOUNT_ID_KEYS);
  return `(function(){
  var KEYS = ${keys};
  var MAX_NODES = ${MAX_STATE_NODES};
  var MAX_DEPTH = ${MAX_STATE_DEPTH};
  var MAX_HITS = ${MAX_PROBE_HITS};
  var MAX_JSON = ${MAX_INLINE_JSON_CHARS};
  var wanted = Object.create(null);
  for (var k = 0; k < KEYS.length; k++) wanted[KEYS[k]] = true;
  // The SAME shape the caller enforces, applied here so the hit budget is never spent
  // on values that would be discarded anyway - which would report a truncated view of
  // a page we had in fact read completely, and truncation fails the run closed.
  var VALUE_SHAPE = /^[A-Za-z0-9_-]{2,40}$/;

  var hits = [];
  var seenPairs = Object.create(null);
  var truncated = false;
  var nodes = 0;
  var seen = typeof WeakSet === 'function' ? new WeakSet() : null;

  function scalar(v) {
    if (typeof v === 'string') return v;
    // Safe integers only. Beyond 2^53 the parse has ALREADY rounded, so the string we
    // could emit is not the store's id - it is a near-miss that would digest to a
    // stable, confidently WRONG fingerprint. Refusing is the only honest answer.
    if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
    return null;
  }

  function walk(value, depth) {
    if (value === null || typeof value !== 'object') return;
    if (depth > MAX_DEPTH) { truncated = true; return; }
    if (nodes >= MAX_NODES) { truncated = true; return; }
    if (seen) { if (seen.has(value)) return; seen.add(value); }
    nodes++;
    var keys;
    try { keys = Object.keys(value); } catch (e) { return; }
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var child;
      // A getter can throw or have side effects; skip anything that does.
      try { child = value[key]; } catch (e) { continue; }
      if (wanted[key] === true) {
        var s = scalar(child);
        if (s !== null && VALUE_SHAPE.test(s)) {
          // DISTINCT pairs: a state tree repeating one store's id must not exhaust
          // the budget and push a second store's id out. Truncation fails the run
          // closed, so a redundant page must not look like a truncated one.
          var pair = key + ' ' + s;
          if (seenPairs[pair] !== true) {
            if (Object.keys(seenPairs).length >= MAX_HITS) { truncated = true; }
            else { seenPairs[pair] = true; hits.push({ key: key, value: s, root: currentRoot }); }
          }
        }
      }
      walk(child, depth + 1);
    }
  }

  var roots = [];
  var rootLabels = [];
  var currentRoot = '';
  var ROOT_NAMES = ['__PRELOADED_STATE__', '__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__'];
  for (var r = 0; r < ROOT_NAMES.length; r++) {
    try {
      var root = window[ROOT_NAMES[r]];
      if (root && typeof root === 'object') { roots.push(root); rootLabels.push(ROOT_NAMES[r]); }
    } catch (e) { /* cross-origin or throwing getter */ }
  }
  try {
    var scripts = document.querySelectorAll('script[type="application/json"]');
    var jsonBudget = MAX_JSON;
    for (var s = 0; s < scripts.length; s++) {
      var text = scripts[s].textContent || '';
      if (text.length === 0) continue;
      // AGGREGATE budget: per-script alone leaves the total unbounded across many tags.
      if (text.length > jsonBudget) { truncated = true; continue; }
      jsonBudget -= text.length;
      try {
        var parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') { roots.push(parsed); rootLabels.push('inline-json'); }
      } catch (e) { /* not JSON after all */ }
    }
  } catch (e) { /* querySelectorAll unavailable */ }

  for (var w = 0; w < roots.length; w++) { currentRoot = rootLabels[w]; walk(roots[w], 0); }

  return JSON.stringify({
    hits: hits,
    truncated: truncated,
    rootsWalked: roots.length,
    rootLabels: rootLabels
  });
})()`;
}

function isHit(v: unknown): v is AccountIdHit {
  if (typeof v !== "object" || v === null) return false;
  // Destructured deliberately: the live-seam source guard forbids the substring
  // `.value =`, and `typeof r.value === "string"` would trip it. Keeping the guard
  // crude and the code adapted is the right way round — a guard with exceptions
  // carved into it stops being a guard.
  const { key, value } = v as { key?: unknown; value?: unknown };
  return typeof key === "string" && typeof value === "string";
}

/**
 * Validate the in-page result. The page is untrusted, so every field is checked and
 * anything unexpected degrades to the conservative value (`truncated: true`) rather
 * than being trusted or thrown away silently. Returns `null` only when the payload
 * is not parseable at all.
 */
export function parseAccountProbeResult(raw: unknown): Readonly<RawAccountProbeResult> | null {
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

  const rawHits = Array.isArray(r.hits) ? r.hits : [];
  const hits = rawHits.filter(isHit).slice(0, MAX_PROBE_HITS);
  // A dropped or over-long hit list means we did not see everything the page had.
  const lostHits = hits.length !== rawHits.length;

  // FROZEN for the same reason the session signals are: `sellerShellSignal` is derived entirely from
  // `rootsWalked`, so a mutable probe leaves page text one assignment away from a gate — which is exactly
  // the path this milestone closed three times. Freezing makes that edit throw instead of ship.
  return Object.freeze({
    // DEEP: freezing only the array left `hits[0].key = pinnedKey` able to relabel arbitrary page text
    // under the operator's pinned key — a wrong PERMANENT binding.
    // PICKED, not spread, and the root ALLOW-LISTED. The page supplies this object, so spreading it
    // carried every extra property through, and an unvalidated `root` put arbitrary page text — a review
    // body, a customer name — into a record the operator reads and this tool persists.
    hits: Object.freeze(
      hits.map((h) =>
        Object.freeze({
          key: h.key,
          value: h.value,
          ...(typeof h.root === "string" && ROOT_LABELS.includes(h.root) ? { root: h.root } : {}),
        }),
      ),
    ) as AccountIdHit[],
    truncated: r.truncated === true || lostHits || !Array.isArray(r.hits),
    rootsWalked: typeof r.rootsWalked === "number" && r.rootsWalked >= 0 ? r.rootsWalked : 0,
    rootLabels: Object.freeze(
      (Array.isArray(r.rootLabels) ? r.rootLabels : []).filter(
        (x): x is string => typeof x === "string" && ROOT_LABELS.includes(x),
      ),
    ) as string[],
  });
}
