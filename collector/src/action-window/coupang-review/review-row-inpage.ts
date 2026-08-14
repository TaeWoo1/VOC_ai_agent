/**
 * **The in-page half of Coupang WING 상품평 acquisition** — the first script in this workstream that is
 * *supposed* to return text.
 *
 * Every earlier Coupang probe here counted. This one collects: the seller's own reviews are the product, and
 * `docs/sellerops_live_approval_contract.md` §5d states the principle it works under — the rule is **not**
 * `do not read`, it is `do not unnecessarily persist or expose`. So the shape of the safety here is different
 * from a census's. It is not "no text may cross"; it is **"the buyer's identity has no field to cross in"**.
 *
 * ## Columns are resolved by Coupang's own header words, not by position
 *
 * The structure census could only report positions, because a position is all a value-free reading can name.
 * A position is also the least durable thing about a table — insert one column and every downstream index is
 * silently wrong, with no error and a full result set. So this reads the header row, maps each header cell to
 * a ROLE by Coupang's own vocabulary, and addresses every later read by role. A screen that renames or moves
 * a column fails closed with a reason instead of returning confident nonsense.
 *
 * ## The author column is resolved on purpose
 *
 * `구매자` / `작성자` are matched, assigned the `excluded` role, and then never read. Leaving them unmapped
 * would have been simpler and strictly worse: an unmapped column is one careless `roles.body` fallback away
 * from being read, whereas a column that is explicitly *the one we do not read* is a thing a test can hold.
 * `excludedColumns` comes back as a COUNT, so the regression can assert the column was found and its text
 * still never appears in any output.
 *
 * ## What fails closed
 *
 * No table resolving every required role; two tables both resolving them (ambiguous); a row whose width
 * disagrees with the header's. Each is a structure change, and a structure change on an acquisition path is
 * exactly where a wrong answer becomes stored data.
 *
 * Exports STRINGS (browser JS source) so the module stays browser-type-free and source-scannable. ES5 only —
 * the bundler's `keepNames` rewrites arrow functions into a `__name(...)` call that does not exist inside the
 * page. Nothing here clicks, types, navigates, submits, or mutates page state.
 */

/** A column role, and the header words that claim it. Order matters — see {@link REVIEW_COLUMN_ROLES}. */
export interface ReviewColumnRole {
  readonly role: string;
  readonly literals: readonly string[];
}

/**
 * The role table, **most specific first**. A header cell takes the first role that claims it, so
 * `상품평 등록일` must be able to reach `date` before `body`'s `상품평` swallows it — which is why `body` is
 * last and every other role precedes it.
 *
 * The literals are candidates, supplied generously on purpose: this workstream has twice paid a seated
 * sitting to learn that one guessed spelling was not the screen's. One more `indexOf` per header cell is
 * free; a sitting is not.
 */
export const REVIEW_COLUMN_ROLES: readonly ReviewColumnRole[] = Object.freeze([
  // The buyer's column, named first so nothing later can claim it.
  { role: "excluded", literals: ["구매자", "작성자", "작성자명", "구매자명", "아이디"] },
  { role: "date", literals: ["등록일", "작성일", "등록일시", "작성일시"] },
  { role: "rating", literals: ["평점", "별점", "만족도"] },
  { role: "product", literals: ["노출상품ID", "옵션ID", "상품ID"] },
  { role: "productName", literals: ["상품명", "등록상품명"] },
  { role: "body", literals: ["상품평", "리뷰", "내용", "후기"] },
]);

/** The roles acquisition cannot proceed without. Anything less is a structure change, not a thin page. */
export const REQUIRED_REVIEW_ROLES: readonly string[] = Object.freeze(["date", "rating", "product", "body"]);

/** Bounds. A page holding more than this is not the list screen we calibrated against. */
const MAX_TABLES = 20;
const MAX_ROWS = 200;
/** Bounds one review body. Long enough for any real 상품평; short enough that a hostile page cannot flood. */
const MAX_BODY_CHARS = 8000;

/** The marker attribute a located row carries. Inert: an attribute and an outline, never a click target. */
export const REVIEW_TARGET_ATTRIBUTE = "data-sellerops-review-target";

/**
 * Everything both scripts need: the helpers, and the scan that resolves WHICH table is the review list. It is
 * shared rather than written twice because the reader and the locator must agree on the table and on which
 * rows count — if they ever disagreed, locate would highlight row *n* of a different set than the one the
 * match was computed against, and the highlight would be confidently wrong.
 *
 * Leaves `best`, `bestScore` and `tiedAtBest` in scope for the tail that follows it.
 */
function reviewReaderFragment(
  roles: readonly ReviewColumnRole[],
  required: readonly string[],
): string {
  const rolesJson = JSON.stringify(roles);
  const requiredJson = JSON.stringify(required);
  return `
  var ROLES = ${rolesJson};
  var REQUIRED = ${requiredJson};
  var MAX_TABLES = ${MAX_TABLES};
  var MAX_ROWS = ${MAX_ROWS};
  var MAX_BODY = ${MAX_BODY_CHARS};

  function norm(s) {
    return String(s == null ? '' : s).replace(/[\\s\\u00a0\\u3000]+/g, ' ').replace(/^ /, '').replace(/ $/, '');
  }
  function cellsOf(tr) {
    var out = [], kids = tr && tr.children ? tr.children : [];
    for (var i = 0; i < kids.length; i++) {
      var tag = String(kids[i].tagName || '').toUpperCase();
      if (tag === 'TD' || tag === 'TH') { out.push(kids[i]); }
    }
    return out;
  }
  /* The header row: the last row of THEAD (a two-tier header's leaf row is the one naming columns), else the
     first row in the table whose cells are all TH. A table with neither is not a labelled table. */
  function headerCellsOf(table) {
    var head = table.tHead;
    if (head && head.rows && head.rows.length > 0) {
      for (var i = head.rows.length - 1; i >= 0; i--) {
        var hc = cellsOf(head.rows[i]);
        if (hc.length > 0) { return hc; }
      }
    }
    var rows = table.rows || [];
    for (var r = 0; r < rows.length && r < 4; r++) {
      var cs = cellsOf(rows[r]);
      if (cs.length === 0) { continue; }
      var allTh = true;
      for (var c = 0; c < cs.length; c++) {
        if (String(cs[c].tagName || '').toUpperCase() !== 'TH') { allTh = false; break; }
      }
      if (allTh) { return cs; }
    }
    return [];
  }
  function roleOfHeader(text) {
    for (var i = 0; i < ROLES.length; i++) {
      var lits = ROLES[i].literals;
      for (var j = 0; j < lits.length; j++) {
        if (text.indexOf(lits[j]) >= 0) { return ROLES[i].role; }
      }
    }
    return null;
  }
  /* Map header cells to roles. A role is taken by the FIRST column that claims it: a screen printing 상품명
     twice must not leave the second silently overwriting the first, because which one was read would then
     depend on column order rather than on anything stated. */
  function mapRoles(headerCells) {
    var byRole = {}, excluded = 0, unmapped = 0, duplicates = 0;
    for (var i = 0; i < headerCells.length; i++) {
      var role = roleOfHeader(norm(headerCells[i].textContent));
      if (role === null) { unmapped++; continue; }
      if (role === 'excluded') { excluded++; continue; }
      if (Object.prototype.hasOwnProperty.call(byRole, role)) { duplicates++; continue; }
      byRole[role] = i;
    }
    return { byRole: byRole, excludedColumns: excluded, unmappedColumns: unmapped, duplicateRoles: duplicates };
  }
  function resolvedRequired(byRole) {
    var n = 0;
    for (var i = 0; i < REQUIRED.length; i++) {
      if (Object.prototype.hasOwnProperty.call(byRole, REQUIRED[i])) { n++; }
    }
    return n;
  }
  function bodyRowsOf(table) {
    var out = [], bodies = table.tBodies || [];
    for (var b = 0; b < bodies.length && out.length < MAX_ROWS; b++) {
      var rows = bodies[b].rows || [];
      for (var r = 0; r < rows.length && out.length < MAX_ROWS; r++) { out.push(rows[r]); }
    }
    return out;
  }
  function cellText(cells, byRole, role) {
    if (!Object.prototype.hasOwnProperty.call(byRole, role)) { return null; }
    var el = cells[byRole[role]];
    return el ? norm(el.textContent) : null;
  }
  /* The rating column often prints a widget rather than a number. The number is preferred; the aria label is
     the fallback, and both are normalized OFFLINE so the parsing rule lives in one testable place. */
  function ratingAriaOf(cells, byRole) {
    if (!Object.prototype.hasOwnProperty.call(byRole, 'rating')) { return null; }
    var el = cells[byRole.rating];
    if (!el) { return null; }
    var own = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (own) { return norm(own); }
    var inner = el.querySelectorAll ? el.querySelectorAll('[aria-label]') : [];
    return inner.length > 0 ? norm(inner[0].getAttribute('aria-label')) : null;
  }
  /* Media attached to the REVIEW — counted inside the body cell only. A row-wide count would have counted the
     product thumbnail every row carries and reported that every review has a photo. */
  function mediaCountOf(cells, byRole) {
    if (!Object.prototype.hasOwnProperty.call(byRole, 'body')) { return 0; }
    var el = cells[byRole.body];
    if (!el || !el.querySelectorAll) { return 0; }
    return el.querySelectorAll('img, video').length;
  }
  /* Whether the body cell offers to show more than it prints. If it does, the stored body is the TRUNCATED
     text, and that is a fact the run must report rather than one the product should discover later. */
  function expandableOf(cells, byRole) {
    if (!Object.prototype.hasOwnProperty.call(byRole, 'body')) { return false; }
    var el = cells[byRole.body];
    if (!el) { return false; }
    var t = norm(el.textContent);
    return t.indexOf('더보기') >= 0 || t.indexOf('전체보기') >= 0;
  }

  var tables = Array.prototype.slice.call(document.querySelectorAll('table'), 0, MAX_TABLES);
  var best = null, bestScore = -1, tiedAtBest = 0;
  for (var t = 0; t < tables.length; t++) {
    var headerCells = headerCellsOf(tables[t]);
    if (headerCells.length === 0) { continue; }
    var mapped = mapRoles(headerCells);
    var score = resolvedRequired(mapped.byRole);
    if (score > bestScore) { bestScore = score; best = { table: tables[t], header: headerCells, mapped: mapped }; tiedAtBest = 1; }
    else if (score === bestScore && score > 0) { tiedAtBest++; }
  }
`;
}

/**
 * Build the read-only reader script for one document. Role literals are OUR strings and safe to interpolate;
 * nothing from the page is ever interpolated back into source.
 */
export function buildReviewRowReadScript(
  roles: readonly ReviewColumnRole[] = REVIEW_COLUMN_ROLES,
  required: readonly string[] = REQUIRED_REVIEW_ROLES,
): string {
  return `(function () {
${reviewReaderFragment(roles, required)}
  var base = { tablesScanned: tables.length, headerWidth: 0, excludedColumns: 0, unmappedColumns: 0,
               duplicateRoles: 0, rolesResolved: [], widthMismatchRows: 0, rows: [] };
  if (best === null || bestScore < REQUIRED.length) {
    base.reason = 'HEADERS_UNRESOLVED';
    if (best !== null) {
      base.headerWidth = best.header.length;
      base.excludedColumns = best.mapped.excludedColumns;
      base.unmappedColumns = best.mapped.unmappedColumns;
      base.duplicateRoles = best.mapped.duplicateRoles;
      for (var k in best.mapped.byRole) {
        if (Object.prototype.hasOwnProperty.call(best.mapped.byRole, k)) { base.rolesResolved.push(k); }
      }
    }
    return base;
  }
  if (tiedAtBest > 1) { base.reason = 'AMBIGUOUS_TABLE'; return base; }

  var byRole = best.mapped.byRole;
  var width = best.header.length;
  base.headerWidth = width;
  base.excludedColumns = best.mapped.excludedColumns;
  base.unmappedColumns = best.mapped.unmappedColumns;
  base.duplicateRoles = best.mapped.duplicateRoles;
  for (var rk in byRole) {
    if (Object.prototype.hasOwnProperty.call(byRole, rk)) { base.rolesResolved.push(rk); }
  }

  var rows = bodyRowsOf(best.table);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var cells = cellsOf(rows[i]);
    if (cells.length !== width) { base.widthMismatchRows++; continue; }
    var body = cellText(cells, byRole, 'body') || '';
    out.push({
      rowIndex: i,
      dateText: cellText(cells, byRole, 'date'),
      ratingText: cellText(cells, byRole, 'rating'),
      ratingAria: ratingAriaOf(cells, byRole),
      bodyText: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body,
      bodyTruncated: body.length > MAX_BODY,
      bodyExpandable: expandableOf(cells, byRole),
      productText: cellText(cells, byRole, 'product'),
      productNameText: cellText(cells, byRole, 'productName'),
      mediaCount: mediaCountOf(cells, byRole)
    });
  }
  base.rows = out;
  base.reason = base.widthMismatchRows > 0 ? 'ROW_WIDTH_MISMATCH' : (out.length === 0 ? 'NO_ROWS' : 'OK');
  return base;
})()`;
}

/**
 * **Highlight one row and nothing else.** `[쿠팡에서 보기]` ends here: a marker attribute, an outline, and a
 * scroll. It never clicks, focuses a field, submits, or opens anything — the seller is looking at their own
 * screen and the only thing SellerOps adds is a ring around the review they asked about.
 *
 * The row is addressed by the index the READER produced, over the same table the reader resolved, and the row
 * is re-checked against the header width before it is marked. A page that changed under the operator between
 * the read and the highlight resolves to a different row set, fails one of those checks, and returns 0 —
 * which the driver reports as "not found" rather than ringing whatever now sits at that position.
 */
export function buildReviewRowAnnotateScript(
  rowIndex: number,
  roles: readonly ReviewColumnRole[] = REVIEW_COLUMN_ROLES,
  required: readonly string[] = REQUIRED_REVIEW_ROLES,
): string {
  const index = Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : -1;
  return `(function () {
${reviewReaderFragment(roles, required)}
  if (best === null || bestScore < REQUIRED.length || tiedAtBest > 1) { return 0; }
  var rows = bodyRowsOf(best.table);
  var row = rows[${index}];
  if (!row) { return 0; }
  if (cellsOf(row).length !== best.header.length) { return 0; }
  row.setAttribute('${REVIEW_TARGET_ATTRIBUTE}', '1');
  row.style.outline = '3px solid #2b6cff';
  row.style.outlineOffset = '2px';
  if (row.scrollIntoView) { row.scrollIntoView({ block: 'center' }); }
  return 1;
})()`;
}

/** Remove the marker and the outline. Idempotent, read-only, and safe to run on a page that has neither. */
export const REVIEW_TARGET_TEARDOWN = `(function () {
  var marked = document.querySelectorAll('[${REVIEW_TARGET_ATTRIBUTE}]');
  for (var i = 0; i < marked.length; i++) {
    marked[i].removeAttribute('${REVIEW_TARGET_ATTRIBUTE}');
    marked[i].style.outline = '';
    marked[i].style.outlineOffset = '';
  }
  return marked.length;
})()`;
