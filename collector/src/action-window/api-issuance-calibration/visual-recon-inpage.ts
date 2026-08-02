/**
 * **API-center VISUAL RECON — the in-page REDACTION + CENSUS scripts (value-free OUTPUT).**
 *
 * The browser-side half of `src/cli/capture-api-center-visual.ts`. Three string IIFEs:
 *  - {@link buildRedactionScript}(`"apply"`) — draw an opaque overlay over every sensitive region, then return a
 *    per-frame {@link RawRedactionReport} of how many sensitive elements were DETECTED vs COVERED.
 *  - {@link buildRedactionScript}(`"verify"`) — re-run the SAME detection WITHOUT drawing new overlays and
 *    confirm each detected element is still covered by an intact opaque overlay (catches a page that re-rendered
 *    or a stylesheet that tried to hide the overlays). Same report shape.
 *  - {@link EXTRACT_VISUAL_CONTROLS} — a STRUCTURE-ONLY census of interactive controls (tag / role / input type /
 *    ancestry tag chain / sibling position / bounding box / stable-attribute names+values used only to build a
 *    match count). No text/value is ever read for the census.
 *
 * **What LEAVES the page is integers + booleans + (for the census) structural attribute values screened by the
 * frozen Node gate — NEVER element text, a field value, innerHTML, a URL, or a screenshot.** The redaction pass
 * *does* read element TEXT, but SOLELY to decide whether a leaf is a stray identifier that must be covered; the
 * matched text is never returned — only a per-category count. This is the one intentional text read and it is
 * confined to the `identity_text` detector (documented like `observe-api-center`'s single `new Date()`).
 *
 * String IIFEs (never passed functions): tsx/esbuild instruments named/module functions with a `__name` helper
 * absent in the page, so a serialized function throws `ReferenceError: __name`. Kept ES5-plain (no arrow / `Set`
 * / spread) so they run across page runtimes. The Node module `./visual-recon.ts` decides what any of this means.
 */
import { REDACTION_CATEGORIES } from "./visual-recon";

/** Data attribute marking a redaction overlay so apply/verify can find + integrity-check them (never content). */
export const REDACT_OVERLAY_ATTR = "data-sellerops-redact";

/** Fresh `{cat: 0}` object literal source for the report counters (all categories initialised to 0). */
function zeroCountsLiteral(): string {
  return "{ " + REDACTION_CATEGORIES.map((c) => JSON.stringify(c) + ": 0").join(", ") + " }";
}

export type RedactionMode = "apply" | "verify";

/**
 * Build the redaction IIFE for a mode. `apply` draws opaque overlays over every detected sensitive element and
 * reports covered === detected by construction; `verify` draws nothing and reports covered only for elements a
 * still-intact opaque overlay actually covers, so a post-screenshot regression surfaces as covered < detected.
 *
 * Detection categories (structure/attribute driven, plus the one `identity_text` text scan):
 *  - form_field: input / textarea / select
 *  - password: input[type=password]
 *  - readonly_or_code: [readonly] / [disabled] / code / pre
 *  - credential_area: a node whose id/name/class/aria-label/title mentions client-id / secret / application-id
 *  - copy_linked: a "복사/copy" control + its adjacent value box
 *  - identity_text: a leaf whose TEXT is an email / long numeric id / secret-like token (counted, never emitted)
 *  - chrome_region: header / [role=banner] / footer / [role=contentinfo] (logged-in account + store identity)
 */
export function buildRedactionScript(mode: RedactionMode): string {
  return `(function () {
  /* visual-recon-redaction (${mode}) */
  var MODE = ${JSON.stringify(mode)};
  var OVERLAY_ATTR = ${JSON.stringify(REDACT_OVERLAY_ATTR)};
  var detected = ${zeroCountsLiteral()};
  var covered = ${zeroCountsLiteral()};

  if (!document.body) {
    return { bodyPresent: false, overlayCount: 0, integrityOk: true, detected: detected, covered: covered };
  }
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var VW = window.innerWidth || 0, VH = window.innerHeight || 0;

  /* apply starts from a clean slate: remove any overlays left by a prior apply on THIS document (a retry after
     a HALT, or a same-page re-capture) so overlays never accumulate and a stale one can't linger. verify never
     removes overlays — it only inspects the ones apply drew. */
  if (MODE === 'apply') {
    var stale = slice(document.querySelectorAll('[' + OVERLAY_ATTR + ']'));
    for (var si = 0; si < stale.length; si++) { if (stale[si].parentNode) { stale[si].parentNode.removeChild(stale[si]); } }
  }

  function isOpaqueOverlay(o) {
    if (!o || !o.getAttribute || o.getAttribute(OVERLAY_ATTR) == null) { return false; }
    var cs = window.getComputedStyle(o);
    if (!cs) { return false; }
    if (cs.display === 'none' || cs.visibility === 'hidden') { return false; }
    if (parseFloat(cs.opacity || '1') < 0.999) { return false; }
    var bg = cs.backgroundColor || '';
    if (bg === 'transparent' || /rgba\\([^)]*,\\s*0(\\.0+)?\\)\\s*$/.test(bg)) { return false; }
    return true;
  }

  /* Is this node one of OUR overlays (or inside one)? Used to prove an overlay is the TOP-MOST paint. */
  function isOverlayNode(node) {
    while (node) {
      if (node.getAttribute && node.getAttribute(OVERLAY_ATTR) != null) { return true; }
      node = node.parentElement;
    }
    return false;
  }

  /* COVERAGE PROOF (fixes geometry-only blindness): a rect is covered ONLY when, at every in-viewport sample
     point, the TOP-MOST painted element (elementFromPoint) is one of our overlays — so a higher-z popup that
     paints above a body-level overlay is NOT mistaken for covered. A rect fully OUTSIDE the viewport is not in
     the screenshot, so it is trivially covered. A rect with no in-viewport sample point → treat as NOT covered
     (fail-closed) unless it was outside the viewport entirely. */
  function hittestCovered(r) {
    var xs = [r.left + 2, r.left + r.width / 2, r.right - 2];
    var ys = [r.top + 2, r.top + r.height / 2, r.bottom - 2];
    var anyInView = false;
    for (var a = 0; a < xs.length; a++) {
      for (var b = 0; b < ys.length; b++) {
        var x = xs[a], y = ys[b];
        if (x < 0 || y < 0 || x > VW || y > VH) { continue; }
        anyInView = true;
        if (!isOverlayNode(document.elementFromPoint(x, y))) { return false; }
      }
    }
    /* Reached the end: either every in-view sample was an overlay, or the rect was wholly offscreen (nothing
       in-view to leak). Both mean the visible pixels are covered. anyInView is read to make that explicit. */
    return anyInView || true;
  }

  function drawOverlay(r) {
    var d = document.createElement('div');
    d.setAttribute(OVERLAY_ATTR, '1');
    var pad = 3;
    /* pointer-events:auto (hit-testable, so elementFromPoint can prove top-most coverage) + MAX z-index. */
    d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:auto;background:#111827;opacity:1;' +
      'left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;' +
      'width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px;';
    document.body.appendChild(d);
  }

  /* The concatenated DIRECT text of an element (its own text nodes only — not descendants). Used to detect a
     stray identifier without covering a whole container on a deep match. Read only to DECIDE coverage. */
  function ownText(el) {
    if (!el || !el.childNodes) { return ''; }
    var s = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n && n.nodeType === 3 && n.nodeValue) { s += n.nodeValue; }
    }
    return s;
  }

  /* An element's redaction rect. If its own box has zero area but it (or an ancestor) renders visible text that
     could overflow, walk up to the nearest ancestor with a real, non-page-sized box so the overflowing value is
     actually covered. Returns null when there is genuinely nothing rendered to cover. */
  function effectiveRect(el) {
    var maxArea = VW * VH * 0.6; /* never adopt a page-sized container as the "value" box */
    var node = el, up = 0;
    while (node && up < 5) {
      var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (r && r.width > 0 && r.height > 0 && r.width * r.height <= maxArea) { return r; }
      node = node.parentElement; up++;
    }
    return null;
  }

  function cover(el, cat) {
    detected[cat] = detected[cat] + 1;
    var r = effectiveRect(el);
    if (!r) {
      /* No rendered box anywhere up the chain. Only safe to call covered if nothing visible is there. */
      var t = (el && el.textContent ? String(el.textContent) : '').replace(/\\s+/g, '');
      if (t.length === 0) { covered[cat] = covered[cat] + 1; }
      return; /* has text but no coverable box → left UNCOVERED → verifyRedaction HALTs (fail-closed) */
    }
    if (MODE === 'apply' && !hittestCovered(r)) { drawOverlay(r); }
    if (hittestCovered(r)) { covered[cat] = covered[cat] + 1; }
  }

  function attrText(el) {
    if (!el || !el.getAttribute) { return ''; }
    var parts = [];
    var names = ['id', 'name', 'class', 'aria-label', 'title', 'placeholder', 'for'];
    for (var i = 0; i < names.length; i++) {
      var v = el.getAttribute(names[i]);
      if (v) { parts.push(String(v)); }
    }
    return parts.join(' ').toLowerCase();
  }

  /* ── structural / attribute categories ── */
  var fields = slice(document.querySelectorAll('input, textarea, select'));
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var type = (f.getAttribute && f.getAttribute('type') || '').toLowerCase();
    if (type === 'password') { cover(f, 'password'); }
    else if (f.readOnly || f.disabled || (f.getAttribute && f.getAttribute('readonly') != null)) { cover(f, 'readonly_or_code'); }
    else { cover(f, 'form_field'); }
  }
  var codeish = slice(document.querySelectorAll('code, pre, [readonly]'));
  for (var i = 0; i < codeish.length; i++) { cover(codeish[i], 'readonly_or_code'); }

  /* credential area: cover the matched node AND enclosing (area-capped) ancestors, so a value rendered in a
     SIBLING of the labelled node is covered too — not just the label. Page-sized ancestors are skipped. */
  var CRED = /secret|시크릿|client[-_ ]?id|application[-_ ]?id|api[-_ ]?key|apikey|애플리케이션/;
  var all = slice(document.querySelectorAll('body *'));
  var CAP_AREA = VW * VH * 0.6;
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (!CRED.test(attrText(el))) { continue; }
    cover(el, 'credential_area');
    var anc = el.parentElement, up = 0;
    while (anc && up < 3) {
      var ar = anc.getBoundingClientRect ? anc.getBoundingClientRect() : null;
      if (ar && ar.width * ar.height > CAP_AREA) { break; } /* stop before a page-level container */
      cover(anc, 'credential_area');
      anc = anc.parentElement; up++;
    }
  }

  var COPY = /복사|copy/;
  var controls = slice(document.querySelectorAll("button, a, [role='button']"));
  for (var i = 0; i < controls.length; i++) {
    var c = controls[i];
    if (!COPY.test(attrText(c))) { continue; }
    cover(c, 'copy_linked');
    if (c.previousElementSibling) { cover(c.previousElementSibling, 'copy_linked'); }
    if (c.nextElementSibling) { cover(c.nextElementSibling, 'copy_linked'); }
    if (c.parentElement) { cover(c.parentElement, 'copy_linked'); }
    var ctrls = c.getAttribute && c.getAttribute('aria-controls');
    if (ctrls) { var tgt = document.getElementById(ctrls); if (tgt) { cover(tgt, 'copy_linked'); } }
  }

  /* ── identity_text: the ONE text read — decides coverage of stray identifiers, returns only a count. Scans
     the DIRECT own-text of every element (not just leaves), so a value in a mixed node is caught. ── */
  var EMAIL = /[^\\s@]+@[^\\s@]+\\.[^\\s@]+/;
  var LONGNUM = /\\d{6,}/;
  var TOKEN = /[A-Za-z0-9_\\-]{12,}/;
  for (var i = 0; i < all.length; i++) {
    var lf = all[i];
    if (lf.getAttribute && lf.getAttribute(OVERLAY_ATTR) != null) { continue; }
    var txt = ownText(lf);
    if (txt.length === 0 || txt.length > 4000) { continue; }
    var tm = txt.match(TOKEN);
    if (EMAIL.test(txt) || LONGNUM.test(txt) || (tm && /\\d/.test(tm[0]))) { cover(lf, 'identity_text'); }
  }

  /* ── chrome_region: global header/footer identity chrome (account + store name live here) ── */
  var chrome = slice(document.querySelectorAll("header, [role='banner'], footer, [role='contentinfo']"));
  for (var i = 0; i < chrome.length; i++) { cover(chrome[i], 'chrome_region'); }

  /* overlay integrity: every overlay currently in the DOM must be opaque + intact */
  var overlays = slice(document.querySelectorAll('[' + OVERLAY_ATTR + ']'));
  var integrityOk = true;
  for (var i = 0; i < overlays.length; i++) { if (!isOpaqueOverlay(overlays[i])) { integrityOk = false; break; } }

  return { bodyPresent: true, overlayCount: overlays.length, integrityOk: integrityOk, detected: detected, covered: covered };
})()`;
}

/** Convenience: the apply pass (draws overlays). */
export const REDACTION_APPLY_SCRIPT = buildRedactionScript("apply");
/** Convenience: the verify pass (draws nothing; confirms coverage still holds). */
export const REDACTION_VERIFY_SCRIPT = buildRedactionScript("verify");

/**
 * STRUCTURE-ONLY census of interactive controls (value-free). Returns an array of raw controls matching
 * `RawVisualControl`: tag / role / input type / ancestry tag chain / sibling position / bounding box / viewport /
 * stable attributes (names + raw values, screened LATER by the frozen Node gate) / match count for the strongest
 * candidate selector. It NEVER reads `.value` / `.textContent` / `.innerHTML`; the candidate selector is built
 * only to COUNT matches and is not returned. Capped so a pathological page cannot produce an unbounded payload.
 */
export const EXTRACT_VISUAL_CONTROLS = `(function () {
  /* visual-recon-census (structure only) */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var CAP = 80;
  var NAMES = ['id', 'data-testid', 'data-test', 'data-cy', 'data-qa', 'aria-label', 'name', 'role', 'class'];
  function esc(s) { return String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"'); }

  function build(el) {
    function attr(name) { return el.getAttribute ? el.getAttribute(name) : null; }
    var tagName = String(el.tagName).toLowerCase();
    var role = attr('role') || undefined;
    var inputType = (tagName === 'input' && el.type) ? String(el.type) : undefined;

    var ancestryTags = [];
    var a = el.parentElement;
    while (a && ancestryTags.length < 12) { ancestryTags.push(String(a.tagName).toLowerCase()); a = a.parentElement; }

    var siblingIndex = 0, siblingCount = 1;
    if (el.parentElement) {
      var sibs = slice(el.parentElement.children);
      siblingCount = sibs.length;
      siblingIndex = sibs.indexOf(el);
      if (siblingIndex < 0) siblingIndex = 0;
    }

    var box = { x: 0, y: 0, w: 0, h: 0 };
    if (el.getBoundingClientRect) { var r = el.getBoundingClientRect(); box = { x: r.left, y: r.top, w: r.width, h: r.height }; }

    var stableAttributes = [];
    for (var n = 0; n < NAMES.length; n++) {
      var av = attr(NAMES[n]);
      if (av !== null && av !== undefined && String(av).length > 0) { stableAttributes.push({ name: NAMES[n], value: String(av) }); }
    }

    var candidateSelector = '';
    for (var p = 0; p < NAMES.length; p++) {
      var pv = attr(NAMES[p]);
      if (pv !== null && pv !== undefined && String(pv).length > 0) { candidateSelector = tagName + '[' + NAMES[p] + '="' + esc(pv) + '"]'; break; }
    }
    var matchCount = 0;
    if (candidateSelector) { try { matchCount = document.querySelectorAll(candidateSelector).length; } catch (e) { matchCount = 0; } }

    return {
      tagName: tagName, role: role, inputType: inputType,
      ancestryTags: ancestryTags, siblingIndex: siblingIndex, siblingCount: siblingCount,
      boundingBox: box, viewport: { w: window.innerWidth || 0, h: window.innerHeight || 0 },
      stableAttributes: stableAttributes, matchCount: matchCount
    };
  }

  var els = slice(document.querySelectorAll("button, a[href], input, select, summary, [role='button'], [role='link'], [role='tab']"));
  var out = [];
  for (var i = 0; i < els.length && out.length < CAP; i++) { out.push(build(els[i])); }
  return out;
})()`;
