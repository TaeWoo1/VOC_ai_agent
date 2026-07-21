/**
 * Operator-calibrated selector DERIVATION, in the page.
 *
 * The operator clicks the visible user-id element, then the visible shop-name element.
 * Both clicks are intercepted in the CAPTURE phase and cancelled, so nothing on NAVER
 * fires: the runtime learns which element they meant without anything being activated.
 *
 * DERIVATION IS FROM THE RETAINED ELEMENT, NEVER FROM ITS TEXT. That distinction is the
 * whole reason this approach is safe where the deleted text sources were not. Searching
 * the document for a value finds every copy of it, including one a customer wrote in a
 * review; walking UP from the element the operator actually clicked cannot, because it
 * starts from a node no customer can choose.
 *
 * PREFERENCE ORDER, strongest first:
 *   1. `element-id`      - a stable-looking `id`
 *   2. `test-id`         - `data-testid` / `data-test` / `data-qa`
 *   3. `aria-label`      - an accessible name, which product teams rarely churn
 *   4. `chrome-ancestry` - a landmark ancestor (header/nav/aside/banner/navigation, or
 *                          one with a stable id) plus a bounded structural path
 *   5. `class-path`      - WEAK; only when the classes do not look generated
 *   6. `document-path`   - WEAKEST; positional from the body
 * Anything containing a hash-like or digit-heavy class is treated as generated and is
 * never used for 1-5.
 *
 * The template is a single-expression IIFE for `page.evaluate(string)` and is ASCII-only.
 */

/** Attribute marking the element the operator picked for a field. */
export const USER_PICK_ATTRIBUTE = "data-aw-sel-user";
export const SHOP_PICK_ATTRIBUTE = "data-aw-sel-shop";

/**
 * Every event the pick interceptor cancels.
 *
 * `click` alone is not enough: a control that activates on `pointerdown`/`mousedown` has
 * already run by the time `click` arrives, so cancelling `click` does not undo it. The
 * operator is told nothing on NAVER fires, and that has to be true of the whole sequence.
 */
export const INTERCEPTED_EVENTS = ["pointerdown", "mousedown", "click"] as const;

/** How far up the tree derivation may walk before giving up on a landmark. */
export const MAX_ANCESTRY_DEPTH = 8;

/**
 * Arms a capture-phase, single-shot click interceptor for one field. The listener
 * cancels the event (`preventDefault` + `stopImmediatePropagation`) so the operator's
 * click marks the element WITHOUT activating anything on NAVER, then removes itself.
 */
export function armSelectorPick(attribute: string): string {
  return `(function(){
  var ATTR = ${JSON.stringify(attribute)};
  var EVENTS = ${JSON.stringify(INTERCEPTED_EVENTS)};
  function unarm() {
    if (window.__awSelHandler) {
      for (var i = 0; i < EVENTS.length; i++) {
        document.removeEventListener(EVENTS[i], window.__awSelHandler, true);
        window.removeEventListener(EVENTS[i], window.__awSelHandler, true);
      }
      window.__awSelHandler = null;
    }
  }
  unarm();
  window.__awSelPicked = false;
  var handler = function(ev) {
    var el = ev.target;
    if (!el || el.nodeType !== 1) { return; }
    ev.preventDefault();
    ev.stopImmediatePropagation();
    // Mark on the FIRST intercepted event, then keep cancelling the rest of the
    // sequence. A control that activates on pointerdown/mousedown is already gone by
    // the time 'click' arrives, so cancelling only 'click' does not undo it.
    if (!window.__awSelPicked) {
      el.setAttribute(ATTR, '1');
      window.__awSelPicked = true;
    }
  };
  window.__awSelHandler = handler;
  for (var i = 0; i < EVENTS.length; i++) {
    // Registered on WINDOW as well as document: a page listener on window with
    // capture:true runs BEFORE document's, and stopImmediatePropagation cannot reach
    // backwards to a listener that already ran.
    window.addEventListener(EVENTS[i], handler, true);
    document.addEventListener(EVENTS[i], handler, true);
  }
  return true;
})()`;
}

/** True once the operator's click has been captured for the armed field. */
export const SELECTOR_PICKED = `(function(){ return window.__awSelPicked === true; })()`;

/** Removes every marker and any surviving listener. Leaves the DOM as it was found. */
export const SELECTOR_PICK_TEARDOWN = `(function(){
  if (window.__awSelHandler) {
    var EV = ${JSON.stringify(INTERCEPTED_EVENTS)};
    for (var e = 0; e < EV.length; e++) {
      document.removeEventListener(EV[e], window.__awSelHandler, true);
      window.removeEventListener(EV[e], window.__awSelHandler, true);
    }
    window.__awSelHandler = null;
  }
  window.__awSelPicked = false;
  var attrs = [${JSON.stringify(USER_PICK_ATTRIBUTE)}, ${JSON.stringify(SHOP_PICK_ATTRIBUTE)}];
  var n = 0;
  for (var a = 0; a < attrs.length; a++) {
    var marked = document.querySelectorAll('[' + attrs[a] + ']');
    for (var i = 0; i < marked.length; i++) { marked[i].removeAttribute(attrs[a]); n++; }
  }
  return n;
})()`;

/**
 * Derives candidate selectors for the element marked with `attribute`.
 *
 * Every candidate is verified to resolve to EXACTLY that element before it is returned,
 * so a returned spec is one that already worked once — the caller then re-validates it
 * independently, and again after a re-render.
 */
export function deriveSelectorsFor(attribute: string): string {
  return `(function(){
  var ATTR = ${JSON.stringify(attribute)};
  var MAX_DEPTH = ${MAX_ANCESTRY_DEPTH};
  var marked = document.querySelectorAll('[' + ATTR + ']');
  if (marked.length !== 1) { return JSON.stringify({ ok: false, reason: marked.length === 0 ? 'no-pick' : 'multiple-picks' }); }
  var target = marked[0];
  // The value the element DISPLAYS. A selector must never embed it: an account chip
  // commonly carries aria-label="<user id> account menu", and storing that selector
  // would persist the user id into a spec file whose whole promise is that it holds
  // locations, not identities.
  // Compared with ALL whitespace removed, because the two sides are formatted by
  // different authors: an attribute may read "<id>  account" while the text reads
  // "<id> account".
  var shown = ((target.textContent || '') + '').replace(/\\s+/g, '').toLowerCase();
  function carriesValue(v) {
    var attr = String(v).replace(/\\s+/g, '').toLowerCase();
    if (!attr) { return false; }
    // BOTH directions. The one-way form ("does the attribute contain the element's
    // ENTIRE text") fires only when the element renders the bare value; real chrome
    // decorates it ("<id>님", "<id> 계정", a caret span), so the decorated text is not a
    // substring of the attribute and an aria-label holding the bare account name passed.
    // This is defence in depth only — the authoritative check is Node-side, in
    // withoutIdentityBearingSpecs, which sees BOTH fields' values and which a hostile
    // page cannot answer.
    if (shown.length >= 2 && attr.indexOf(shown) >= 0) { return true; }
    return shown.length >= 2 && shown.indexOf(attr) >= 0 && attr.length >= 2;
  }

  function esc(s) {
    if (window.CSS && window.CSS.escape) { return window.CSS.escape(s); }
    return String(s).replace(/[^A-Za-z0-9_-]/g, '\\\\$&');
  }
  // A generated class: long hex-ish runs, 3+ digit runs, or CSS-module/emotion shapes.
  function generated(token) {
    return /[0-9a-f]{6,}/i.test(token) || /[0-9]{3,}/.test(token) || /__|--[a-z0-9]{4,}/i.test(token);
  }
  function stableId(el) {
    var id = el.id || '';
    if (!id || generated(id)) { return null; }
    // Same rule: an id like 'user-<account>' would smuggle the value into the spec.
    if (carriesValue(id)) { return null; }
    return id;
  }
  function attrSel(el, name) {
    var v = el.getAttribute ? el.getAttribute(name) : null;
    if (!v || v.length > 80 || generated(v)) { return null; }
    if (carriesValue(v)) { return null; }
    return '[' + name + '="' + v.replace(/["\\\\]/g, '\\\\$&') + '"]';
  }
  function nth(el) {
    var p = el.parentElement;
    if (!p) { return el.tagName.toLowerCase(); }
    var same = [];
    for (var i = 0; i < p.children.length; i++) {
      if (p.children[i].tagName === el.tagName) { same.push(p.children[i]); }
    }
    if (same.length === 1) { return el.tagName.toLowerCase(); }
    return el.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
  }
  function classSel(el) {
    var cls = (el.className && typeof el.className === 'string') ? el.className.split(/\\s+/) : [];
    var keep = [];
    for (var i = 0; i < cls.length; i++) {
      if (cls[i] && !generated(cls[i])) { keep.push('.' + esc(cls[i])); }
    }
    return keep.length > 0 ? el.tagName.toLowerCase() + keep.join('') : null;
  }
  function landmark(el) {
    var LM = 'header, nav, aside, [role="banner"], [role="navigation"], [role="complementary"]';
    var cur = el.parentElement, depth = 0;
    while (cur && depth < MAX_DEPTH) {
      var id = stableId(cur);
      if (id) { return '#' + esc(id); }
      try { if (cur.matches && cur.matches(LM)) { return nth(cur) === cur.tagName.toLowerCase() ? cur.tagName.toLowerCase() : null; } } catch (e) { /* ignore */ }
      cur = cur.parentElement; depth++;
    }
    return null;
  }
  function pathFrom(root, el) {
    var parts = [], cur = el, depth = 0;
    while (cur && cur !== root && depth < MAX_DEPTH) { parts.unshift(nth(cur)); cur = cur.parentElement; depth++; }
    return cur === root ? parts.join(' > ') : null;
  }

  var candidates = [];
  function add(strategy, selector) {
    if (!selector || selector.length > 300) { return; }
    var found;
    try { found = document.querySelectorAll(selector); } catch (e) { return; }
    // Must already resolve to exactly the element the operator picked.
    if (found.length !== 1 || found[0] !== target) { return; }
    for (var i = 0; i < candidates.length; i++) { if (candidates[i].selector === selector) { return; } }
    candidates.push({ strategy: strategy, selector: selector });
  }

  var id = stableId(target);
  if (id) { add('element-id', '#' + esc(id)); }
  var testAttrs = ['data-testid', 'data-test', 'data-qa'];
  for (var t = 0; t < testAttrs.length; t++) { add('test-id', attrSel(target, testAttrs[t])); }
  add('aria-label', attrSel(target, 'aria-label'));

  var lm = landmark(target);
  if (lm) {
    var anchor = document.querySelector(lm);
    if (anchor) {
      var rel = pathFrom(anchor, target);
      if (rel) { add('chrome-ancestry', lm + ' > ' + rel); }
      var cs = classSel(target);
      if (cs) { add('chrome-ancestry', lm + ' ' + cs); }
    }
  }
  add('class-path', classSel(target));
  var abs = pathFrom(document.body, target);
  if (abs) { add('document-path', 'body > ' + abs); }

  return JSON.stringify({ ok: true, candidates: candidates });
})()`;
}

export type DeriveFailure = "no-pick" | "multiple-picks" | "unparseable";

export interface DerivedCandidate {
  strategy: string;
  selector: string;
}

export type DeriveResult =
  | { ok: true; candidates: DerivedCandidate[] }
  | { ok: false; reason: DeriveFailure };

/** Validate the in-page payload; the page is untrusted so every field is re-checked. */
export function parseDeriveResult(raw: unknown): DeriveResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "unparseable" };
    }
  }
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unparseable" };
  const r = value as Record<string, unknown>;
  if (r.ok !== true) {
    const reason = r.reason;
    return {
      ok: false,
      reason: reason === "no-pick" || reason === "multiple-picks" ? reason : "unparseable",
    };
  }
  const raws = Array.isArray(r.candidates) ? r.candidates : [];
  const candidates: DerivedCandidate[] = [];
  for (const entry of raws) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const { strategy, selector } = e as { strategy?: unknown; selector?: unknown };
    if (typeof strategy !== "string" || typeof selector !== "string") continue;
    if (selector.length === 0 || selector.length > 300) continue;
    candidates.push({ strategy, selector });
  }
  return { ok: true, candidates };
}
