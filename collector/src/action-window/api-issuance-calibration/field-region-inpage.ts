/**
 * **The in-page half of the fixed-label REGION census.** One `evaluate` body, built from a candidate list.
 *
 * It reuses `buildFixedLabelLocateScript`'s two rules verbatim — whole normalized text against a fixed label, and
 * a match must PAINT — and then answers the question that script does not: what is this label attached to.
 *
 * **Nothing it returns is content.** `tagName`, integers, and one fixed association enum. It reads
 * `input.value` in exactly one place, tests `trim().length > 0`, and returns a COUNT; the value never leaves the
 * page and never reaches a variable that is returned. That read happens only for candidates whose request set
 * `readFilled`, which the credential candidates never do.
 *
 * Written in ES5 with no closures over builder state, for the same reason every other in-page script here is: the
 * bundler's `keepNames` rewrites arrow functions into `__name(...)` calls that do not exist in the page.
 */
import type { FieldRegionRequest } from "../coupang-wing-field-region";
import { FIELD_REGION_ANCESTOR_DEPTH } from "../coupang-wing-field-region";

/**
 * **Score the anchor's ancestors by what they enclose** — the reading that decides where step ⑧'s ring goes.
 *
 * `mustContain` and `mustExclude` are fixed labels, matched by the same whole-text + paints rules as everything
 * else here. For each ancestor level it returns how many of each GROUP have at least one painting match inside
 * it. Nothing else: a tag name and two integers per level.
 *
 * It reads no value at all — there is no `readFilled` equivalent, and there must not be, because the labels this
 * is pointed at sit next to the seller's Access Key.
 */
export function buildAncestorScopeScript(input: {
  anchor: { candidateQuery: string; exactText: string };
  mustContain: readonly { candidateQuery: string; exactText: string }[];
  mustExclude: readonly { candidateQuery: string; exactText: string }[];
  maxDepth: number;
}): string {
  return `(function () {
  /* wing-ancestor-scope (value-free OUTPUT: { anchorResolved, rows: [{ depth, tag, containCount, excludeCount }] }) */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var ANCHOR = ${JSON.stringify(input.anchor)};
  var CONTAIN = ${JSON.stringify(input.mustContain)};
  var EXCLUDE = ${JSON.stringify(input.mustExclude)};
  var MAX_DEPTH = ${JSON.stringify(input.maxDepth)};
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* text read ONLY to compare against a KNOWN fixed label; nothing derived from it is returned. */
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
  function matching(spec) {
    var cands; try { cands = slice(document.querySelectorAll(spec.candidateQuery)); } catch (e) { return []; }
    var want = norm(spec.exactText), out = [], CAP = 4000;
    for (var i = 0; i < cands.length && i < CAP; i++) {
      if (accName(cands[i]) === want && paints(cands[i])) { out.push(cands[i]); }
    }
    return out;
  }
  var anchors = matching(ANCHOR);
  if (anchors.length !== 1) { return { anchorResolved: false, rows: [] }; }
  /* Resolved ONCE, document-wide, then tested for containment per level — the alternative is re-querying the
     whole document at every depth, which on a live marketplace page is the same reading taken six times. */
  var contain = [], exclude = [];
  for (var c = 0; c < CONTAIN.length; c++) { contain.push(matching(CONTAIN[c])); }
  for (var x = 0; x < EXCLUDE.length; x++) { exclude.push(matching(EXCLUDE[x])); }
  function groupsInside(groups, root) {
    var n = 0;
    for (var g = 0; g < groups.length; g++) {
      for (var e = 0; e < groups[g].length; e++) {
        if (root.contains && root.contains(groups[g][e])) { n++; break; }
      }
    }
    return n;
  }
  var rows = [], node = anchors[0].parentElement, depth = 1;
  while (node && depth <= MAX_DEPTH) {
    rows.push({
      depth: depth,
      tag: node.tagName,
      containCount: groupsInside(contain, node),
      excludeCount: groupsInside(exclude, node)
    });
    node = node.parentElement;
    depth++;
  }
  return { anchorResolved: true, rows: rows };
})()`;
}

/** The tags that take typed text. A checkbox or a radio is not a field the seller fills in. */
const TEXTUAL_INPUT_TYPES = ["text", "url", "email", "tel", "search", "number", "password"] as const;

/**
 * Build the census body for `requests`.
 *
 * The candidate list is embedded as JSON rather than interpolated as code, so a candidate string is data in the
 * page and never a place an expression could be spliced in.
 */
export function buildFieldRegionCensusScript(requests: readonly FieldRegionRequest[]): string {
  const spec = requests.map((r) => ({
    id: r.id,
    q: r.candidateQuery,
    t: r.exactText,
    f: r.readFilled === true,
    c: r.readTagCounts === true,
  }));
  return `(function () {
  /* wing-field-region-census (value-free OUTPUT: tags, counts, association enum) */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var SPEC = ${JSON.stringify(spec)};
  var TEXT_TYPES = ${JSON.stringify(TEXTUAL_INPUT_TYPES)};
  var DEPTH = ${FIELD_REGION_ANCESTOR_DEPTH};
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* text read ONLY to compare against a KNOWN fixed label; nothing derived from it is returned. */
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
  function isTextual(el) {
    var tn = el.tagName;
    if (tn === 'TEXTAREA') { return true; }
    if (tn !== 'INPUT') { return false; }
    var ty = (el.getAttribute('type') || 'text').toLowerCase();
    for (var i = 0; i < TEXT_TYPES.length; i++) { if (TEXT_TYPES[i] === ty) { return true; } }
    return false;
  }
  /* The region a label names, by the first association that answers. Order matters: an explicit \`for\` is what
     WING itself declares and beats any structural guess; wrapping is checked last because a \`<label>\` that also
     has a \`for\` would otherwise report the weaker association. */
  function regionOf(el) {
    var id = el.getAttribute ? el.getAttribute('for') : null;
    if (id) {
      var byId = null;
      try { byId = document.getElementById(id); } catch (e) { byId = null; }
      if (byId) { return { kind: 'LABEL_FOR', node: byId }; }
    }
    if (el.tagName === 'DT') {
      var dd = el.nextElementSibling;
      while (dd && dd.tagName !== 'DD') { dd = dd.nextElementSibling; }
      if (dd) { return { kind: 'DT_NEXT_DD', node: dd }; }
    }
    if (el.tagName === 'TH') {
      var td = el.nextElementSibling;
      while (td && td.tagName !== 'TD') { td = td.nextElementSibling; }
      if (td) { return { kind: 'TH_NEXT_TD', node: td }; }
    }
    if (el.tagName === 'LABEL' && el.querySelector && el.querySelector('input,textarea,select')) {
      return { kind: 'LABEL_WRAPS', node: el };
    }
    return { kind: 'NONE', node: null };
  }
  function ancestorsOf(el) {
    var out = [], p = el.parentElement, n = 0;
    while (p && n < DEPTH) { out.push(p.tagName); p = p.parentElement; n++; }
    return out;
  }
  var readings = [];
  for (var s = 0; s < SPEC.length; s++) {
    var want = norm(SPEC[s].t);
    var cands; try { cands = slice(document.querySelectorAll(SPEC[s].q)); } catch (e) { cands = []; }
    var matches = [], CAP = 4000;
    for (var i = 0; i < cands.length && i < CAP; i++) { if (accName(cands[i]) === want) { matches.push(cands[i]); } }
    var visible = [];
    for (var v = 0; v < matches.length; v++) { if (paints(matches[v])) { visible.push(matches[v]); } }
    var row = { id: SPEC[s].id, visibleCount: visible.length, hiddenCount: matches.length - visible.length };
    if (visible.length === 1) {
      var el = visible[0];
      row.observedTag = el.tagName;
      row.ancestorTags = ancestorsOf(el);
      var reg = regionOf(el);
      row.association = reg.kind;
      if (reg.node) {
        row.regionTag = reg.node.tagName;
        var fields = [];
        if (reg.node.tagName === 'INPUT' || reg.node.tagName === 'TEXTAREA' || reg.node.tagName === 'SELECT') {
          fields = [reg.node];
        } else {
          fields = slice(reg.node.querySelectorAll('input,textarea,select'));
        }
        var inputCount = 0, textInputCount = 0, filled = 0;
        for (var fi = 0; fi < fields.length; fi++) {
          if (!paints(fields[fi])) { continue; }
          inputCount++;
          if (!isTextual(fields[fi])) { continue; }
          textInputCount++;
          /* THE ONLY VALUE READ IN THIS FILE. Its emptiness is counted; the value is not stored, not returned,
             and not compared against anything. Gated on the per-candidate flag, which credentials never set. */
          if (SPEC[s].f && norm(fields[fi].value).length > 0) { filled++; }
        }
        row.inputCount = inputCount;
        row.textInputCount = textInputCount;
        var buttons = reg.node.querySelectorAll ? slice(reg.node.querySelectorAll('button,a[role="button"]')) : [];
        var buttonCount = 0;
        for (var bi = 0; bi < buttons.length; bi++) { if (paints(buttons[bi])) { buttonCount++; } }
        row.buttonCount = buttonCount;
        var entries = reg.node.querySelectorAll ? slice(reg.node.querySelectorAll('li,tr,option')) : [];
        var entryRowCount = 0;
        for (var ei = 0; ei < entries.length; ei++) { if (paints(entries[ei])) { entryRowCount++; } }
        row.entryRowCount = entryRowCount;
        if (SPEC[s].f) { row.filledTextInputCount = filled; }
        /* The whole region, by TAG. Opt-in per candidate because it walks every descendant instead of running
           four fixed queries — it reads strictly less than the counts above it, and costs more.
           entryRowCount answers the same zero for "nothing is registered" and "registered as something I do
           not count", and on 2026-08-13 that cost a live walk its auto-advance. Two of these — before the
           seller presses the register button and after — say what a registered entry actually is. */
        if (SPEC[s].c) {
          var all = reg.node.querySelectorAll ? slice(reg.node.querySelectorAll('*')) : [];
          var names = {}, order = [];
          for (var ti = 0; ti < all.length && ti < CAP; ti++) {
            if (!paints(all[ti])) { continue; }
            var tn = all[ti].tagName;
            if (typeof tn !== 'string') { continue; }
            if (names[tn] === undefined) { names[tn] = 0; order.push(tn); }
            names[tn]++;
          }
          var counts = [];
          for (var oi = 0; oi < order.length; oi++) { counts.push({ tag: order[oi], count: names[order[oi]] }); }
          row.regionTagCounts = counts;
        }
      }
    }
    readings.push(row);
  }
  return { readings: readings };
})()`;
}
