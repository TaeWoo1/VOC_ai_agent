/**
 * **The in-page half of the 고객문의 list census.** One script, one terminal, and no way to return text.
 *
 * ## Why this one is structured differently from the credential census
 *
 * The credential resolver needed two terminals sharing one resolution, because a read of the resolved cell had
 * to exist somewhere. Here **no terminal reads a row's content at all** — not behind a flag, not after a
 * barrier, not ever. The rows carry what a buyer wrote, and there is no product reason to bring it back: the
 * match runs on a digit string we already hold and returns a count.
 *
 * So the safety property is stronger and simpler than the credential one, and it is worth stating in the form
 * a reviewer can check: **`textContent` is read in exactly one place, inside `hasLabel`, and reduced to a
 * boolean before it can reach a returned field.** A test pins that the emitted body assigns no text anywhere
 * else, for the same reason the credential census has its own such test — the failure would be invisible in
 * review and catastrophic in a log.
 *
 * ## What it counts, and why each one is needed
 *
 *  - **per-kind row counts** — structure, reported rather than chosen between. The first version REFUSED when
 *    rows appeared under two kinds; against the real WING screen that refused immediately and correctly by its
 *    own rule, because an application page has navigation `<li>`s and a data `<table>` at once. Targeting does
 *    not need to know which list is the list — it needs exactly one element to carry the identifier, and a
 *    navigation item never carries an inquiry id.
 *  - **rows carrying digits** — whether the page carries machine-readable ids at all. If this is 0, the whole
 *    targeting approach is refuted and the calibration says so instead of being retried with a text rule.
 *  - **per-expectation match counts** — the actual targeting question, asked once per digit string we hold.
 *  - **matched attribute NAMES** — only when exactly one row matched, so the next unit can build a locator
 *    from a measurement rather than a guess. Names are schema; values never cross.
 *  - **fixed platform label counts** — how many rows say `답변완료` / `미답변`, matched whole against strings
 *    WE supply. That is how answered-ness becomes distinguishable without reading the row.
 *  - **detail affordance count** — whether a row is even a way into a detail view.
 *
 * Written in ES5 with no closures over builder state, for the same reason every other in-page script here is:
 * the bundler's `keepNames` rewrites arrow functions into `__name(...)` calls that do not exist in the page.
 */
import type {
  InquiryDigitExpectation,
  InquiryLabelExpectation,
} from "../coupang-wing-inquiry-list";

/**
 * The shared reading half. Defines `census(DIGITS, LABELS)` over the row set it discovers.
 *
 * `digitsOf` extracts whole digit runs from attribute values — whole, because a prefix match (`1584` inside
 * `158421449`) would silently target a different inquiry, and that is indistinguishable from success in every
 * log we would ever look at.
 */
const CENSUS_FRAGMENT = `
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var CAP = 20000;
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
  function queryAll(sel) {
    var out; try { out = slice(document.querySelectorAll(sel)); } catch (e) { return null; }
    return out.length > CAP ? null : out;
  }
  /* The row sets, one per container kind. A kind contributes only if it has PAINTING rows: a hidden template
     row is not a row the seller can be pointed at. */
  function rowsOfKind(kind) {
    var sel = kind === 'TABLE' ? 'table tr' : (kind === 'LIST' ? 'ul li,ol li' : '[role=row]');
    var all = queryAll(sel);
    if (all === null) { return null; }
    var vis = [];
    for (var i = 0; i < all.length; i++) { if (paints(all[i])) { vis.push(all[i]); } }
    return vis;
  }
  /* Every whole digit run in every attribute of this element and its descendants, with the attribute name it
     came from. Values are compared in-page and never returned; only the NAME can travel. */
  function digitRunsOf(row) {
    var out = [];
    var nodes = [row];
    var kids; try { kids = slice(row.querySelectorAll('*')); } catch (e) { kids = []; }
    if (kids.length > 500) { kids = kids.slice(0, 500); }
    nodes = nodes.concat(kids);
    for (var i = 0; i < nodes.length; i++) {
      var attrs = nodes[i].attributes;
      if (!attrs) { continue; }
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        var value = String(attrs[a].value == null ? '' : attrs[a].value);
        var runs = value.match(/[0-9]+/g);
        if (!runs) { continue; }
        for (var d = 0; d < runs.length; d++) { out.push({ name: name, digits: runs[d] }); }
      }
    }
    return out;
  }
  /* THE only place row text is read, and it becomes a boolean here — inside the page, before returning. */
  function hasLabel(row, wanted) { return norm(row.textContent || '').indexOf(wanted) >= 0; }
  function hasDetailAffordance(row) {
    var links; try { links = slice(row.querySelectorAll('a[href],button')); } catch (e) { return false; }
    for (var i = 0; i < links.length; i++) { if (paints(links[i])) { return true; } }
    return false;
  }
  /* Keep only the INNERMOST matches. A <tr> that contains a matching <li> would otherwise count twice and
     read as an ambiguous target — a false refusal on a page that actually identifies the row exactly once. */
  function innermost(hits) {
    var out = [];
    for (var i = 0; i < hits.length; i++) {
      var contained = false;
      for (var j = 0; j < hits.length; j++) {
        if (i !== j && hits[i].el !== hits[j].el && hits[i].el.contains && hits[i].el.contains(hits[j].el)) {
          contained = true; break;
        }
      }
      if (!contained) { out.push(hits[i]); }
    }
    return out;
  }
  function census(DIGITS, LABELS) {
    var kinds = ['TABLE', 'LIST', 'GRID'];
    var counts = { table: 0, list: 0, grid: 0 };
    var rows = [], kindOf = [], i, j, k;
    for (k = 0; k < kinds.length; k++) {
      var found = rowsOfKind(kinds[k]);
      if (found === null) { return { reason: 'SCAN_TRUNCATED' }; }
      counts[kinds[k].toLowerCase()] = found.length;
      for (i = 0; i < found.length; i++) {
        /* Deduplicate across kinds: an <li role=row> is one row, not two. */
        if (rows.indexOf(found[i]) < 0) { rows.push(found[i]); kindOf.push(kinds[k]); }
      }
    }
    if (rows.length === 0) { return { reason: 'NO_ROWS' }; }

    var withDigits = 0, withDetail = 0;
    var matches = [];
    for (i = 0; i < DIGITS.length; i++) { matches.push({ id: DIGITS[i].id, hits: [], names: {} }); }
    var labelCounts = [];
    for (i = 0; i < LABELS.length; i++) { labelCounts.push({ id: LABELS[i].id, rowCount: 0 }); }

    for (i = 0; i < rows.length; i++) {
      var runs = digitRunsOf(rows[i]);
      if (runs.length > 0) { withDigits++; }
      if (hasDetailAffordance(rows[i])) { withDetail++; }
      for (j = 0; j < DIGITS.length; j++) {
        var wantDigits = DIGITS[j].digits, hit = false;
        for (var r = 0; r < runs.length; r++) {
          /* Whole-run equality. A substring match here would target a different inquiry silently. */
          if (runs[r].digits === wantDigits) { hit = true; matches[j].names[runs[r].name] = 1; }
        }
        if (hit) { matches[j].hits.push({ el: rows[i], kind: kindOf[i] }); }
      }
      for (j = 0; j < LABELS.length; j++) {
        if (hasLabel(rows[i], LABELS[j].exactText)) { labelCounts[j].rowCount++; }
      }
    }
    var digitMatches = [], primaryKind = 'NONE';
    for (i = 0; i < matches.length; i++) {
      var hits = innermost(matches[i].hits);
      var names = [];
      /* Attribute names only travel when the target is unambiguous — otherwise they describe several rows. */
      if (hits.length === 1) {
        for (var key in matches[i].names) { names.push(key); }
        /* The FIRST expectation is the primary one; its matched row is the kind worth naming. */
        if (i === 0) { primaryKind = hits[0].kind; }
      }
      digitMatches.push({
        id: matches[i].id,
        rowMatchCount: hits.length,
        matchedAttributeNames: names
      });
    }
    return {
      reason: 'OK',
      containerKind: primaryKind,
      rowCounts: counts,
      rowsScanned: rows.length,
      rowsWithDigits: withDigits,
      rowsWithDetailAffordance: withDetail,
      digitMatches: digitMatches,
      labelCounts: labelCounts
    };
  }
`;

/**
 * The census script. `digits` are identifiers SellerOps already holds (a channel inquiry id, a seller product
 * id); `labels` are fixed Coupang UI words. Both are supplied by the caller and JSON-embedded, so the page
 * never contributes a string to the result — only counts and the names of attributes that matched.
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
