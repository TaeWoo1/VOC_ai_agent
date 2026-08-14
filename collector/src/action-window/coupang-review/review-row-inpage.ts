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
/** Bounds the whole-document walk the pager census needs. A page larger than this is not a list screen. */
const MAX_SCAN_ELEMENTS = 4000;

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
  function parentOfEl(el) {
    return el && el.parentElement ? el.parentElement : null;
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

  /* ── the pager ──────────────────────────────────────────────────────────────────────────────
     Acquisition may only claim it covered the list when it can SEE that it reached the end of the
     list, and the only thing on the screen that says so is the paging control. So the pager is read
     as structure, not guessed at: which page numbers are offered, which one the screen marks as the
     one being shown, and whether a next control exists and is pressable.
     Three outcomes, and they are deliberately different states:
       - no pager cluster and no next control  → the list is one page, and this IS the end;
       - a cluster whose current page cannot be identified → UNRESOLVED, which must never round up
         to "the end", because that is exactly how a walk claims a coverage it does not have;
       - a resolved cluster → the caller compares current against the highest offered.
     Nothing here presses anything. Reading a pager is not turning a page. */
  /* The class string, via getAttribute rather than .className. On an SVG element .className is an
     SVGAnimatedString rather than a string, and the attribute is the one form that reads the same
     everywhere. Class tokens are compared against fixed words we supply; the string never travels. */
  function classTokens(el) {
    var v = el.getAttribute ? el.getAttribute('class') : null;
    return v === null || v === undefined ? '' : String(v).toLowerCase();
  }
  function disabledish(el) {
    if (el.hasAttribute && el.hasAttribute('disabled')) { return true; }
    var ad = el.getAttribute ? el.getAttribute('aria-disabled') : null;
    if (ad !== null && String(ad).toLowerCase() === 'true') { return true; }
    return classTokens(el).indexOf('disabled') >= 0;
  }
  function wholeNumber(el) {
    var t = norm(el.textContent);
    return /^[0-9]{1,3}$/.test(t) ? parseInt(t, 10) : null;
  }
  function pressable(el) {
    var tag = String(el.tagName || '').toUpperCase();
    if (tag === 'A' || tag === 'BUTTON') { return true; }
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) {
      var kt = String(kids[i].tagName || '').toUpperCase();
      if (kt === 'A' || kt === 'BUTTON') { return true; }
    }
    return false;
  }
  var NEXT_WORDS = ['다음', 'next', '\\u203a', '>', '\\uff1e', '\\u00bb'];
  function isNextControl(el) {
    var t = norm(el.textContent).toLowerCase();
    for (var i = 0; i < NEXT_WORDS.length; i++) {
      if (t === NEXT_WORDS[i]) { return true; }
    }
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al) {
      var a = norm(al).toLowerCase();
      if (a.indexOf('다음') >= 0 || a.indexOf('next') >= 0) { return true; }
    }
    return false;
  }
  /* **A row of the review table is not a pager**, and it looks exactly like one: the 번호 cell prints 1 and
     the 평점 cell prints 5, so every review row is an element with two numeric children. The first version of
     this census resolved a REVIEW ROW as the paging control on the very first fixture it met.
     The rule that excludes it is precise rather than broad: a cluster whose numeric children are table CELLS
     is a row. An earlier version excluded anything inside a <table> at all, which would also have discarded a
     pager rendered inside the list's own tfoot — a real layout, and one whose exclusion is invisible (it
     yields found=false, which stops the walk with no way to tell why). */
  function numericChildrenAreCells(el) {
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (wholeNumber(kids[i]) === null) { continue; }
      var tag = String(kids[i].tagName || '').toUpperCase();
      if (tag === 'TD' || tag === 'TH') { return true; }
    }
    return false;
  }
  function pagerOf() {
    var all = Array.prototype.slice.call(document.querySelectorAll('*'), 0, ${MAX_SCAN_ELEMENTS});
    var host = null, hostCount = 1;
    /* **Why a refusal is counted rather than just returned.** The first live sitting stopped on
       PAGER_UNRESOLVED and the log said only that — so the reading could not distinguish "no cluster of
       page numbers exists on this screen" from "several do" from "one does and none of the three
       current-page signals fired on it". Three different fixes, one indistinguishable symptom, and one
       seated sitting spent learning nothing. These counts are integers about structure; no page text,
       class name or number reaches them. */
    var clustersFound = 0, clustersOfCells = 0;
    for (var i = 0; i < all.length; i++) {
      var kids = all[i].children || [];
      var n = 0;
      for (var k = 0; k < kids.length; k++) { if (wholeNumber(kids[k]) !== null) { n++; } }
      if (n < 2) { continue; }
      if (numericChildrenAreCells(all[i])) { clustersOfCells++; continue; }
      clustersFound++;
      /* >= 2 numeric siblings is what makes a cluster a PAGER rather than a cell that prints a
         number. Strictly greater wins, so the innermost cluster is chosen over its wrappers. */
      if (n > hostCount) { host = all[i]; hostCount = n; }
    }

    var next = null;
    var scanForNext = host === null ? all : [];
    if (host !== null) {
      var around = [];
      var hk = host.children || [];
      for (var h = 0; h < hk.length; h++) { around.push(hk[h]); }
      var parent = parentOfEl(host);
      if (parent) {
        var pk = parent.children || [];
        for (var p = 0; p < pk.length; p++) { around.push(pk[p]); }
      }
      scanForNext = around;
    }
    for (var s = 0; s < scanForNext.length && next === null; s++) {
      if (isNextControl(scanForNext[s])) { next = scanForNext[s]; }
    }
    var hasNext = next !== null;
    var nextEnabled = hasNext && !disabledish(next);

    /* **What the paging region actually looks like.** Two readings have now refused: the current page is
       marked by none of aria-current / aria-selected / an active-ish class / being the one non-link, and no
       next control matched any word or arrow we supply. Two guesses is where guessing stops.
       So the region reports its own SHAPE — the tag of each numeric child, whether it carries a class
       attribute at all, whether it is a link, and the short control words sitting beside it. A pager's
       labels are Coupang's own UI vocabulary (다음 · 이전 · 맨끝 · ›), never customer content: they are
       capped at 6 characters, capped at 20 of them, and pure numbers are excluded. They reach the run's
       terminal output for this sitting and are never stored.
       This is the measurement that replaces a third guess. */
    function shapeOf(el) {
      var tag = String(el.tagName || '').toUpperCase();
      var cls = el.getAttribute && el.getAttribute('class') !== null ? 'c' : '-';
      var link = pressable(el) ? 'a' : '-';
      var aria = (el.getAttribute && (el.getAttribute('aria-current') !== null
                  || el.getAttribute('aria-selected') !== null
                  || el.getAttribute('aria-disabled') !== null)) ? 'r' : '-';
      var dis = disabledish(el) ? 'd' : '-';
      return tag + cls + link + aria + dis;
    }
    var childShapes = [], regionLabels = [];
    var region = host === null ? null : (parentOfEl(host) || host);
    if (host !== null) {
      var shapeKids = host.children || [];
      for (var sc = 0; sc < shapeKids.length && childShapes.length < 24; sc++) {
        if (wholeNumber(shapeKids[sc]) === null) { continue; }
        childShapes.push(shapeOf(shapeKids[sc]));
      }
    }
    if (region !== null) {
      var inRegion = region.querySelectorAll ? region.querySelectorAll('*') : [];
      for (var rl = 0; rl < inRegion.length && regionLabels.length < 20; rl++) {
        var leaf = inRegion[rl];
        var lkids = leaf.children || [];
        if (lkids.length > 0) { continue; }
        var t = norm(leaf.textContent);
        if (t.length === 0 || t.length > 6) { continue; }
        if (/^[0-9]+$/.test(t)) { continue; }
        if (regionLabels.indexOf(t) < 0) { regionLabels.push(t + '|' + shapeOf(leaf)); }
      }
    }

    if (host === null) {
      return { found: false, resolved: false, pageNumbers: [], currentPage: null,
               hasNext: hasNext, nextEnabled: nextEnabled,
               clustersFound: clustersFound, clustersOfCells: clustersOfCells, clusterSize: 0,
               ariaCurrentMarks: 0, classMarks: 0, nonLinkMarks: 0,
               childShapes: childShapes, regionLabels: regionLabels };
    }

    var numbers = [], nodes = [], hostKids = host.children || [];
    for (var c = 0; c < hostKids.length; c++) {
      var v = wholeNumber(hostKids[c]);
      if (v === null) { continue; }
      if (numbers.indexOf(v) < 0) { numbers.push(v); }
      nodes.push({ value: v, el: hostKids[c] });
    }
    numbers.sort(function (a, b) { return a - b; });

    /* Which page is being shown, by three signals in order of directness. Each must identify
       EXACTLY ONE cell — two candidates identify nothing, and saying so is the point.
       Each signal's HIT COUNT is kept, so a refusal says which signal fired and how often: 0 means the
       screen does not mark the current page that way, and 2+ means it does but not uniquely. Those are
       different problems, and without the counts they arrive as the same silence. */
    var current = null, marked = [];
    var ariaMarks = 0, classMarks = 0, nonLinkMarks = 0;
    for (var m = 0; m < nodes.length; m++) {
      var ac = nodes[m].el.getAttribute ? nodes[m].el.getAttribute('aria-current') : null;
      var sel = nodes[m].el.getAttribute ? nodes[m].el.getAttribute('aria-selected') : null;
      if ((ac !== null && String(ac).toLowerCase() !== 'false')
          || (sel !== null && String(sel).toLowerCase() === 'true')) {
        marked.push(nodes[m].value);
      }
    }
    ariaMarks = marked.length;
    if (marked.length !== 1) {
      marked = [];
      for (var q = 0; q < nodes.length; q++) {
        var cls = classTokens(nodes[q].el);
        if (cls.indexOf('active') >= 0 || cls.indexOf('current') >= 0 || cls.indexOf('selected') >= 0
            || cls.indexOf('on') >= 0 || cls.indexOf('now') >= 0) {
          marked.push(nodes[q].value);
        }
      }
      classMarks = marked.length;
    }
    if (marked.length !== 1) {
      /* The last signal: the page you are on is usually the one that is not a link. */
      marked = [];
      for (var r = 0; r < nodes.length; r++) {
        if (!pressable(nodes[r].el)) { marked.push(nodes[r].value); }
      }
      nonLinkMarks = marked.length;
    }
    if (marked.length === 1) { current = marked[0]; }

    return { found: true, resolved: current !== null, pageNumbers: numbers, currentPage: current,
             hasNext: hasNext, nextEnabled: nextEnabled,
             clustersFound: clustersFound, clustersOfCells: clustersOfCells, clusterSize: nodes.length,
             ariaCurrentMarks: ariaMarks, classMarks: classMarks, nonLinkMarks: nonLinkMarks,
             childShapes: childShapes, regionLabels: regionLabels };
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
  /* Read on EVERY path, including the refusals. A run that could not read the rows still learns
     something worth reporting about why — and a pager that resolves on a page whose table did not
     is a different diagnosis from a screen that is not the list at all. */
  var base = { tablesScanned: tables.length, headerWidth: 0, excludedColumns: 0, unmappedColumns: 0,
               duplicateRoles: 0, rolesResolved: [], widthMismatchRows: 0, rows: [], pager: pagerOf() };
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
