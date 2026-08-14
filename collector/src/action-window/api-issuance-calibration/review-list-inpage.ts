/**
 * **The in-page half of the 상품평 structure discovery.** One script, no terminal that returns text, and no
 * question asked about what any customer wrote.
 *
 * ## What is different here from every earlier census
 *
 * Every other probe in this directory had something to look for. This one is looking for **what the screen is**.
 * SellerOps holds no review id, no rating and no review date — Coupang publishes no review API to have supplied
 * them — so the only strings we can legitimately hand the page are Coupang's own fixed UI words, and the only
 * findings are counts and shapes around wherever those words land.
 *
 * ## The second attribute allowlist, named rather than smuggled
 *
 * The identifier allowlist (`href` / `id` / `data-*`) is unchanged and still the only place a digit is looked
 * for. But deciding whether `최근 1개월` is a pressable RANGE control or a printed caption cannot be done from
 * tag names alone — a `div[role=button]` is a control, and calling it furniture would report that the screen
 * offers no date filter when it does, which is the reading incremental collection depends on.
 *
 * So a second, deliberately tiny allowlist exists for STRUCTURE classification, and it is stated here rather
 * than left implicit:
 *
 *  - `role` and `type` — compared against fixed literals WE supply (`button`, `submit`, `date`);
 *  - `aria-valuenow` and `contenteditable` — tested for PRESENCE only.
 *
 * None of their values travels. Nothing else is read from any attribute, for any purpose.
 *
 * ## What may not cross
 *
 * Review bodies, buyer names, product names, image `src` and video `src` are all present on this screen and
 * **none of them is read into any returned field**. Page text is read in exactly one function (the shared
 * primitives' `textOf`) and compared there against fixed platform words and shape patterns we supply, reduced
 * to a count before it can be returned. A date comes back as *which pattern matched, and how many times* —
 * never a date. **Page text never leaves the page.**
 */
import type {
  ReviewDigitExpectation,
  ReviewLabelExpectation,
  ReviewTextShape,
} from "../coupang-wing-review-list";
import { CENSUS_PRIMITIVES_FRAGMENT } from "./wing-census-primitives";

/**
 * The review-specific half. Everything it stands on — the attribute allowlist, the repeat walk, the single
 * text-read site — comes from the shared primitives fragment.
 */
const REVIEW_FRAGMENT = `
  var MAX_UNITS = 200;
  var MAX_UNIT_NODES = 400;
  /* THE STRUCTURE ATTRIBUTE ALLOWLIST — read only as described, never returned. */
  function attrEquals(el, name, literal) {
    if (!el.getAttribute) { return false; }
    var v = el.getAttribute(name);
    return v !== null && String(v).toLowerCase() === literal;
  }
  function hasAttr(el, name) {
    return !!el.hasAttribute && el.hasAttribute(name);
  }
  /* A control a seller could actually press. Tag first, then role — a div[role=button] is a control, and a
     probe that only knew about <button> would report no date filter on a screen that has one. */
  function isInteractive(el) {
    var tag = String(el.tagName || '').toUpperCase();
    if (tag === 'BUTTON') { return true; }
    if (tag === 'A') { return hasAttr(el, 'href'); }
    if (tag === 'INPUT') { return attrEquals(el, 'type', 'submit') || attrEquals(el, 'type', 'button'); }
    return attrEquals(el, 'role', 'button') || attrEquals(el, 'role', 'link');
  }
  /* The nearest interactive ancestor, including the element itself. A label is usually a <span> INSIDE the
     button, so testing only the hit would classify every real control as printed text. */
  function interactiveAt(el) {
    var node = el, depth = 0;
    while (node && depth <= 4) {
      if (node.tagName && isInteractive(node)) { return node; }
      node = parentOf(node);
      depth++;
    }
    return null;
  }
  /* Hits on a fixed literal, split by whether they are pressable. The split is the finding: a printed
     '최근 1개월' is a caption describing what is already shown, a pressable one is a range the acquisition
     could ASK for, and only the second makes incremental collection possible. */
  function controlHits(all, literal) {
    var interactive = [], statics = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].childElementCount !== 0) { continue; }
      if (textOf(all[i]).indexOf(literal) < 0) { continue; }
      var ctrl = interactiveAt(all[i]);
      if (ctrl) { if (interactive.indexOf(ctrl) < 0) { interactive.push(ctrl); } }
      else { statics.push(all[i]); }
    }
    return { interactive: interactive, statics: statics };
  }
  /* **The review unit, resolved by AGREEMENT.** Each field label votes for every (tag, siblingCount) shape in
     its hits' chains, once each; the shape the most DISTINCT labels vote for wins. Two independent labels
     landing in the same repeating shape is what makes it a row — one label agreeing with itself is a repeated
     word. The row tag is never assumed; it comes back as a finding. */
  /* The ELEMENTS of one candidate shape. Found by walking a hit's chain to the level that matches, then taking
     that element's same-tag siblings — the units themselves, so per-unit questions are asked of real elements
     rather than inferred from a description. */
  function unitsForKey(hitLists, key) {
    var anchor = null;
    for (var a = 0; a < hitLists.length && anchor === null; a++) {
      for (var b = 0; b < hitLists[a].length && anchor === null; b++) {
        var walk = repeatLevelsOf(hitLists[a][b]);
        for (var L = 0; L < walk.levels.length; L++) {
          if (walk.levels[L].tagName + ':' + walk.levels[L].siblingCount === key) { anchor = walk.nodes[L]; break; }
        }
      }
    }
    var nodes = [];
    if (!anchor) { return nodes; }
    var parent = parentOf(anchor);
    var tag = String(anchor.tagName || '').toUpperCase();
    if (parent && parent.children) {
      for (var k = 0; k < parent.children.length && nodes.length < MAX_UNITS; k++) {
        if (String(parent.children[k].tagName || '').toUpperCase() === tag) { nodes.push(parent.children[k]); }
      }
    } else { nodes.push(anchor); }
    return nodes;
  }
  /* Does this element hold one review's worth of evidence — a date, a rating token? Fixed SHAPE patterns we
     supply, compared in-page, reduced to a boolean. */
  function hasShapeEvidence(unit, regexes) {
    var nodes = within(unit);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].childElementCount !== 0) { continue; }
      var t = textOf(nodes[i]);
      for (var r = 0; r < regexes.length; r++) { if (regexes[r] && regexes[r].test(t)) { return true; } }
    }
    return false;
  }
  function resolveUnit(hitLists, regexes) {
    var tally = {}, levelOf = {}, bestN = 0;
    for (var i = 0; i < hitLists.length; i++) {
      var voted = {};
      for (var h = 0; h < hitLists[i].length; h++) {
        var levels = repeatLevelsOf(hitLists[i][h]).levels;
        for (var j = 0; j < levels.length; j++) {
          var key = levels[j].tagName + ':' + levels[j].siblingCount;
          if (voted[key]) { continue; }
          voted[key] = 1;
          tally[key] = (tally[key] || 0) + 1;
          if (!levelOf[key]) { levelOf[key] = levels[j]; }
          if (tally[key] > bestN) { bestN = tally[key]; }
        }
      }
    }
    if (bestN === 0) { return { level: null, labelsAgreeing: 0, nodes: [] }; }
    /* **The tie is the hard part, and depth alone gets it wrong.**
       On a table the field words live in the HEADER, not in the rows, so every label votes for the header CELL
       repeat and for the row repeat equally — and for whatever page SECTION repeat encloses them both. Taking
       the innermost resolves the unit to a header cell and then asks whether that cell contains a photo; taking
       the outermost resolves it to "grid, filters, pager" and calls the pager a review.
       So tied candidates are separated by what they CONTAIN: the review unit is the repeat whose members most
       consistently each hold one review's worth of evidence — a date, a rating token. A header cell holds none.
       A page section holds all of them in one member and none in the others. A row holds one each.
       Depth breaks what remains, outward, so a wrapper never beats the row it wraps. */
    var best = null, bestScore = -1, bestNodes = [];
    for (var key2 in tally) {
      if (tally[key2] !== bestN) { continue; }
      var nodes2 = unitsForKey(hitLists, key2);
      if (nodes2.length === 0) { continue; }
      var withEvidence = 0;
      for (var n = 0; n < nodes2.length; n++) { if (hasShapeEvidence(nodes2[n], regexes)) { withEvidence++; } }
      var score = withEvidence / nodes2.length;
      var better = score > bestScore ||
        (score === bestScore && best !== null && levelOf[key2].depth > levelOf[best].depth);
      if (better) { bestScore = score; best = key2; bestNodes = nodes2; }
    }
    if (best === null) { return { level: null, labelsAgreeing: 0, nodes: [] }; }
    return { level: levelOf[best], labelsAgreeing: bestN, nodes: bestNodes };
  }
  /* Descendants of one unit, bounded. Used for every per-unit question; nothing here reads a value. */
  function within(unit) {
    var kids; try { kids = slice(unit.querySelectorAll('*')); } catch (e) { kids = []; }
    if (kids.length > MAX_UNIT_NODES) { kids = kids.slice(0, MAX_UNIT_NODES); }
    kids.push(unit);
    return kids;
  }
  function anyTag(nodes, tag) {
    for (var i = 0; i < nodes.length; i++) { if (String(nodes[i].tagName || '').toUpperCase() === tag) { return true; } }
    return false;
  }
  /* A rating widget, asked two ways because neither alone is reliable: an accessible slider exposes
     aria-valuenow, and a CSS star strip exposes a class token. Presence of the attribute NAME, and a class
     SHAPE compared in-page against tokens we supply. Neither value travels. */
  function anyRatingAria(nodes) {
    for (var i = 0; i < nodes.length; i++) { if (hasAttr(nodes[i], 'aria-valuenow')) { return true; } }
    return false;
  }
  function anyStarClass(nodes, TOKENS) {
    for (var i = 0; i < nodes.length; i++) {
      var shape = classShapeOf(nodes[i]).toLowerCase();
      if (shape.length === 0) { continue; }
      for (var t = 0; t < TOKENS.length; t++) { if (shape.indexOf(TOKENS[t]) >= 0) { return true; } }
    }
    return false;
  }
  /* A per-unit DETAIL LINK: an identifier and the only route to anything the list does not show, in one. The
     address itself is never read — only that an anchor with an href is inside the unit. */
  function anyDetailLink(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (String(nodes[i].tagName || '').toUpperCase() === 'A' && hasAttr(nodes[i], 'href')) { return true; }
    }
    return false;
  }
  /* **The identifier reading.** For each digit LENGTH, how many units carry a run of it and how many DISTINCT
     values those runs have. Two counts, because a dedupe key needs two properties — present on each review and
     different for each — and one count cannot express both. The values are compared here and never returned. */
  function tallyRuns(tally, source, length, value, unitIndex) {
    var key = source + ':' + length;
    if (!tally[key]) { tally[key] = { source: source, digitLength: length, units: {}, values: {} }; }
    tally[key].units[unitIndex] = 1;
    tally[key].values[value] = 1;
  }
  function idCandidatesFrom(tally) {
    var out = [];
    for (var key in tally) {
      var t = tally[key], u = 0, v = 0, k;
      for (k in t.units) { u++; }
      for (k in t.values) { v++; }
      out.push({ source: t.source, digitLength: t.digitLength, unitsCarrying: u, distinctValues: v });
    }
    return out;
  }
  function anyOurDigits(nodes, DIGITS) {
    for (var i = 0; i < nodes.length; i++) {
      var runs = anchorRunsOf(nodes[i]);
      for (var r = 0; r < runs.length; r++) {
        for (var d = 0; d < DIGITS.length; d++) { if (runs[r].digits === DIGITS[d].digits) { return true; } }
      }
      if (nodes[i].childElementCount !== 0) { continue; }
      var printed = textDigitRuns(nodes[i]);
      for (var p = 0; p < printed.length; p++) {
        for (var e = 0; e < DIGITS.length; e++) { if (printed[p] === DIGITS[e].digits) { return true; } }
      }
    }
    return false;
  }
  function printedLengthsOf(nodes, seen, out) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].childElementCount !== 0) { continue; }
      var runs = textDigitRuns(nodes[i]);
      for (var r = 0; r < runs.length; r++) {
        var len = runs[r].length;
        if (!seen[len]) { seen[len] = 1; out.push(len); }
      }
    }
  }
  /* Paging and range controls, as counts of structure. This is what says how much history one acquisition
     could reach — the difference between a channel we can backfill and one we can only watch forwards. */
  function paginationOf(all) {
    var dateInputs = 0, selects = 0, pagerLeaves = [];
    for (var i = 0; i < all.length; i++) {
      var tag = String(all[i].tagName || '').toUpperCase();
      if (tag === 'INPUT' && attrEquals(all[i], 'type', 'date')) { dateInputs++; }
      if (tag === 'SELECT') { selects++; }
      if (all[i].childElementCount === 0 && /^[0-9]{1,3}$/.test(textOf(all[i]))) { pagerLeaves.push(all[i]); }
    }
    /* A page number is only a pager when it repeats with its neighbours; a lone '3' is a quantity. */
    var shared = commonRepeat(pagerLeaves);
    var isPager = shared.hits >= 2;
    /* How far back the screen ADMITS to going — the difference between a channel that can be backfilled and
       one that can only be watched forward. A page count is about the list, not about anyone. */
    var highest = 0;
    if (isPager) {
      for (var h = 0; h < pagerLeaves.length; h++) {
        var v = parseInt(textOf(pagerLeaves[h]), 10);
        if (v > highest) { highest = v; }
      }
    }
    return {
      dateInputCount: dateInputs,
      selectCount: selects,
      numericPagerCount: isPager ? shared.hits : 0,
      highestPagerNumber: highest
    };
  }
  function census(LABELS, CONTROLS, SHAPES, DIGITS, CLASS_TOKENS) {
    var collected = collectAll();
    if (collected === null) { return { reason: 'SCAN_TRUNCATED' }; }
    var all = collected.els;
    if (all.length === 0) { return { reason: 'NO_ELEMENTS' }; }

    var i, j, withAnchors = 0, seenLengths = {}, allLengths = [];
    for (i = 0; i < all.length; i++) {
      var runs = anchorRunsOf(all[i]);
      if (runs.length === 0) { continue; }
      withAnchors++;
      for (var q = 0; q < runs.length; q++) {
        var qlen = runs[q].digits.length;
        if (!seenLengths[qlen]) { seenLengths[qlen] = 1; allLengths.push(qlen); }
      }
    }

    /* The sort / period / range controls, read independently of the row structure — a screen whose layout we
       fail to resolve can still say whether a range can be asked for. */
    var controlAffordances = [];
    for (j = 0; j < CONTROLS.length; j++) {
      var ch = controlHits(all, CONTROLS[j].exactText);
      controlAffordances.push({
        id: CONTROLS[j].id,
        interactiveCount: ch.interactive.length,
        staticCount: ch.statics.length,
        controls: ch.interactive
      });
    }

    var hitLists = [], labelCounts = [];
    for (j = 0; j < LABELS.length; j++) {
      var hits = labelHits(all, LABELS[j].exactText);
      hitLists.push(hits);
      var shared = commonRepeat(hits);
      labelCounts.push({
        id: LABELS[j].id,
        elementCount: hits.length,
        sharedRepeatLevel: shared.level,
        hitsSharingRepeatShape: shared.hits
      });
    }

    /* The shape patterns, compiled once: they separate tied unit candidates AND report the column shapes. */
    var regexes = [];
    for (j = 0; j < SHAPES.length; j++) {
      try { regexes.push(new RegExp(SHAPES[j].pattern)); } catch (e) { regexes.push(null); }
    }

    var unit = resolveUnit(hitLists, regexes);
    var units = unit.nodes;
    var withDetail = 0, withImg = 0, withVideo = 0, withAria = 0, withStar = 0, withOurs = 0, withLink = 0;
    var attrSeen = {}, attrLengths = [], printSeen = {}, printLengths = [], idTally = {};
    for (i = 0; i < units.length; i++) {
      var nodes = within(units[i]);
      if (hasDetailAffordance(units[i])) { withDetail++; }
      if (anyDetailLink(nodes)) { withLink++; }
      if (anyTag(nodes, 'IMG')) { withImg++; }
      if (anyTag(nodes, 'VIDEO')) { withVideo++; }
      if (anyRatingAria(nodes)) { withAria++; }
      if (anyStarClass(nodes, CLASS_TOKENS)) { withStar++; }
      if (DIGITS.length > 0 && anyOurDigits(nodes, DIGITS)) { withOurs++; }
      var lens = digitLengthsOf(units[i], true);
      for (var L = 0; L < lens.length; L++) { if (!attrSeen[lens[L]]) { attrSeen[lens[L]] = 1; attrLengths.push(lens[L]); } }
      printedLengthsOf(nodes, printSeen, printLengths);
      /* THE IDENTIFIER READING. Every run in this unit, tallied by source and length — how many units carry
         one, and how many distinct values exist. The values live only in this object's keys and never leave. */
      for (var d = 0; d < nodes.length; d++) {
        var aruns = anchorRunsOf(nodes[d]);
        for (var ar = 0; ar < aruns.length; ar++) {
          tallyRuns(idTally, 'ATTRIBUTE', aruns[ar].digits.length, aruns[ar].digits, i);
        }
        if (nodes[d].childElementCount !== 0) { continue; }
        var pruns = textDigitRuns(nodes[d]);
        for (var pr = 0; pr < pruns.length; pr++) {
          tallyRuns(idTally, 'PRINTED', pruns[pr].length, pruns[pr], i);
        }
      }
    }

    /* How many of each control sit INSIDE a review unit rather than in page furniture. A '최근 1개월' chip in
       the global navigation is not this list's range control, and this is what tells them apart. */
    var inside = [];
    for (j = 0; j < controlAffordances.length; j++) {
      var n = 0;
      for (var k = 0; k < controlAffordances[j].controls.length; k++) {
        for (i = 0; i < units.length; i++) {
          if (units[i].contains && units[i].contains(controlAffordances[j].controls[k])) { n++; break; }
        }
      }
      inside.push({
        id: controlAffordances[j].id,
        interactiveCount: controlAffordances[j].interactiveCount,
        staticCount: controlAffordances[j].staticCount,
        insideUnitCount: n
      });
    }

    var textShapes = [];
    for (j = 0; j < SHAPES.length; j++) {
      var re = regexes[j];
      var leafCount = 0, inUnit = 0;
      if (re) {
        for (i = 0; i < all.length; i++) {
          if (all[i].childElementCount !== 0) { continue; }
          if (!re.test(textOf(all[i]))) { continue; }
          leafCount++;
          for (var u = 0; u < units.length; u++) {
            if (units[u].contains && units[u].contains(all[i])) { inUnit++; break; }
          }
        }
      }
      textShapes.push({ id: SHAPES[j].id, leafCount: leafCount, unitCount: inUnit });
    }

    return {
      reason: 'OK',
      elementsScanned: all.length,
      shadowRootsFound: collected.shadowRoots,
      elementsWithAnchorAttributes: withAnchors,
      anchorDigitRunLengths: allLengths,
      controlAffordances: inside,
      labelCounts: labelCounts,
      textShapes: textShapes,
      unit: {
        level: unit.level,
        labelsAgreeing: unit.labelsAgreeing,
        unitCount: units.length,
        unitsWithDetailAffordance: withDetail,
        unitsWithImage: withImg,
        unitsWithVideo: withVideo,
        unitsWithRatingAria: withAria,
        unitsWithStarLikeClass: withStar,
        unitsMatchingOurDigits: withOurs,
        unitAttributeDigitLengths: attrLengths,
        unitPrintedDigitLengths: printLengths,
        unitsWithDetailLink: withLink,
        idCandidates: idCandidatesFrom(idTally)
      },
      pagination: paginationOf(all)
    };
  }
`;

/**
 * The census script. Every string it compares against is supplied here and JSON-embedded, so the page never
 * contributes a string to the result — only counts, tag names, and the ids we handed in.
 */
export function buildReviewListCensusScript(
  labels: readonly ReviewLabelExpectation[],
  controls: readonly ReviewLabelExpectation[],
  shapes: readonly ReviewTextShape[],
  digits: readonly ReviewDigitExpectation[] = [],
  classTokens: readonly string[] = [],
): string {
  return [
    "(function () {",
    CENSUS_PRIMITIVES_FRAGMENT,
    REVIEW_FRAGMENT,
    "  var LABELS = " + JSON.stringify(labels.map((l) => ({ id: l.id, exactText: l.exactText }))) + ";",
    "  var CONTROLS = " + JSON.stringify(controls.map((l) => ({ id: l.id, exactText: l.exactText }))) + ";",
    "  var SHAPES = " + JSON.stringify(shapes.map((s) => ({ id: s.id, pattern: s.pattern }))) + ";",
    "  var DIGITS = " + JSON.stringify(digits.map((d) => ({ id: d.id, digits: d.digits }))) + ";",
    "  var CLASS_TOKENS = " + JSON.stringify(classTokens.map((t) => t.toLowerCase())) + ";",
    "  return census(LABELS, CONTROLS, SHAPES, DIGITS, CLASS_TOKENS);",
    "})()",
  ].join("\n");
}
