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
 * ## The boundary
 *
 * Stated once, in `wing-census-primitives.ts`, whose fragment this script includes: attributes are read only
 * from a three-name allowlist, classes are compared in-page for shape equality, and page text is read in
 * exactly one function and reduced to a count or an element before it can be returned. **Buyer text never
 * leaves the page.** That is the honest claim — not "no text is read", which would be false.
 *
 * A test pins that the emitted body assigns no text to any returned field, for the same reason the credential
 * census has its own such test: the failure would be invisible in review and catastrophic in a log.
 */
import type {
  InquiryDigitExpectation,
  InquiryLabelExpectation,
} from "../coupang-wing-inquiry-list";
import { CENSUS_PRIMITIVES_FRAGMENT } from "./wing-census-primitives";

/**
 * The inquiry-specific half: which fixed status word a row carries, the column probe, and the census that
 * assembles them. Everything it stands on — the attribute allowlist, the repeat walk, the single text-read
 * site — comes from the shared primitives fragment.
 */
const INQUIRY_FRAGMENT = `
  /* Which fixed status word this row carries, as the id WE supplied for it — never the word itself, and never
     anything else in the row. Null when the row says none of them. */
  function answeredStateOf(row, LABELS) {
    var leaves; try { leaves = slice(row.querySelectorAll('*')); } catch (e) { leaves = []; }
    if (leaves.length > 500) { leaves = leaves.slice(0, 500); }
    leaves.push(row);
    for (var j = 0; j < LABELS.length; j++) {
      for (var i = 0; i < leaves.length; i++) {
        if (leaves[i].childElementCount !== 0) { continue; }
        if (textOf(leaves[i]).indexOf(LABELS[j].exactText) >= 0) { return LABELS[j].id; }
      }
    }
    return null;
  }
  /* **The column probe.** The identifier the seller can see is not in any attribute — it is printed in a cell,
     under a fixed platform header. So the header is the anchor, and the column it names is the ONLY place any
     text is compared against our identifiers.
     The column is resolved GEOMETRICALLY: cells whose horizontal centre falls inside the header's own span and
     which sit below it. That works for a table, a div grid, and a shadow-rendered list alike — the lesson of
     the row tag, applied one level up rather than re-learned. Column scoping is a safety property, not a
     convenience: an order number in the next column is also a digit run, and matching our inquiry id against
     it would resolve confidently to the wrong row. */
  function columnProbe(all, DIGITS, LABELS, HEADERS) {
    var leaves = leavesOf(all), i, j;
    var headerHits = [], headerId = null;
    for (j = 0; j < HEADERS.length && headerHits.length === 0; j++) {
      for (i = 0; i < leaves.length; i++) {
        if (textOf(leaves[i]).indexOf(HEADERS[j].exactText) >= 0) { headerHits.push(leaves[i]); }
      }
      if (headerHits.length > 0) { headerId = HEADERS[j].id; }
    }
    if (headerHits.length === 0) { return { reason: 'HEADER_NOT_FOUND' }; }
    if (headerHits.length > 1) { return { reason: 'HEADER_AMBIGUOUS', headerId: headerId }; }
    var hrect = rectOf(headerHits[0]);
    if (!hrect) { return { reason: 'HEADER_NOT_FOUND' }; }
    var left = hrect.left, right = hrect.left + hrect.width, below = hrect.top + hrect.height / 2;

    var cells = [], withDigits = 0;
    for (i = 0; i < leaves.length; i++) {
      if (leaves[i] === headerHits[0]) { continue; }
      var r = rectOf(leaves[i]);
      if (!r) { continue; }
      var cx = r.left + r.width / 2;
      if (cx < left || cx > right || r.top < below) { continue; }
      cells.push(leaves[i]);
      if (textDigitRuns(leaves[i]).length > 0) { withDigits++; }
    }
    if (cells.length === 0) { return { reason: 'NO_CELLS', headerId: headerId }; }

    var matches = [], rowsSeen = [], distinct = 0;
    for (j = 0; j < DIGITS.length; j++) {
      var hits = [];
      for (i = 0; i < cells.length; i++) {
        var runs = textDigitRuns(cells[i]);
        for (var k = 0; k < runs.length; k++) {
          /* Whole-run equality, in text exactly as in attributes. */
          if (runs[k] === DIGITS[j].digits) { hits.push(cells[i]); break; }
        }
      }
      hits = innermost(hits);
      var topology = null, affordance = false, state = null, rowDepth = null;
      if (hits.length === 1) {
        topology = topologyOf(hits[0], null);
        /* WHICH repeat level is the row.
           Not the innermost: a cell repeats across a row just as a row repeats down a list, so level 0 is the
           cell the number is printed in — reporting its affordance would answer about the wrong element.
           The row is found rather than indexed: it is the smallest enclosing repeat that carries the inquiry's
           OWN status word, because that is what makes it a row rather than a cell or a section. */
        var walk = repeatLevelsOf(hits[0]);
        var row = hits[0];
        for (var L = 0; L < walk.nodes.length; L++) {
          var st = answeredStateOf(walk.nodes[L], LABELS);
          if (st !== null) { row = walk.nodes[L]; state = st; rowDepth = walk.levels[L].depth; break; }
        }
        /* No level says a status word. Fall back to the OUTERMOST measured repeat and report the state as
           unknown — a row we cannot read the state of is a finding, not a reason to claim one. */
        if (state === null && walk.nodes.length > 0) {
          row = walk.nodes[walk.nodes.length - 1];
          rowDepth = walk.levels[walk.levels.length - 1].depth;
        }
        affordance = hasDetailAffordance(row);
        if (rowsSeen.indexOf(row) < 0) { rowsSeen.push(row); distinct++; }
      }
      matches.push({
        id: DIGITS[j].id,
        matchCount: hits.length,
        topology: topology,
        rowLevelDepth: rowDepth,
        hasDetailAffordance: affordance,
        answeredStateId: state
      });
    }
    return {
      reason: 'OK',
      headerId: headerId,
      cellsInColumn: cells.length,
      cellsWithDigits: withDigits,
      distinctRowsMatched: distinct,
      matches: matches
    };
  }
  function census(DIGITS, LABELS, HEADERS) {
    var collected = collectAll();
    if (collected === null) { return { reason: 'SCAN_TRUNCATED' }; }
    var all = collected.els;
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
      var shared = commonRepeat(lhits);
      labelCounts.push({
        id: LABELS[j].id,
        elementCount: lhits.length,
        topology: lhits.length > 0 ? topologyOf(lhits[0], null) : null,
        /* The repeat the hits AGREE on — the row candidate, when there is one. */
        sharedRepeatLevel: shared.level,
        hitsSharingRepeatShape: shared.hits
      });
    }

    return {
      reason: 'OK',
      elementsScanned: all.length,
      shadowRootsFound: collected.shadowRoots,
      elementsWithAnchorAttributes: withAnchors,
      anchorDigitRunLengths: allLengths,
      anchors: anchors,
      labelCounts: labelCounts,
      columnProbe: columnProbe(all, DIGITS, LABELS, HEADERS)
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
  headers: readonly InquiryLabelExpectation[] = [],
): string {
  const digitSpecs = digits.map((d) => ({ id: d.id, digits: d.digits }));
  const labelSpecs = labels.map((l) => ({ id: l.id, exactText: l.exactText }));
  const headerSpecs = headers.map((h) => ({ id: h.id, exactText: h.exactText }));
  return [
    "(function () {",
    CENSUS_PRIMITIVES_FRAGMENT,
    INQUIRY_FRAGMENT,
    "  var DIGITS = " + JSON.stringify(digitSpecs) + ";",
    "  var LABELS = " + JSON.stringify(labelSpecs) + ";",
    "  var HEADERS = " + JSON.stringify(headerSpecs) + ";",
    "  return census(DIGITS, LABELS, HEADERS);",
    "})()",
  ].join("\n");
}
