/**
 * **The page scripts an unattended NAVER Seller Center 상품 문의 read runs — authored here, forwarded verbatim.**
 *
 * The sibling of `review-list-observe-inpage.ts`. Nothing under `src/aside/` writes page code; the NAVER runtime there
 * forwards these strings and nothing else (`aside-guard.test.ts`). The READ-ONLY discovery that justified them
 * (2026-09-17, on the real logged-in surface) measured:
 *
 *  - **the screen is AngularJS with debug info off, and its rows live on the view controller.** `#/comment/` renders
 *    `comment in ::vm.commentList`; `angular.element(el).controller()` returns that `vm` (it is stored as element data
 *    regardless of debug info). So the reader asks the controller — never the rendered text — and refuses when the
 *    controller is still loading or its list and the rendered rows disagree.
 *  - **each row's `id` is the Commerce API's `questionId`.** On 7/7 inquiries the official API had already stored, the
 *    id, the creation instant (to the millisecond) and a SHA-256 of the question text were identical.
 *  - **each rendered row links to its 채널상품번호.** On 8/8 rows every `/products/<n>` link equalled the row's
 *    `channelProductNo` (the older `productNo` differed on 7/8, so it is not used). The reader re-checks that on every
 *    run: a model whose rows no longer line up with what is drawn must fail closed, not store the wrong row's text.
 *  - **the page is 8 rows over a 3-month default period, newest first, and paging is a click.** The reader returns the
 *    first page, the pager's own size and total, and the period the search form holds. It never pages.
 *  - **the same row object carries the buyer's masked id, member number and an audit block with the writer's IP.**
 *    None of them is read out. The row object built here names its six fields explicitly; there is no spread, no copy,
 *    no `Object.keys`.
 *
 * Every refusal is a closed reason word, spelled as the NAVER runtime expects (`naver-review-runtime.ts`): the terminal
 * ones stop the read, the others are «still drawing» and are polled until the settle bound.
 */

/** Reasons the reader may give. `OK` is the only one that carries rows. */
export const NAVER_PRODUCT_INQUIRY_READ_REASONS = [
  "OK",
  "ROUTE_MISMATCH",
  "GRID_NOT_FOUND",
  "MODEL_UNREADABLE",
  "MODEL_SHAPE_CHANGED",
  "ROWS_NOT_LOADED",
  "ID_LINK_MISMATCH",
  "TOO_MANY_ROWS",
] as const;
export type NaverProductInquiryReadReason = (typeof NAVER_PRODUCT_INQUIRY_READ_REASONS)[number];

/** The largest page this recipe accepts. The backend enforces the same bound. */
export const NAVER_PRODUCT_INQUIRY_MAX_ROWS = 100;

/** The one hash route this reader reads. */
export const NAVER_PRODUCT_INQUIRY_HASH = "#/comment/";

/** The row repeat the discovery measured. A changed template is a changed page. */
export const NAVER_PRODUCT_INQUIRY_ROW_SELECTOR = '[ng-repeat="comment in ::vm.commentList"]';

/** An element the view always renders, rows or not — how an empty period still reaches its controller. */
export const NAVER_PRODUCT_INQUIRY_FORM_SELECTOR = '[ng-model="vm.searchFormData.commentType"]';

/**
 * Read the first page of the screen's current period from the view controller.
 *
 * Returns `{ reason, rowCount, loaded, pageIndex, pageSize, totalCount, windowStart, windowEnd, linkChecked, rows }`.
 * `rows` is empty unless `reason === "OK"`.
 */
export function buildNaverProductInquiryListReadScript(): string {
  return `(function () {
  var MAX = ${NAVER_PRODUCT_INQUIRY_MAX_ROWS};
  function fail(reason) {
    return { reason: reason, rowCount: -1, loaded: -1, pageIndex: null, pageSize: null, totalCount: null,
      windowStart: null, windowEnd: null, linkChecked: 0, rows: [] };
  }
  if (String(location.host || '').toLowerCase() !== 'sell.smartstore.naver.com'
      || String(location.hash || '') !== ${JSON.stringify(NAVER_PRODUCT_INQUIRY_HASH)}) {
    return fail('ROUTE_MISMATCH');
  }
  var ng = window.angular;
  var anchor = document.querySelector(${JSON.stringify(NAVER_PRODUCT_INQUIRY_FORM_SELECTOR)});
  if (!ng || typeof ng.element !== 'function' || !anchor) { return fail('GRID_NOT_FOUND'); }
  var vm = null;
  try { vm = ng.element(anchor).controller(); } catch (e) { vm = null; }
  if (!vm || vm.isLoading !== false || !Array.isArray(vm.commentList) || !vm.pageInfo || !vm.searchFormData) {
    return fail('MODEL_UNREADABLE');
  }
  var pi = vm.pageInfo;
  if (typeof pi.page !== 'number' || typeof pi.size !== 'number' || typeof pi.totalCount !== 'number') {
    return fail('MODEL_UNREADABLE');
  }
  if (pi.page !== 0) { return fail('MODEL_SHAPE_CHANGED'); }
  var list = vm.commentList;
  if (list.length > MAX || pi.size > MAX) { return fail('TOO_MANY_ROWS'); }
  var sd = vm.searchFormData.startDate;
  var ed = vm.searchFormData.endDate;
  if (typeof sd !== 'string' || typeof ed !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}T/.test(sd) || !/^\\d{4}-\\d{2}-\\d{2}T/.test(ed)) {
    return fail('MODEL_SHAPE_CHANGED');
  }
  var rendered = document.querySelectorAll(${JSON.stringify(NAVER_PRODUCT_INQUIRY_ROW_SELECTOR)});
  if (rendered.length !== list.length) {
    var notYet = fail('ROWS_NOT_LOADED');
    notYet.rowCount = list.length;
    notYet.loaded = rendered.length;
    return notYet;
  }
  var rows = [];
  var checked = 0;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!c || typeof c.id !== 'number' || typeof c.regDate !== 'string' || typeof c.commentContent !== 'string'
        || typeof c.sellerAnswer !== 'boolean' || typeof c.secret !== 'boolean'
        || typeof c.channelProductNo !== 'number' || c.commentType !== 'PRODUCT_INQUIRY'
        || c.contentsStatusType !== 'NORMAL') {
      return fail('MODEL_SHAPE_CHANGED');
    }
    var links = rendered[i].querySelectorAll('a[href]');
    var matched = 0;
    for (var l = 0; l < links.length; l++) {
      var m = /\\/products\\/(\\d+)/.exec(String(links[l].getAttribute('href') || ''));
      if (!m) { continue; }
      if (m[1] !== String(c.channelProductNo)) { return fail('ID_LINK_MISMATCH'); }
      matched++;
    }
    if (matched === 0) { return fail('ID_LINK_MISMATCH'); }
    checked++;
    rows.push({
      questionId: String(c.id),
      createdAt: c.regDate,
      body: c.commentContent,
      answered: c.sellerAnswer,
      secret: c.secret,
      channelProductNo: String(c.channelProductNo)
    });
  }
  return { reason: 'OK', rowCount: list.length, loaded: rendered.length, pageIndex: pi.page, pageSize: pi.size,
    totalCount: pi.totalCount, windowStart: sd.slice(0, 10), windowEnd: ed.slice(0, 10), linkChecked: checked,
    rows: rows };
})()`;
}

/**
 * The period the search form holds, read a second time after the rows settled — the NAVER runtime's range stage.
 * Returns `{ windowStart, windowEnd }` (`yyyy-MM-dd` as the form writes it in KST), or nulls.
 */
export function buildNaverProductInquiryWindowScript(): string {
  return `(function () {
  var ng = window.angular;
  var anchor = document.querySelector(${JSON.stringify(NAVER_PRODUCT_INQUIRY_FORM_SELECTOR)});
  var vm = null;
  try { vm = ng && anchor ? ng.element(anchor).controller() : null; } catch (e) { vm = null; }
  var f = vm && vm.searchFormData;
  var sd = f && typeof f.startDate === 'string' ? f.startDate.slice(0, 10) : null;
  var ed = f && typeof f.endDate === 'string' ? f.endDate.slice(0, 10) : null;
  return { windowStart: sd, windowEnd: ed };
})()`;
}
