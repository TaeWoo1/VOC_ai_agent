/**
 * **The in-page half of the 고객문의 anchor probe.** One script, one terminal, and no way to return text.
 *
 * ## Why this one is structured differently from the credential census
 *
 * The credential resolver needed two terminals sharing one resolution, because a read of the resolved cell had
 * to exist somewhere. Here **no terminal reads a row's content at all** — not behind a flag, not after a
 * barrier, not ever. The rows carry what a buyer wrote, and there is no product reason to bring it back: the
 * match runs on a digit string we already hold and returns a count.
 *
 * ## Why the row tag is no longer assumed
 *
 * The previous version defined a row as `table tr`, `ul li`, or `[role=row]`, counted those, and asked whether
 * any of them carried the identifier. Against the real WING screen it counted 54 of them and reported zero id
 * matches — and, decisively, **zero occurrences of `답변완료` AND of `미답변`** on a screen showing two answered
 * inquiries. A row set containing neither status word is not the inquiry list. The scan had confidently
 * measured the page's navigation.
 *
 * So the direction is reversed. The **anchor comes first**: a digit string we already hold, searched for
 * document-wide across a small allowlist of STRUCTURAL attributes. Whatever element carries it is the
 * measurement's starting point, and the repeating structure around it is walked outward from there. `TR` or
 * `LI` or `DIV` comes back as a finding.
 *
 * ## The boundary, stated precisely
 *
 *  - **Attributes**: only `href`, `id`, and `data-*` are looked at, and only their digit runs are compared.
 *    Values are compared in-page; only the attribute KIND travels.
 *  - **Classes**: compared in-page for sibling-shape equality; only counts travel.
 *  - **Text**: read on LEAF elements only, and only as `indexOf` against fixed PLATFORM literals WE supply,
 *    reduced to a boolean before it can reach a returned field. **Buyer text never leaves the page.** That is
 *    the honest claim — not "no text is read", which would be false.
 *
 * A test pins that the emitted body assigns no text to any returned field, for the same reason the credential
 * census has its own such test: the failure would be invisible in review and catastrophic in a log.
 *
 * Written in ES5 with no closures over builder state, for the same reason every other in-page script here is:
 * the bundler's `keepNames` rewrites arrow functions into `__name(...)` calls that do not exist in the page.
 */
import type {
  InquiryDigitExpectation,
  InquiryLabelExpectation,
} from "../coupang-wing-inquiry-list";

/**
 * The shared reading half. Defines `census(DIGITS, LABELS)` over the whole document.
 *
 * `anchorRunsOf` extracts whole digit runs from ALLOWLISTED attributes — whole, because a prefix match (`1584`
 * inside `158421449`) would silently target a different inquiry, and that is indistinguishable from success in
 * every log we would ever look at.
 */
const CENSUS_FRAGMENT = `
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var CAP = 20000;
  var MAX_ANCESTOR_DEPTH = 12;
  var MAX_LEVELS = 4;
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
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
  /* THE ATTRIBUTE ALLOWLIST. Anything not named here is never looked at, in any element, for any purpose. */
  function attrKind(name) {
    var n = String(name == null ? '' : name).toLowerCase();
    if (n === 'href') { return 'HREF'; }
    if (n === 'id') { return 'ID'; }
    if (n.indexOf('data-') === 0) { return 'DATA'; }
    return null;
  }
  /* Whole digit runs in this element's OWN allowlisted attributes, with the KIND they came from.
     Values are compared in-page and never returned. */
  function anchorRunsOf(el) {
    var out = [];
    var attrs = el.attributes;
    if (!attrs) { return out; }
    for (var a = 0; a < attrs.length; a++) {
      var kind = attrKind(attrs[a].name);
      if (kind === null) { continue; }
      var runs = String(attrs[a].value == null ? '' : attrs[a].value).match(/[0-9]+/g);
      if (!runs) { continue; }
      for (var d = 0; d < runs.length; d++) { out.push({ kind: kind, digits: runs[d] }); }
    }
    return out;
  }
  /* Which allowlisted attribute kinds an element carries at all — structure, independent of any match. */
  function attrKindsOf(el) {
    var seen = {}, out = [], attrs = el.attributes;
    if (!attrs) { return out; }
    for (var a = 0; a < attrs.length; a++) {
      var kind = attrKind(attrs[a].name);
      if (kind !== null && !seen[kind]) { seen[kind] = 1; out.push(kind); }
    }
    return out;
  }
  /* The class SHAPE, compared inside the page. The string itself never leaves; only equality counts do. */
  function classShapeOf(el) {
    var raw = el.getAttribute ? el.getAttribute('class') : null;
    return norm(raw || '');
  }
  function classTokenCountOf(el) {
    var shape = classShapeOf(el);
    return shape.length === 0 ? 0 : shape.split(' ').length;
  }
  function hasDetailAffordance(el) {
    var tag = String(el.tagName || '').toUpperCase();
    if (tag === 'A' || tag === 'BUTTON') { return paints(el); }
    var links; try { links = slice(el.querySelectorAll('a[href],button')); } catch (e) { return false; }
    for (var i = 0; i < links.length; i++) { if (paints(links[i])) { return true; } }
    return false;
  }
  /* Keep only the INNERMOST matches. An <a> inside a <tr> that both carry the id is ONE target, not an
     ambiguous two — and a false refusal there is as costly as a false target. */
  function innermost(els) {
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var contained = false;
      for (var j = 0; j < els.length; j++) {
        if (i !== j && els[i] !== els[j] && els[i].contains && els[i].contains(els[j])) { contained = true; break; }
      }
      if (!contained) { out.push(els[i]); }
    }
    return out;
  }
  /* Distinct digit-run LENGTHS in this element's own allowlisted attributes, and optionally its descendants.
     Lengths, never values — this is what tells "carries no machine id" apart from "carries an id of a different
     kind than ours", two findings that both arrive as a match count of zero. */
  function digitLengthsOf(el, includeDescendants) {
    var seen = {}, out = [];
    var nodes = [el];
    if (includeDescendants) {
      var kids; try { kids = slice(el.querySelectorAll('*')); } catch (e) { kids = []; }
      if (kids.length > 500) { kids = kids.slice(0, 500); }
      nodes = nodes.concat(kids);
    }
    for (var i = 0; i < nodes.length; i++) {
      var runs = anchorRunsOf(nodes[i]);
      for (var r = 0; r < runs.length; r++) {
        var len = runs[r].digits.length;
        if (!seen[len]) { seen[len] = 1; out.push(len); }
      }
    }
    return out;
  }
  /* The repeat chain above (and including) the anchor. A <td> repeats across and a <tr> repeats down; both are
     reported, because deciding which one is "the row" from inside a probe is exactly the guess that failed. */
  function repeatLevelsOf(el) {
    var levels = [], node = el, depth = 0;
    while (node && depth <= MAX_ANCESTOR_DEPTH && levels.length < MAX_LEVELS) {
      var parent = node.parentElement;
      if (parent) {
        var kids = parent.children, same = 0, sameShape = 0;
        var tag = String(node.tagName || '').toUpperCase();
        var shape = classShapeOf(node);
        for (var i = 0; i < kids.length; i++) {
          if (String(kids[i].tagName || '').toUpperCase() === tag) {
            same++;
            if (classShapeOf(kids[i]) === shape) { sameShape++; }
          }
        }
        if (same >= 2) {
          levels.push({
            depth: depth,
            tagName: tag,
            siblingCount: same,
            siblingsSharingClassShape: sameShape,
            classTokenCount: classTokenCountOf(node),
            attributeKinds: attrKindsOf(node),
            hasDetailAffordance: hasDetailAffordance(node),
            digitRunLengths: digitLengthsOf(node, true)
          });
        }
      }
      node = parent;
      depth++;
    }
    return { levels: levels, scanned: depth };
  }
  /* The topology reading, shared by digit anchors and label anchors — the structure question is the same one
     whichever kind of thing we found, and one implementation means one set of rules about what may travel. */
  function topologyOf(el, kindList) {
    var walk = repeatLevelsOf(el);
    return {
      matchedTagName: String(el.tagName || '').toUpperCase(),
      attributeKinds: kindList || attrKindsOf(el),
      ancestorDepthScanned: walk.scanned,
      repeatLevels: walk.levels
    };
  }
  /* Fixed-literal comparison on LEAF elements only. The comparison happens here; what survives it is a list of
     ELEMENTS, never their text. Leaves keep it strictly innermost and keep the scan linear — a status word is
     rendered as leaf text, and counting ancestors too would report a row, its container, and the page body as
     three answered inquiries. */
  function labelHits(all, literal) {
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].childElementCount !== 0) { continue; }
      if (norm(all[i].textContent || '').indexOf(literal) >= 0) { out.push(all[i]); }
    }
    return out;
  }
  /* Do the hits sit in the same KIND of place? Two leaves saying the same word inside two identically shaped
     siblings is a row structure; two leaves in unrelated corners of the page is a coincidence. */
  function hitsSharingShape(hits, topology) {
    if (!topology || topology.repeatLevels.length === 0) { return 0; }
    var want = topology.repeatLevels[0], n = 0;
    for (var i = 0; i < hits.length; i++) {
      var walk = repeatLevelsOf(hits[i]);
      if (walk.levels.length > 0 && walk.levels[0].tagName === want.tagName && walk.levels[0].depth === want.depth) {
        n++;
      }
    }
    return n;
  }
  function census(DIGITS, LABELS) {
    var all;
    try { all = slice(document.querySelectorAll('*')); } catch (e) { return { reason: 'UNREADABLE' }; }
    if (all.length > CAP) { return { reason: 'SCAN_TRUNCATED' }; }
    if (all.length === 0) { return { reason: 'NO_ELEMENTS' }; }

    var i, j, withAnchors = 0;
    var hits = [], kinds = [], seenLengths = {}, allLengths = [];
    for (j = 0; j < DIGITS.length; j++) { hits.push([]); kinds.push({}); }

    for (i = 0; i < all.length; i++) {
      var runs = anchorRunsOf(all[i]);
      if (runs.length === 0) { continue; }
      withAnchors++;
      for (var q = 0; q < runs.length; q++) {
        var qlen = runs[q].digits.length;
        if (!seenLengths[qlen]) { seenLengths[qlen] = 1; allLengths.push(qlen); }
      }
      for (j = 0; j < DIGITS.length; j++) {
        var want = DIGITS[j].digits, hit = false;
        for (var r = 0; r < runs.length; r++) {
          /* Whole-run equality. A substring match here would target a different inquiry silently. */
          if (runs[r].digits === want) { hit = true; kinds[j][runs[r].kind] = 1; }
        }
        if (hit) { hits[j].push(all[i]); }
      }
    }

    var anchors = [];
    for (j = 0; j < DIGITS.length; j++) {
      var matched = innermost(hits[j]);
      var topology = null;
      /* Topology travels only for an unambiguous anchor — with two matches it would describe the wrong one. */
      if (matched.length === 1) {
        var kindList = [];
        for (var key in kinds[j]) { kindList.push(key); }
        topology = topologyOf(matched[0], kindList);
      }
      anchors.push({ id: DIGITS[j].id, matchCount: matched.length, topology: topology });
    }

    var labelCounts = [];
    for (j = 0; j < LABELS.length; j++) {
      var lhits = labelHits(all, LABELS[j].exactText);
      var ltop = lhits.length > 0 ? topologyOf(lhits[0], null) : null;
      labelCounts.push({
        id: LABELS[j].id,
        elementCount: lhits.length,
        topology: ltop,
        hitsSharingRepeatShape: hitsSharingShape(lhits, ltop)
      });
    }

    return {
      reason: 'OK',
      elementsScanned: all.length,
      elementsWithAnchorAttributes: withAnchors,
      anchorDigitRunLengths: allLengths,
      anchors: anchors,
      labelCounts: labelCounts
    };
  }
`;

/**
 * The census script. `digits` are identifiers SellerOps already holds (a channel inquiry id, a seller product
 * id); `labels` are fixed Coupang UI words. Both are supplied by the caller and JSON-embedded, so the page
 * never contributes a string to the result — only counts, tag names, and the ids we handed in.
 */
export function buildInquiryListCensusScript(
  digits: readonly InquiryDigitExpectation[],
  labels: readonly InquiryLabelExpectation[],
): string {
  const digitSpecs = digits.map((d) => ({ id: d.id, digits: d.digits }));
  const labelSpecs = labels.map((l) => ({ id: l.id, exactText: l.exactText }));
  return [
    "(function () {",
    CENSUS_FRAGMENT,
    "  var DIGITS = " + JSON.stringify(digitSpecs) + ";",
    "  var LABELS = " + JSON.stringify(labelSpecs) + ";",
    "  return census(DIGITS, LABELS);",
    "})()",
  ].join("\n");
}
