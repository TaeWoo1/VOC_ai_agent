/**
 * **The two page scripts an unattended NAVER Seller Center 리뷰 read runs — authored here, forwarded verbatim.**
 *
 * Nothing under `src/aside/` writes page code; the runtime there forwards these strings and nothing else
 * (`aside-guard.test.ts`). They are small because the discovery that justified them (2026-09-17, READ-ONLY, on the
 * real logged-in surface) found the list already holds what a scheduled read needs, with no click:
 *
 *  - **the list is an ag-Grid whose own row model holds every row of the screen's period.** Measured: model type
 *    `infinite`, 52 rows, 52 loaded, one page of 500 — while only ~15 rows are in the DOM at a time, because the
 *    grid recycles them. So the reader asks the MODEL, never scrolls, and refuses when any node is unloaded.
 *  - **each row's `id` is the review's own id.** On 15/15 rendered rows it equalled the id in the row's detail link
 *    (`openReviewDetailModal(<id>, …)`) — the id the guided reply lane matched against the exported 리뷰글번호 live on
 *    2026-09-03 and 09-05. The reader re-checks that equality on every run and refuses on any disagreement: a page
 *    whose meaning moved must fail closed, not quietly store the wrong key. The DOM `row-id` is the grid's index and
 *    is never read.
 *  - **the row model also carries the buyer's masked id, member number and order number.** None of them is read out.
 *    The row object this script builds names its fields explicitly; there is no spread, no copy, no `Object.keys`.
 *
 * Every refusal is a closed reason word. Page text never crosses back except the eight named review fields.
 */

/** Reasons the reader may give. `OK` is the only one that carries rows. */
export const NAVER_REVIEW_READ_REASONS = [
  "OK",
  "ROUTE_MISMATCH",
  "GRID_NOT_FOUND",
  "MODEL_UNREADABLE",
  "MODEL_SHAPE_CHANGED",
  "ROWS_NOT_LOADED",
  "ID_LINK_MISMATCH",
  "TOO_MANY_ROWS",
] as const;
export type NaverReviewReadReason = (typeof NAVER_REVIEW_READ_REASONS)[number];

/** The largest reading this recipe accepts. The backend enforces the same bound. */
export const NAVER_REVIEW_MAX_ROWS = 500;

/**
 * Signed in, on the Seller Center host, with no password field on the page. Host first: a sign-in redirect lands on
 * `nid.naver.com` / `accounts.commerce.naver.com`, and reading that page's words as «signed in» is the defect the
 * reply lane's `IN_PAGE_LOGIN_SIGNAL` was fixed for.
 */
export function buildNaverReviewAuthScript(): string {
  return `(function () {
  var host = String(location.host || '').toLowerCase();
  if (host !== 'sell.smartstore.naver.com') { return { signedIn: false, onSellerCenter: false }; }
  var pw = document.querySelectorAll('input[type="password"]').length;
  var out = 0;
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length && i < 20000; i++) {
    var own = '';
    var cn = all[i].childNodes;
    for (var c = 0; c < cn.length; c++) { if (cn[c].nodeType === 3) { own += cn[c].nodeValue; } }
    own = own.replace(/\\s+/g, ' ').trim();
    if (own.length > 0 && own.length <= 20 && own.indexOf('로그아웃') >= 0) { out++; }
  }
  return { signedIn: pw === 0 && out > 0, onSellerCenter: true };
})()`;
}

/**
 * Read every row of the screen's current period from the grid's row model.
 *
 * Returns `{ reason, modelType, rowCount, loaded, rows }`. `rows` is empty unless `reason === "OK"`.
 */
export function buildNaverReviewListReadScript(): string {
  return `(function () {
  var MAX = ${NAVER_REVIEW_MAX_ROWS};
  function fail(reason, extra) {
    var r = { reason: reason, modelType: null, rowCount: -1, loaded: -1, rows: [] };
    if (extra) { for (var k in extra) { r[k] = extra[k]; } }
    return r;
  }
  if (String(location.host || '').toLowerCase() !== 'sell.smartstore.naver.com'
      || String(location.hash || '').indexOf('#/review/search') !== 0) {
    return fail('ROUTE_MISMATCH');
  }
  var rendered = document.querySelectorAll('.ag-center-cols-container .ag-row');
  if (rendered.length === 0) { return fail('GRID_NOT_FOUND'); }
  function nodeOf(el) {
    var names = Object.getOwnPropertyNames(el);
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf('__AG_') !== 0) { continue; }
      var store = el[names[i]];
      if (store && store.renderedRow && store.renderedRow.rowNode) { return store.renderedRow.rowNode; }
    }
    return null;
  }
  var first = nodeOf(rendered[0]);
  var api = first && first.gridApi;
  if (!api || typeof api.forEachNode !== 'function' || typeof api.getModel !== 'function') {
    return fail('MODEL_UNREADABLE');
  }
  var model = api.getModel();
  var modelType = model && typeof model.getType === 'function' ? model.getType() : null;
  var rowCount = model && typeof model.getRowCount === 'function' ? model.getRowCount() : -1;
  if (typeof rowCount !== 'number' || rowCount < 0) { return fail('MODEL_UNREADABLE', { modelType: modelType }); }
  if (rowCount > MAX) { return fail('TOO_MANY_ROWS', { modelType: modelType, rowCount: rowCount }); }
  if (typeof api.paginationGetTotalPages === 'function' && api.paginationGetTotalPages() > 1) {
    return fail('TOO_MANY_ROWS', { modelType: modelType, rowCount: rowCount });
  }
  var rows = [];
  var missing = 0;
  var badShape = 0;
  api.forEachNode(function (n) {
    var d = n && n.data;
    if (!d) { missing++; return; }
    var id = d.id;
    var score = d.reviewScore;
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof score !== 'number'
        || typeof d.createDate !== 'string' || typeof d.hasComment !== 'boolean'
        || (typeof d.productNo !== 'number' && typeof d.productNo !== 'string')) {
      badShape++;
      return;
    }
    rows.push({
      reviewId: String(id),
      createdAt: d.createDate,
      rating: score,
      body: typeof d.reviewContent === 'string' ? d.reviewContent : '',
      productNo: String(d.productNo),
      productName: typeof d.productName === 'string' ? d.productName : null,
      answered: d.hasComment,
      attachCount: Array.isArray(d.reviewAttaches) ? d.reviewAttaches.length : 0
    });
  });
  if (missing > 0 || rows.length + badShape !== rowCount) {
    return fail('ROWS_NOT_LOADED', { modelType: modelType, rowCount: rowCount, loaded: rows.length });
  }
  if (badShape > 0) { return fail('MODEL_SHAPE_CHANGED', { modelType: modelType, rowCount: rowCount }); }
  // The meaning check: the model's id must be the id the row's own detail link opens.
  var checked = 0;
  for (var r = 0; r < rendered.length; r++) {
    var node = nodeOf(rendered[r]);
    if (!node || !node.data) { continue; }
    var links = rendered[r].querySelectorAll('[ng-click]');
    for (var l = 0; l < links.length; l++) {
      var m = /openReviewDetailModal\\((\\d+)/.exec(String(links[l].getAttribute('ng-click') || ''));
      if (!m) { continue; }
      if (m[1] !== String(node.data.id)) { return fail('ID_LINK_MISMATCH', { modelType: modelType, rowCount: rowCount }); }
      checked++;
    }
  }
  var pinned = document.querySelectorAll('.ag-pinned-left-cols-container .ag-row');
  for (var p = 0; p < pinned.length; p++) {
    var pn = nodeOf(pinned[p]);
    if (!pn || !pn.data) { continue; }
    var plinks = pinned[p].querySelectorAll('[ng-click]');
    for (var q = 0; q < plinks.length; q++) {
      var pm = /openReviewDetailModal\\((\\d+)/.exec(String(plinks[q].getAttribute('ng-click') || ''));
      if (!pm) { continue; }
      if (pm[1] !== String(pn.data.id)) { return fail('ID_LINK_MISMATCH', { modelType: modelType, rowCount: rowCount }); }
      checked++;
    }
  }
  if (rows.length > 0 && checked === 0) { return fail('ID_LINK_MISMATCH', { modelType: modelType, rowCount: rowCount }); }
  return { reason: 'OK', modelType: modelType, rowCount: rowCount, loaded: rows.length, linkChecked: checked, rows: rows };
})()`;
}
