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
import { IDENTITY_REDACT_PATTERN_SOURCES, REDACTION_CATEGORIES } from "./visual-recon";
import { IN_PAGE_SIG_FACTORY } from "../signature";

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
 *  - identity_text: own-text carrying an ACCOUNT handle / IP / long credential-token / "<handle> 님" — the shared
 *    {@link IDENTITY_REDACT_PATTERN_SOURCES} (counted, never emitted). A public store name / app description has
 *    no ASCII identifier and is deliberately left visible.
 *  - chrome_region: retained as a report category but NO LONGER blanket-covered (the account handle it used to
 *    hide is now caught precisely by identity_text; the rest of the header/footer is public UI structure)
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
    /* Only redact what is IN the viewport-only screenshot. Skip ONLY when the element's OWN real box is wholly
       outside the viewport (not in the shot) — this fixes the api_group HALT where a scrolled-off credential row
       was counted-but-unpainted (overlayCount 0 ⇒ NO_OVERLAY backstop). Keyed on the element's OWN box (not the
       effective/ancestor box): a zero-area leaf whose text may overflow in-view is NOT skipped, so an overflowing
       on-screen value can never leak. A partially visible box (any in-view slice) also is NOT skipped. */
    var ownR = (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : null;
    if (ownR && ownR.width > 0 && ownR.height > 0 &&
        (ownR.bottom <= 0 || ownR.top >= VH || ownR.right <= 0 || ownR.left >= VW)) { return; }
    var r = effectiveRect(el);
    detected[cat] = detected[cat] + 1;
    if (!r) {
      /* No coverable box anywhere up the chain. Safe to call covered ONLY when the element paints NOTHING in the
         shot: it has no text, OR it is not rendered — display:none, OR it generates zero client rects and is not
         a display:contents box (whose children DO paint). A collapsed header account menu (display:none, still in
         the DOM) is the case this handles. visibility:hidden is deliberately NOT relaxed here (such elements keep
         a real box, so they take the normal overlay path above, and a visible descendant could re-reveal text).
         Any genuinely-rendered element whose visible text we could not box stays UNCOVERED → HALT (fail-closed). */
      var t = (el && el.textContent ? String(el.textContent) : '').replace(/\\s+/g, '');
      if (t.length === 0) { covered[cat] = covered[cat] + 1; return; }
      var cs = (el && window.getComputedStyle) ? window.getComputedStyle(el) : null;
      var isContents = !!(cs && cs.display === 'contents');
      var paintsNothing = !!(el && el.getClientRects && el.getClientRects().length === 0) && !isContents;
      if ((cs && cs.display === 'none') || paintsNothing) { covered[cat] = covered[cat] + 1; }
      return; /* rendered text but no coverable box → UNCOVERED → HALT (fail-closed) */
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

  /* ── identity_text: the ONE text read — decides coverage of an ACCOUNT / IP / credential identifier and
     returns only a count. Scans the DIRECT own-text of every element (not just leaves), so a value in a mixed
     node is caught. The patterns are the shared IDENTITY_REDACT_PATTERN_SOURCES, built once here as RegExps: a
     PUBLIC store name or a Korean-prose app description carries no ASCII identifier, so both stay visible. ── */
  var IDSRC = ${JSON.stringify(IDENTITY_REDACT_PATTERN_SOURCES)};
  var IDRE = [];
  for (var pi = 0; pi < IDSRC.length; pi++) { IDRE.push(new RegExp(IDSRC[pi])); }
  for (var i = 0; i < all.length; i++) {
    var lf = all[i];
    if (lf.getAttribute && lf.getAttribute(OVERLAY_ATTR) != null) { continue; }
    var txt = ownText(lf);
    if (txt.length === 0 || txt.length > 4000) { continue; }
    var idhit = false;
    for (var ri = 0; ri < IDRE.length; ri++) { if (IDRE[ri].test(txt)) { idhit = true; break; } }
    if (idhit) { cover(lf, 'identity_text'); }
  }

  /* ── chrome_region: retained as a report-shape category, but NO LONGER blanket-covered. Over-covering the
     whole header/footer hid the very Korean UI structure the reviewer needs; the only sensitive item in the
     chrome — the logged-in account handle — is now caught precisely by identity_text above. ── */

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

/**
 * Remove every redaction overlay from the page. Run AFTER a screen's capture/HALT so the operator's own view
 * returns to normal for navigating/scrolling to the next checkpoint (overlays no longer linger between screens).
 * Value-free: returns only an integer `removed` count; never reads a value/text.
 */
export const REDACTION_CLEAR_SCRIPT = `(function () {
  /* visual-recon-clear */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var OVERLAY_ATTR = ${JSON.stringify(REDACT_OVERLAY_ATTR)};
  if (!document.body) { return { removed: 0 }; }
  var overlays = slice(document.querySelectorAll('[' + OVERLAY_ATTR + ']'));
  var removed = 0;
  for (var i = 0; i < overlays.length; i++) { if (overlays[i].parentNode) { overlays[i].parentNode.removeChild(overlays[i]); removed = removed + 1; } }
  return { removed: removed };
})()`;

/**
 * A READ-ONLY fixed-label match probe. For each probe it counts how many candidate elements have an accessible
 * name (aria-label, else normalized text) EXACTLY equal to a FIXED NAVER UI label (e.g. "애플리케이션 등록").
 * It reads element text SOLELY to compare against a KNOWN, fixed label supplied by the caller — it returns only
 * `{ targetId, matchCount }` integers, NEVER any page text/value/selector. It never clicks, types, or mutates.
 * This is what lets a reviewer learn whether a text-labelled control (NAVER exposes no aria-label/id for these)
 * resolves uniquely on the live DOM — which the attribute-only census cannot measure.
 */
export function buildFixedLabelProbeScript(probes: readonly { targetId: string; candidateQuery: string; exactText: string }[]): string {
  return `(function () {
  /* visual-recon-fixed-label-probe (value-free OUTPUT: integers + the caller's own target ids only) */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var PROBES = ${JSON.stringify(probes)};
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* text read ONLY to compare against a KNOWN fixed label; only a COUNT is returned, never the text. */
    return norm(el.textContent || '');
  }
  var out = [];
  for (var p = 0; p < PROBES.length; p++) {
    var probe = PROBES[p];
    var want = norm(probe.exactText);
    var els; try { els = slice(document.querySelectorAll(probe.candidateQuery)); } catch (e) { els = []; }
    var n = 0, CAP = 4000;
    for (var i = 0; i < els.length && i < CAP; i++) { if (accName(els[i]) === want) { n = n + 1; } }
    out.push({ targetId: probe.targetId, matchCount: n });
  }
  return out;
})()`;
}

/**
 * What a fixed-label CONTAINMENT reading contains. Four integers and a boolean — no text, ever.
 *
 * It exists to answer a question a bare `matchCount: 0` cannot: **is this label absent from the page, or present
 * in a form the exact-whole-text matcher cannot see?** Those two readings are byte-identical today, and the
 * difference decides whether the next step is "find the real wording" or "fix the matcher". The Stage-2 recon
 * recorded seven zeros and could only offer an INFERRED explanation for them
 * (`WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT`); this is the instrument that tests it.
 */
export interface FixedLabelContainmentReading {
  /** Candidates whose accessible name EQUALS the fixed label and which PAINT. Same rule as the locate script. */
  readonly exactVisible: number;
  /** Candidates whose accessible name equals it but which do NOT paint. */
  readonly exactHidden: number;
  /**
   * PAINTING elements whose normalized text CONTAINS the label while no child element's does — the innermost
   * container. Counted over the whole document, not the candidate query, because the point is to find the label
   * wherever it lives, including split across nested nodes where `norm(textContent)` rejoins it.
   *
   * Innermost-only is what keeps this a small number: every ancestor up to `<html>` also contains the text, and
   * counting them would report page depth rather than a finding. A direct-child test is sufficient — a
   * descendant's text is a subsequence of its parent's, so no child containing it means no descendant does.
   */
  readonly deepestContainsVisible: number;
  /** The same innermost containers that do not paint. */
  readonly deepestContainsHidden: number;
  /**
   * True when either scan hit its element cap. An absence measured under truncation is an absence **within the
   * scanned prefix**, not a whole-document absence — the exact bound the locate script does not report and which
   * `absenceBounds.candidateScanTruncationReported: false` records against the Stage-2 recon.
   */
  readonly scanTruncated: boolean;
}

/**
 * Host-side re-validation: coerce every field, trust the page for nothing — and **return `null` when there is
 * nothing to coerce.**
 *
 * The null is the point. An earlier version folded `undefined` / `null` / a non-object into `{0,0,0,0,false}`,
 * which is a COMPLETE reading: `wingStage2PresenceFrom` then read it as `ABSENT_EVERYWHERE` and the record
 * counted it in `containmentMeasured`. A page that swapped under the probe, or a CSP that killed the script,
 * would have produced a confident measured absence for a label nobody looked for. Only a THROW produced a
 * fault; a silent nothing produced a finding.
 */
export function sanitizeContainmentReading(raw: unknown): FixedLabelContainmentReading | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return Object.freeze({
    exactVisible: nat(r.exactVisible),
    exactHidden: nat(r.exactHidden),
    deepestContainsVisible: nat(r.deepestContainsVisible),
    deepestContainsHidden: nat(r.deepestContainsHidden),
    scanTruncated: r.scanTruncated === true,
  });
}

/**
 * A READ-ONLY fixed-label CONTAINMENT probe: the same value-free comparison {@link buildFixedLabelLocateScript}
 * makes, plus the one extra question that distinguishes "absent" from "unmatchable".
 *
 * **Output is four integers and a boolean.** Element text is read SOLELY to compare against the caller's own
 * fixed label — by equality for the exact halves and by `indexOf` for the containment halves. The matched text is
 * never returned, no element is named, nothing is tagged, clicked, or mutated. That is the same contract the
 * locate and probe scripts hold, and the reason this can run under a READ_ONLY manifest.
 *
 * **Why it is a separate script rather than a wider locate.** The locate script is on the shipped highlight path;
 * giving it a whole-document `*` scan would make every highlight pay for a measurement only a calibration run
 * needs, on the one code path where a slow or throwing read strands the operator mid-walkthrough.
 *
 * Kept ES5-plain + string-form so esbuild's `__name` shim is never referenced in the page.
 */
export function buildFixedLabelContainmentScript(input: { candidateQuery: string; exactText: string }): string {
  return `(function () {
  /* fixed-label-containment (value-free OUTPUT: 5 integers + 1 boolean) */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* text read ONLY to compare against a KNOWN fixed label; only COUNTS are returned, never the text. */
    return norm(el.textContent || '');
  }
  function paints(node) {
    if (!node || !node.getClientRects) { return false; }
    var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
    if (cs && cs.display === 'contents') { return node.childElementCount > 0; }
    var rects = node.getClientRects();
    if (!rects || rects.length === 0) { return false; }
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!r && r.width > 0 && r.height > 0;
  }
  var want = norm(${JSON.stringify(input.exactText)});
  /* CAND_CAP is the LOCATE script's cap, deliberately identical: the exact halves below are compared against
     that script's counts, and a wider cap here would count matches it never saw while reporting agreement.
     DOC_CAP bounds the whole-document containment scan, which is a bigger sweep and needs its own ceiling. */
  var CAND_CAP = 4000, DOC_CAP = 8000;
  var cands; try { cands = slice(document.querySelectorAll(${JSON.stringify(input.candidateQuery)})); } catch (e) { cands = []; }
  var exactVisible = 0, exactHidden = 0, i, j;
  for (i = 0; i < cands.length && i < CAND_CAP; i++) {
    if (accName(cands[i]) === want) { if (paints(cands[i])) { exactVisible++; } else { exactHidden++; } }
  }
  var all; try { all = slice(document.querySelectorAll('*')); } catch (e2) { all = []; }
  var deepVisible = 0, deepHidden = 0;
  /* An empty label would be "contained" by every element on the page. Refuse it rather than report page size. */
  if (want.length > 0) {
    for (i = 0; i < all.length && i < DOC_CAP; i++) {
      var el = all[i];
      if (norm(el.textContent || '').indexOf(want) === -1) { continue; }
      var kids = el.children || [], innermost = true;
      for (j = 0; j < kids.length; j++) {
        if (norm(kids[j].textContent || '').indexOf(want) !== -1) { innermost = false; break; }
      }
      if (!innermost) { continue; }
      if (paints(el)) { deepVisible++; } else { deepHidden++; }
    }
  }
  return {
    exactVisible: exactVisible,
    exactHidden: exactHidden,
    deepestContainsVisible: deepVisible,
    deepestContainsHidden: deepHidden,
    scanTruncated: cands.length > CAND_CAP || all.length > DOC_CAP
  };
})()`;
}

/**
 * A READ-ONLY fixed-label LOCATE (+ optional read-only TAG) script — the value-free OUTPUT half of the Phase-B
 * issuance highlight driver's locator. Given a STRUCTURAL candidate query and a FIXED NAVER UI label, it finds
 * the candidates whose accessible name (aria-label, else normalized text) EXACTLY equals that label **and which
 * actually paint**. If exactly ONE such match exists it returns `{ count: 1, hiddenCount, tag, sig }` where `sig`
 * is an opaque 16-hex hash computed IN-PAGE from the element's tag + document position + child count — never from
 * any value/attribute/text. When `tag` is true it ALSO moves the read-only `data-aw-target` annotation onto that
 * single match (clearing any prior tag first) so the reused overlay/observer can attach to it. When zero or many
 * paint it returns `{ count, hiddenCount }`.
 *
 * **`count` counts VISIBLE matches, and that is the point.** Text equality alone once let a non-rendered node be
 * the unique match for 발급: the locate reported `count: 1`, the tag landed on an invisible element, the paint
 * check passed on the separately-mounted panel, and the operator was told to press a highlighted control that was
 * nowhere on screen. Uniqueness is not correctness — a match nobody can see is not a match, so a non-painting
 * candidate is rejected here rather than counted and pointed at.
 *
 * **`tagAncestor` (optional, tag only).** When set to a STRUCTURAL selector (e.g. `"tr"`), the read-only tag is
 * promoted from the matched LABEL element to its nearest ancestor matching that selector (`el.closest(sel)`), so
 * the highlight boxes the whole row rather than just the label cell — falling back to the label itself when no
 * such ancestor exists. `closest()` reads STRUCTURE only (no text/value); the anti-drift `sig` stays computed on
 * the LABEL `el`, never the promoted ancestor, so the locate↔highlight signature is unchanged.
 *
 * **Value-free OUTPUT, like {@link buildFixedLabelProbeScript}.** Element text is read SOLELY to compare against
 * the caller's KNOWN fixed label (`accName(el) === want`); the matched text is NEVER returned — only a count and,
 * for a unique match, the structural signature. It NEVER clicks, types, reads a field value, or mutates anything
 * beyond the read-only `data-aw-target` marker. Kept ES5-plain + string-form so esbuild's `__name` shim is never
 * referenced in the page.
 */
/**
 * **Locate — and optionally tag — a whole RING PLAN in ONE in-page evaluation.**
 *
 * The multi-control version of {@link buildFixedLabelLocateScript}, and it exists for two reasons that turned
 * out to be the same reason.
 *
 * **Latency, observed.** A step ringing two controls ran the single-spec script once per spec, twice over
 * (locate, then tag), plus a separate clear — five round trips where one control needed two. The operator saw
 * the new rings arrive visibly later than the old ones on the live walk of 2026-08-12. Each round trip is a
 * page evaluation on a real marketplace page; the work inside them is microseconds.
 *
 * **Atomicity, which the sequence could not give.** Tagging spec-by-spec has an intermediate state: if the
 * second spec fails to resolve, the first is already tagged, and the driver's all-or-nothing contract then has
 * to unwind it. Here the specs are all resolved FIRST and nothing is tagged unless every one of them lands on
 * exactly one painting element — so the page never holds a partial ring set at all.
 *
 * Value-free OUTPUT, exactly like the single-spec script: per-spec integers, a MEASURED tag name, and an opaque
 * structural signature. Element text is read solely to compare against labels the caller wrote, and never
 * returned. Index 0 is the PRIMARY — it carries `data-aw-primary`, which is what the overlay's chip and its
 * page-dimming shroud attach to.
 */
export function buildFixedLabelRingPlanScript(input: {
  specs: readonly { candidateQuery: string; exactText: string; tagAncestor?: string }[];
  tag: boolean;
}): string {
  const encoded = JSON.stringify(
    input.specs.map((sp) => ({ q: sp.candidateQuery, t: sp.exactText, a: sp.tagAncestor ?? null })),
  );
  return `(function () {
  /* issuance-ring-plan-${input.tag ? "tag" : "locate"} (value-free OUTPUT: per-spec { count, hiddenCount, tag?, sig? }) */
  var sig = ${IN_PAGE_SIG_FACTORY};
  var SPECS = ${encoded};
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* text read ONLY to compare against a KNOWN fixed label; only a COUNT / structural sig is returned. */
    return norm(el.textContent || '');
  }
  /* Identical paint test to the single-spec script — a match a human cannot see is not a match. */
  function paints(node) {
    if (!node || !node.getClientRects) { return false; }
    var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
    if (cs && cs.display === 'contents') { return node.childElementCount > 0; }
    var rects = node.getClientRects();
    if (!rects || rects.length === 0) { return false; }
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!r && r.width > 0 && r.height > 0;
  }
  var CAP = 4000;
  var rows = [], chosen = [], i, j, k, allResolved = true;
  for (i = 0; i < SPECS.length; i++) {
    var want = norm(SPECS[i].t), cands;
    try { cands = slice(document.querySelectorAll(SPECS[i].q)); } catch (e) { cands = []; }
    var matches = [];
    for (j = 0; j < cands.length && j < CAP; j++) { if (accName(cands[j]) === want) { matches.push(cands[j]); } }
    var visible = [];
    for (k = 0; k < matches.length; k++) { if (paints(matches[k])) { visible.push(matches[k]); } }
    var hiddenCount = matches.length - visible.length;
    if (visible.length !== 1) {
      allResolved = false;
      chosen.push(null);
      rows.push({ count: visible.length, hiddenCount: hiddenCount });
      continue;
    }
    chosen.push(visible[0]);
    rows.push({ count: 1, hiddenCount: hiddenCount });
  }
  ${
    input.tag
      ? `/* ALL-OR-NOTHING. Nothing is tagged unless every spec resolved, so a partial ring set never exists on
     the page — not even for the moment between two evaluations, which is what the per-spec sequence had. */
  if (allResolved) {
    var prior = slice(document.querySelectorAll('[data-aw-target]'));
    for (i = 0; i < prior.length; i++) { prior[i].removeAttribute('data-aw-target'); prior[i].removeAttribute('data-aw-primary'); }
    for (i = 0; i < chosen.length; i++) {
      var tagEl = chosen[i];
      var anc = SPECS[i].a && tagEl.closest ? tagEl.closest(SPECS[i].a) : null;
      if (anc) { tagEl = anc; }
      tagEl.setAttribute('data-aw-target', '');
      if (i === 0) { tagEl.setAttribute('data-aw-primary', ''); }
    }
  }`
      : ``
  }
  /* The signature stays on the MATCHED element, never a promoted ancestor, so locate and tag agree. */
  var all = slice(document.querySelectorAll('*'));
  for (i = 0; i < chosen.length; i++) {
    if (!chosen[i]) { continue; }
    rows[i].tag = chosen[i].tagName;
    rows[i].sig = sig(chosen[i].tagName + ':' + all.indexOf(chosen[i]), 'children:' + chosen[i].childElementCount);
  }
  return { resolved: allResolved, rows: rows };
})()`;
}

export function buildFixedLabelLocateScript(input: {
  candidateQuery: string;
  exactText: string;
  tag: boolean;
  tagAncestor?: string;
}): string {
  return `(function () {
  /* issuance-fixed-label-${input.tag ? "tag" : "locate"} (value-free OUTPUT: { count, sig? }) */
  var sig = ${IN_PAGE_SIG_FACTORY};
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* text read ONLY to compare against a KNOWN fixed label; only a COUNT / structural sig is returned. */
    return norm(el.textContent || '');
  }
  /* Does this element actually PAINT? A highlight on a non-painting node is invisible to the operator while every
     count/sig here still reports success — the exact failure observed live on 2026-08-09, where the sole textual
     match for the 발급 label was an unrendered node and the run reported \`highlighted: true\` over a page with no
     visible highlight anywhere. Matching text is therefore not sufficient: a match must be a thing a human can see.
     display:none and any non-rendered ancestor collapse to zero client rects; visibility:hidden is inherited, so
     testing the element's own computed style also covers a hidden ancestor. display:contents boxes paint through
     their children and legitimately own no rect. STRUCTURE only — no text, value, or attribute is read or returned. */
  function paints(node) {
    if (!node || !node.getClientRects) { return false; }
    var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
    if (cs && cs.display === 'contents') { return node.childElementCount > 0; }
    var rects = node.getClientRects();
    if (!rects || rects.length === 0) { return false; }
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!r && r.width > 0 && r.height > 0;
  }
  var want = norm(${JSON.stringify(input.exactText)});
  var cands; try { cands = slice(document.querySelectorAll(${JSON.stringify(input.candidateQuery)})); } catch (e) { cands = []; }
  var matches = [], CAP = 4000;
  for (var i = 0; i < cands.length && i < CAP; i++) { if (accName(cands[i]) === want) { matches.push(cands[i]); } }
  var visible = [];
  for (var v = 0; v < matches.length; v++) { if (paints(matches[v])) { visible.push(matches[v]); } }
  /* hiddenCount is a COUNT of rejected non-painting matches — it names no element and carries no text. It exists
     so "the label matched nothing visible" is distinguishable from "the label matched nothing at all" without a
     live round trip; the two look identical in a bare count and diagnosing today's failure needed exactly this. */
  var hiddenCount = matches.length - visible.length;
  if (visible.length !== 1) { return { count: visible.length, hiddenCount: hiddenCount }; }
  var el = visible[0];
  ${
    input.tag
      ? `var prior = slice(document.querySelectorAll('[data-aw-target]'));
  for (var p = 0; p < prior.length; p++) { prior[p].removeAttribute('data-aw-target'); prior[p].removeAttribute('data-aw-primary'); }
  var tagEl = el;${
    input.tagAncestor
      ? `
  /* promote the read-only tag to the nearest structural ancestor (no text/value read); fall back to the label. */
  var anc = el.closest ? el.closest(${JSON.stringify(input.tagAncestor)}) : null;
  if (anc) { tagEl = anc; }`
      : ``
  }
  tagEl.setAttribute('data-aw-target', '');`
      : ``
  }
  var all = slice(document.querySelectorAll('*'));
  var idx = all.indexOf(el);
  /* sig stays on the LABEL el (never the promoted ancestor) so the locate↔highlight anti-drift check is stable.
     \`tag\` is the MEASURED tag name of the match (e.g. 'BUTTON'). It is returned because the calibration record
     used to assert \`role: "button"\` for the 발급 control while this script returned no such field — an element
     property claimed by hand, from a measurement that never produced it, and wrong when finally checked. A record
     may now only state what this returns. A tag name is structural, like the count and the sig: not content. */
  return { count: 1, hiddenCount: hiddenCount, tag: el.tagName, sig: sig(el.tagName + ':' + idx, 'children:' + el.childElementCount) };
})()`;
}
