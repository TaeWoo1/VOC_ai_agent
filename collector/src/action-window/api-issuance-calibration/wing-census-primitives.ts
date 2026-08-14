/**
 * **The in-page primitives every WING structural census shares.** One copy of the rules about what may be
 * looked at, and what may travel back.
 *
 * These were the 고객문의 probe's own fragment until a second screen needed the same measurements. They are
 * extracted rather than copied because the copy would not have been a copy for long: the boundary they enforce
 * — the attribute allowlist, the single text-read site, values compared in-page and reduced to counts — is
 * exactly the kind of rule that drifts when it exists twice. A promise weakened in one fork and not the other
 * is invisible in review, which is the failure this file is arranged to prevent.
 *
 * ## The boundary, stated precisely
 *
 *  - **Attributes**: only `href`, `id`, and `data-*` are looked at, and only their digit runs are compared.
 *    Values are compared in-page; only the attribute KIND travels.
 *  - **Classes**: compared in-page for sibling-shape equality; only counts travel.
 *  - **Text**: read in exactly ONE function ({@link CENSUS_PRIMITIVES_FRAGMENT}'s `textOf`), and only ever
 *    compared there against fixed literals or shape patterns the CALLER supplied, reduced to a boolean, a count,
 *    or an element before it can reach a returned field. **Page text never leaves the page.** That is the honest
 *    claim — not "no text is read", which would be false.
 *
 * Written in ES5 with no closures over builder state, for the same reason every other in-page script here is:
 * the bundler's `keepNames` rewrites arrow functions into `__name(...)` calls that do not exist in the page.
 */

/**
 * Shared reading primitives. Included verbatim by each census script, which then defines its own `census(...)`
 * on top and is responsible for nothing except which questions to ask.
 *
 * `anchorRunsOf` extracts WHOLE digit runs from allowlisted attributes — whole, because a prefix match (`1584`
 * inside `158421449`) would silently target a different row, and that is indistinguishable from success in
 * every log we would ever look at.
 */
export const CENSUS_PRIMITIVES_FRAGMENT = `
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
  /* EVERY element, including inside open shadow roots.
     A document-level query stops at a shadow boundary, so a component-rendered list is invisible to it — the
     same blind spot as scanning only the top frame, one layer in, and it produces the same confident zero.
     Closed roots stay unreachable by construction; nothing here tries to open one. */
  function collectAll() {
    var out = [], roots = [document], shadowRoots = 0, guard = 0;
    while (roots.length > 0 && guard < 2000) {
      guard++;
      var root = roots.shift();
      var els; try { els = slice(root.querySelectorAll('*')); } catch (e) { continue; }
      for (var i = 0; i < els.length; i++) {
        out.push(els[i]);
        if (out.length > CAP) { return null; }
        if (els[i].shadowRoot) { roots.push(els[i].shadowRoot); shadowRoots++; }
      }
    }
    return { els: out, shadowRoots: shadowRoots };
  }
  /* The parent for SIBLING purposes, crossing shadow boundaries. Without this the repeat walk stops dead at
     the boundary and reports "nothing repeats" for a row that plainly does.
     A shadow child's siblings live on the ROOT, not on the host — hopping straight to the host would skip the
     collection the rows are actually in and lose the row level entirely. From the root, the next hop up is the
     host. */
  function parentOf(node) {
    if (node.parentElement) { return node.parentElement; }
    var p = node.parentNode;
    if (p && p.children) { return p; }
    return node.host ? node.host : null;
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
    var levels = [], nodes = [], node = el, depth = 0;
    while (node && depth <= MAX_ANCESTOR_DEPTH && levels.length < MAX_LEVELS) {
      var parent = parentOf(node);
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
          /* The ELEMENT each level describes, kept alongside so a caller can act on "the row" without
             re-deriving it from a description and risking a different answer. It never leaves the page. */
          nodes.push(node);
        }
      }
      node = parent;
      depth++;
    }
    return { levels: levels, nodes: nodes, scanned: depth };
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
  /* THE ONLY PLACE PAGE TEXT IS READ, in the whole script. Everything downstream compares it to a string WE
     supplied and keeps a count or an element — never the text itself. One read site is what makes that
     checkable in review rather than merely asserted, and a test pins that this is the only one. */
  function textOf(el) { return norm(el.textContent || ''); }
  /* Fixed-literal comparison on LEAF elements only. The comparison happens here; what survives it is a list of
     ELEMENTS, never their text. Leaves keep it strictly innermost and keep the scan linear — a status word is
     rendered as leaf text, and counting ancestors too would report a row, its container, and the page body as
     three answered inquiries. */
  function labelHits(all, literal) {
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].childElementCount !== 0) { continue; }
      if (textOf(all[i]).indexOf(literal) >= 0) { out.push(all[i]); }
    }
    return out;
  }
  /* Whole digit runs in an element's TEXT. Whole, for the same reason as in attributes: a prefix match would
     silently target a different row. The runs are compared in-page against digits we already hold; neither the
     text nor the runs are ever returned. */
  function textDigitRuns(el) {
    var runs = textOf(el).match(/[0-9]+/g);
    return runs || [];
  }
  function rectOf(el) {
    return el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  }
  /* Painting leaves, the unit of both the label scan and the column scan. */
  function leavesOf(all) {
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].childElementCount === 0 && paints(all[i])) { out.push(all[i]); }
    }
    return out;
  }
  /* Do the hits sit in the same KIND of place? Two leaves saying the same word inside identically shaped
     siblings is a row structure; two leaves in unrelated corners of the page is a filter chip and a legend.
     The comparison is over each hit's WHOLE chain rather than only its innermost level — the first version
     compared level[0] alone and scored 1-of-2 for hits that plainly did share an outer repeat, because one of
     them sat one wrapper deeper. The most common (tag, siblingCount) across all hits is the honest answer. */
  function commonRepeat(hits) {
    var tally = {}, best = null, bestN = 0;
    for (var i = 0; i < hits.length; i++) {
      var levels = repeatLevelsOf(hits[i]).levels, seen = {};
      for (var j = 0; j < levels.length; j++) {
        var key = levels[j].tagName + ':' + levels[j].siblingCount;
        if (seen[key]) { continue; }
        seen[key] = 1;
        tally[key] = (tally[key] || 0) + 1;
        if (tally[key] > bestN) { bestN = tally[key]; best = levels[j]; }
      }
    }
    return { level: best, hits: bestN };
  }
`;
