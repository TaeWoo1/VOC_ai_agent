/**
 * **The in-page half of the credential value-cell resolution** — one shared resolver, two terminals.
 *
 * ## Why one resolver and two terminals, rather than one script with a flag
 *
 * The calibration and the read must agree about WHICH element holds a key. If they were two implementations,
 * the calibration would certify a locator the read does not use, which is the shape of every guard this
 * workstream has had to repair: a check one layer away from the thing it checks.
 *
 * They are also not one script with a `mode` parameter, because that script would contain an expression that
 * returns a secret, reachable from the census call site by a one-character mistake. So the resolver — every line
 * that decides which element is the value — is shared verbatim, and the two terminals are separate builders.
 *
 * The property that matters, stated precisely: **the census terminal assigns cell text to no returned field.**
 * It calls `cellNonEmpty`, which calls `cellText` inside the page and reduces it to one boolean before anything
 * crosses the boundary — the same shape as the vendor-form census's `filledTextInputCount`. Only
 * {@link buildCredentialCellReadScript}'s terminal writes `cellText(...)` into a value that is returned, and a
 * test pins that the census's emitted body does not.
 *
 * ## The resolution, in one place
 *
 * A fixed label is matched by whole normalized text and must PAINT (the same two rules as every other locate
 * here). From the label's own `th`/`td`:
 *
 *  - **`TH_NEXT_TD`** — the next sibling cell is a `td`. The row-headed shape (label left, value beside it), and
 *    it is tried FIRST because it is the more specific: in a column-headed table the next sibling is another
 *    `th`, so this cannot fire there.
 *  - **`TH_COLUMN_TD`** — the label's column index, taken in the cell at that index in every `td`-bearing row of
 *    the same table. The column-headed shape, which is what `WING_CREDENTIAL_REGION_EVIDENCE` measured the labels
 *    to be in.
 *
 * Every candidate is counted rather than the first being taken. A table with two `td`-bearing rows returns 2, and
 * 2 is a refusal — there is no structural reason to prefer either row, and picking one would be a guess about
 * which of two things is the seller's key.
 *
 * Written in ES5 with no closures over builder state, for the same reason every other in-page script here is: the
 * bundler's `keepNames` rewrites arrow functions into `__name(...)` calls that do not exist in the page.
 */
import type { CredentialCellRequest } from "../coupang-wing-credential-cells";

/**
 * The shared half: matching, painting, cell resolution, and the extraction rule. Both terminals inline this
 * verbatim. It defines `resolveAll(SPECS)` returning one record per spec, each carrying the resolved element
 * itself in `cell` — which the census terminal reads structure from and never returns.
 */
const RESOLVER_FRAGMENT = `
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* Text read ONLY to compare against a KNOWN fixed label; nothing derived from it is returned. */
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
  /* Matches split into painting / not — "nothing matched" and "nothing visible matched" are different faults. */
  function matching(spec) {
    var cands; try { cands = slice(document.querySelectorAll(spec.candidateQuery)); } catch (e) { return { visible: [], hidden: 0, truncated: true }; }
    var want = norm(spec.exactText), vis = [], hid = 0, CAP = 20000;
    /* A cap that SKIPS the tail turns "matched more than once" into "matched once" — a fail-OPEN in the guard
       that is supposed to refuse an ambiguous label, on a locator that resolves to a secret. A page bigger than
       the cap is reported as truncated and refused, never scanned partially. */
    if (cands.length > CAP) { return { visible: [], hidden: 0, truncated: true }; }
    for (var i = 0; i < cands.length; i++) {
      if (accName(cands[i]) !== want) { continue; }
      if (paints(cands[i])) { vis.push(cands[i]); } else { hid++; }
    }
    return { visible: vis, hidden: hid, truncated: false };
  }
  /* Which TABLE a cell belongs to, as an ordinal among the document's tables. An integer, never an identity —
     and enough to answer "did all three labels resolve inside the same table". */
  function tableOrdinal(el) {
    var t = closestTable(el);
    if (!t) { return -1; }
    var tables; try { tables = slice(document.querySelectorAll('table')); } catch (e) { return -1; }
    return tables.indexOf(t);
  }
  function isCell(el) { return !!el && (el.tagName === 'TD' || el.tagName === 'TH'); }
  function closestCell(el) {
    var n = el;
    while (n && n.tagName !== 'TD' && n.tagName !== 'TH') { n = n.parentElement; }
    return n;
  }
  function closestTable(el) {
    var n = el;
    while (n && n.tagName !== 'TABLE') { n = n.parentElement; }
    return n;
  }
  /* The fields a cell holds. A copyable key is as likely to be a readonly input as text, so which one the cell
     is decides how the value is taken — and more than one field means no rule here says which. */
  function cellFields(cell) {
    var f; try { f = slice(cell.querySelectorAll('input,textarea')); } catch (e) { return []; }
    return f;
  }
  /* THE extraction rule, defined once. The census never calls this; only the read terminal does. */
  function cellText(cell) {
    var fields = cellFields(cell);
    if (fields.length === 1) { return String(fields[0].value == null ? '' : fields[0].value).trim(); }
    return String(cell.textContent == null ? '' : cell.textContent).trim();
  }
  /* Non-emptiness WITHOUT returning the value: the same extraction, reduced to one bit inside the page. */
  function cellNonEmpty(cell) { return cellText(cell).length > 0; }
  function resolveOne(spec) {
    var m = matching(spec);
    var out = { id: spec.id, labelVisibleCount: m.visible.length, labelHiddenCount: m.hidden, cell: null };
    if (m.truncated) { out.scanTruncated = true; return out; }
    if (m.visible.length !== 1) { return out; }
    var label = m.visible[0];
    out.labelTag = label.tagName;
    var header = closestCell(label) || label;
    /* Row-headed first: it is the more specific shape and cannot fire on a column-headed header row. */
    var next = header.nextElementSibling;
    if (next && next.tagName === 'TD') {
      out.association = 'TH_NEXT_TD';
      out.candidateCellCount = 1;
      out.cell = next;
    } else {
      var row = header.parentElement;
      var table = closestTable(header);
      if (!row || row.tagName !== 'TR' || !table) { out.association = 'NONE'; return out; }
      var rowCells = [], kids = slice(row.children);
      for (var k = 0; k < kids.length; k++) { if (isCell(kids[k])) { rowCells.push(kids[k]); } }
      var index = rowCells.indexOf(header);
      if (index < 0) { out.association = 'NONE'; return out; }
      var rows; try { rows = slice(table.querySelectorAll('tr')); } catch (e) { rows = []; }
      var found = [];
      for (var r = 0; r < rows.length; r++) {
        if (rows[r] === row) { continue; }
        var cells = [], rk = slice(rows[r].children);
        for (var c = 0; c < rk.length; c++) { if (isCell(rk[c])) { cells.push(rk[c]); } }
        var at = cells[index];
        /* Only a TD counts: a second header row at the same index is a label, not a value. */
        if (at && at.tagName === 'TD') { found.push(at); }
      }
      out.association = found.length > 0 ? 'TH_COLUMN_TD' : 'NONE';
      out.candidateCellCount = found.length;
      if (found.length === 1) { out.cell = found[0]; }
    }
    if (out.cell) {
      out.cellTag = out.cell.tagName;
      out.cellInputCount = cellFields(out.cell).length;
      out.tableOrdinal = tableOrdinal(out.cell);
    }
    return out;
  }
  function resolveAll(specs) {
    var rows = [];
    for (var i = 0; i < specs.length; i++) { rows.push(resolveOne(specs[i])); }
    /* Two labels pointing at one element is not two readings. Marked on BOTH, so neither can be used. */
    for (var a = 0; a < rows.length; a++) {
      if (!rows[a].cell) { continue; }
      for (var b = a + 1; b < rows.length; b++) {
        if (rows[b].cell === rows[a].cell) { rows[a].cellDuplicate = true; rows[b].cellDuplicate = true; }
      }
    }
    return rows;
  }
`;

/**
 * **The value-free census.** Returns `{ readings: [{ id, labelVisibleCount, labelHiddenCount, labelTag,
 * association, candidateCellCount, cellTag, cellInputCount, cellNonEmpty, cellDuplicate }] }` — an enum, tag
 * names, integers, and two booleans.
 *
 * `cellNonEmpty` is the one bit derived from a credential value, and it is present only when `readNonEmpty` is
 * set. It exists because a locator that resolves to an EMPTY cell has not found the key, and a calibration that
 * cannot tell those apart would certify a locator that reads nothing. See the module header of
 * `coupang-wing-credential-cells.ts`.
 *
 * The emitted terminal assigns cell text to no returned field: it reaches a value only through `cellNonEmpty`,
 * which collapses it to a boolean inside the page.
 */
export function buildCredentialCellCensusScript(
  requests: readonly CredentialCellRequest[],
  opts: { readNonEmpty?: boolean } = {},
): string {
  return `(function () {
  /* wing-credential-cell-census (value-free OUTPUT — see the builder's docstring for the full field list) */
${RESOLVER_FRAGMENT}
  var SPECS = ${JSON.stringify(requests.map((r) => ({ id: r.id, candidateQuery: r.candidateQuery, exactText: r.exactText })))};
  var READ_NON_EMPTY = ${JSON.stringify(opts.readNonEmpty === true)};
  var resolved = resolveAll(SPECS);
  var readings = [];
  for (var i = 0; i < resolved.length; i++) {
    var r = resolved[i], out = {
      id: r.id, labelVisibleCount: r.labelVisibleCount, labelHiddenCount: r.labelHiddenCount
    };
    if (r.labelTag) { out.labelTag = r.labelTag; }
    if (r.association) { out.association = r.association; }
    if (typeof r.candidateCellCount === 'number') { out.candidateCellCount = r.candidateCellCount; }
    if (r.cellTag) { out.cellTag = r.cellTag; }
    if (typeof r.cellInputCount === 'number') { out.cellInputCount = r.cellInputCount; }
    if (typeof r.tableOrdinal === 'number') { out.tableOrdinal = r.tableOrdinal; }
    if (r.cellDuplicate) { out.cellDuplicate = true; }
    if (r.scanTruncated) { out.scanTruncated = true; }
    /* The ONE bit. Computed inside the page; the value it came from reaches no returned field. */
    if (READ_NON_EMPTY && r.cell) { out.cellNonEmpty = cellNonEmpty(r.cell); }
    readings.push(out);
  }
  return { readings: readings };
})()`;
}

/**
 * **The one-shot read.** Returns `{ ok: true, values: { <id>: <value> } }`, or `{ ok: false, reason }` where the
 * reason is a `CredentialCellRefusal` member and no value is present.
 *
 * It re-checks every condition the census checks rather than trusting a census taken moments earlier. That is
 * deliberate duplication: the page can re-render between the two, and the check that matters is the one taken on
 * the DOM the values are actually read from. The failure direction is a refused read, so the duplication can only
 * make the gate stricter.
 *
 * **There is exactly one of these calls in a run.** Not a poll, not a retry, not a per-field sequence — see
 * `docs/coupang_credential_handoff_v1.md` §4 for why that is a safety property rather than an optimization.
 */
export function buildCredentialCellReadScript(requests: readonly CredentialCellRequest[]): string {
  return `(function () {
  /* wing-credential-cell-read (RETURNS SECRET VALUES — one call per run, behind an operator-confirmed barrier) */
${RESOLVER_FRAGMENT}
  var SPECS = ${JSON.stringify(requests.map((r) => ({ id: r.id, candidateQuery: r.candidateQuery, exactText: r.exactText })))};
  var resolved = resolveAll(SPECS);
  var values = {};
  /* ONE shape, ONE table, for all three. Resolved per label these agree on the WING screen, and disagree only
     when the page is not the shape the calibration measured — e.g. a trailing cell in the header row makes the
     LAST label resolve by the row-headed rule and read the cell beside it, which on a real page is a copy
     button's label. Checked before any value is taken. */
  var assoc = null, table = null;
  for (var t = 0; t < resolved.length; t++) {
    var rr = resolved[t];
    if (rr.scanTruncated) { return { ok: false, reason: 'SCAN_TRUNCATED', id: rr.id }; }
    if (!rr.association || rr.association === 'NONE') { continue; }
    if (assoc === null) { assoc = rr.association; } else if (assoc !== rr.association) { return { ok: false, reason: 'ASSOCIATION_MIXED', id: rr.id }; }
    if (typeof rr.tableOrdinal === 'number' && rr.tableOrdinal >= 0) {
      if (table === null) { table = rr.tableOrdinal; } else if (table !== rr.tableOrdinal) { return { ok: false, reason: 'TABLE_MIXED', id: rr.id }; }
    }
  }
  for (var i = 0; i < resolved.length; i++) {
    var r = resolved[i];
    if (r.labelVisibleCount !== 1) { return { ok: false, reason: 'LABEL_NOT_UNIQUE', id: r.id }; }
    if (!r.association || r.association === 'NONE') { return { ok: false, reason: 'NO_ASSOCIATION', id: r.id }; }
    if (r.candidateCellCount !== 1 || !r.cell) { return { ok: false, reason: 'CELL_NOT_UNIQUE', id: r.id }; }
    if (typeof r.cellInputCount !== 'number' || r.cellInputCount > 1) { return { ok: false, reason: 'CELL_SHAPE_AMBIGUOUS', id: r.id }; }
    if (r.cellDuplicate) { return { ok: false, reason: 'CELL_COLLISION', id: r.id }; }
    var text = cellText(r.cell);
    if (text.length === 0) { return { ok: false, reason: 'CELL_EMPTY', id: r.id }; }
    values[r.id] = text;
  }
  return { ok: true, values: values };
})()`;
}
