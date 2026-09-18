/**
 * **The page scripts of NAVER Review Reply Enrichment** — read the seller's existing reply off ONE review's detail in
 * Seller Center, for a review the export already marked as replied.
 *
 * Why the detail: the export carries 답글여부/답글등록일시 and no text, and the review list's row model carries only
 * `hasComment` (READ-ONLY census M2, 2026-09-18). The seller confirms the reply shows on the review's detail.
 *
 * Three scripts, none of which clicks, types, scrolls or navigates:
 *  - {@link buildNaverReviewDetailLocateScript}: find the EXACT review in the list's row model by its own id, require
 *    the page to say it has a reply, and mark that row's detail-open control — only when the control's own
 *    `openReviewDetailModal(<id>` call names the same id and its words are not a reply/write/edit/delete control.
 *  - {@link buildNaverReviewReplyReadScript}: with the detail open, read the one reply the pop-up pre-fills in its
 *    reply field, after proving in the page that the pop-up is this review's. Buyer fields are never read; the
 *    review's own text never leaves.
 *  - {@link buildNaverReviewDetailCloseLocateScript}: mark the detail's close control — a control whose words or
 *    label say close, and nothing that could write.
 *
 * The runtime ({@link ./review-reply-enrichment}) is the only place a marked control is pressed.
 */

/** Words a control must not carry to be pressed by this lane. Checked on its text, title and aria-label. */
export const REPLY_LANE_REFUSED_WORDS = /답글|답변|등록|수정|삭제|저장|작성|신고|숨김|제출|전송|확인|submit|save|delete|edit|reply|post|send/i;

/** Words a close control may carry. */
export const CLOSE_WORDS = /^(닫기|×|✕|x|close)$/i;

/** Key names that could hold a buyer identifier; never read, never reported. */
export const BUYER_KEY_DENY = /writer|member|masked|idno|order|buyer|nick|phone|email|address|name|url|path|profile/i;

export const DETAIL_OPEN_MARK = "data-rvn-detail-open";
export const DETAIL_CLOSE_MARK = "data-rvn-detail-close";

export const DETAIL_LOCATE_REASONS = [
  "OK", "ROUTE_MISMATCH", "GRID_NOT_FOUND", "NOT_IN_MODEL", "NOT_REPLIED", "NOT_RENDERED",
  "NO_DETAIL_CONTROL", "REFUSED_CONTROL", "AMBIGUOUS_CONTROL",
] as const;
export const REPLY_READ_REASONS = ["OK", "NO_DETAIL_OPEN", "AMBIGUOUS_DETAIL", "NOT_THIS_REVIEW", "NO_REPLY_SECTION", "NO_REPLY_FIELD", "AMBIGUOUS_REPLY", "FORM_NOT_PRISTINE", "NO_REPLY_IN_FIELD"] as const;

function idLiteral(reviewId: string): string {
  if (!/^\d{6,20}$/.test(reviewId)) throw new Error("review id must be digits");
  return JSON.stringify(reviewId);
}

export function buildNaverReviewDetailLocateScript(reviewId: string): string {
  return `(function () {
  var ID = ${idLiteral(reviewId)};
  var REFUSED = ${REPLY_LANE_REFUSED_WORDS.toString()};
  var MARK = ${JSON.stringify(DETAIL_OPEN_MARK)};
  function out(reason, extra) { var r = { reason: reason }; if (extra) { for (var k in extra) { r[k] = extra[k]; } } return r; }
  if (String(location.host || '').toLowerCase() !== 'sell.smartstore.naver.com'
      || String(location.hash || '').indexOf('#/review/search') !== 0) { return out('ROUTE_MISMATCH'); }
  var old = document.querySelectorAll('[' + MARK + ']');
  for (var o = 0; o < old.length; o++) { old[o].removeAttribute(MARK); }
  var rendered = document.querySelectorAll('.ag-center-cols-container .ag-row, .ag-pinned-left-cols-container .ag-row');
  if (rendered.length === 0) { return out('GRID_NOT_FOUND'); }
  function nodeOf(el) {
    var names = Object.getOwnPropertyNames(el);
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf('__AG_') !== 0) { continue; }
      var s = el[names[i]];
      if (s && s.renderedRow && s.renderedRow.rowNode) { return s.renderedRow.rowNode; }
    }
    return null;
  }
  var first = nodeOf(rendered[0]);
  var api = first && first.gridApi;
  if (!api || typeof api.forEachNode !== 'function') { return out('GRID_NOT_FOUND'); }
  var target = null;
  api.forEachNode(function (n) { if (n && n.data && String(n.data.id) === ID) { target = n; } });
  if (!target) { return out('NOT_IN_MODEL'); }
  if (target.data.hasComment !== true) { return out('NOT_REPLIED'); }
  var controls = [];
  var seenRow = false;
  for (var r = 0; r < rendered.length; r++) {
    var node = nodeOf(rendered[r]);
    if (!node || !node.data || String(node.data.id) !== ID) { continue; }
    seenRow = true;
    var cands = rendered[r].querySelectorAll('[ng-click]');
    for (var c = 0; c < cands.length; c++) {
      var call = String(cands[c].getAttribute('ng-click') || '');
      var m = /openReviewDetailModal\\((\\d+)/.exec(call);
      if (!m) { continue; }
      if (m[1] !== ID) { return out('AMBIGUOUS_CONTROL'); }
      controls.push(cands[c]);
    }
  }
  if (!seenRow) { return out('NOT_RENDERED', { hasComment: true }); }
  if (controls.length === 0) { return out('NO_DETAIL_CONTROL'); }
  var chosen = null;
  for (var k = 0; k < controls.length; k++) {
    var words = [controls[k].textContent || '', controls[k].getAttribute('title') || '',
      controls[k].getAttribute('aria-label') || ''].join(' ').replace(/\\s+/g, ' ').trim();
    if (REFUSED.test(words)) { continue; }
    chosen = controls[k];
    break;
  }
  if (!chosen) { return out('REFUSED_CONTROL', { controlCount: controls.length }); }
  chosen.setAttribute(MARK, '1');
  var href = chosen.getAttribute('href');
  return out('OK', { controlCount: controls.length, controlTag: String(chosen.tagName).toLowerCase(),
    directHref: !!(href && href.indexOf(ID) >= 0 && href.indexOf('javascript') !== 0) });
})()`;
}

/** The reply field the detail pop-up pre-fills with the seller's existing reply (READ-ONLY census, 2026-09-18). */
export const REPLY_FIELD_MODEL = "vm.viewData.inputCommentContent";
/** The pop-up's own label over that field. */
export const REPLY_LABEL = "판매자답글";

/**
 * Read the seller's existing reply from the ONE open review-detail pop-up.
 *
 * Measured on the live pop-up (2026-09-18, structure only): it is `.modal.data-target-review-detail`; its view data is
 * not reachable (AngularJS debug info off), and it shows neither the review id nor a reply date. The existing reply is
 * pre-filled into the reply form's textarea (`ng-model="vm.viewData.inputCommentContent"`), under the label
 * 「판매자답글」. Reading a field's value is a read; nothing is typed.
 *
 * Fail-closed checks, all required:
 *  - exactly one visible detail pop-up;
 *  - it is this review's: its review text equals, after whitespace normalisation, the row model's `reviewContent` for
 *    the id the pop-up was opened from — compared in the page, only the boolean leaves;
 *  - exactly one 「판매자답글」 label, its form holds exactly one field bound to {@link REPLY_FIELD_MODEL};
 *  - the form is untouched (`ng-pristine`), so the value is what the channel loaded, never an edit in progress;
 *  - the value is not blank.
 * The review text and every buyer field stay in the page. Only the reply text leaves.
 */
export function buildNaverReviewReplyReadScript(reviewId: string): string {
  return `(function () {
  var ID = ${idLiteral(reviewId)};
  var LABEL = ${JSON.stringify(REPLY_LABEL)};
  var MODEL = ${JSON.stringify(REPLY_FIELD_MODEL)};
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
  var roots = [];
  var cands = document.querySelectorAll('.modal.data-target-review-detail');
  for (var i = 0; i < cands.length; i++) { if (visible(cands[i])) { roots.push(cands[i]); } }
  if (roots.length === 0) { return { reason: 'NO_DETAIL_OPEN' }; }
  if (roots.length > 1) { return { reason: 'AMBIGUOUS_DETAIL', detailCount: roots.length }; }
  var root = roots[0];
  // Which review is this? The row model's text for the id we opened, compared with the pop-up's text in the page.
  var rows = document.querySelectorAll('.ag-center-cols-container .ag-row');
  var api = null;
  for (var r = 0; r < rows.length && !api; r++) {
    var names = Object.getOwnPropertyNames(rows[r]);
    for (var n = 0; n < names.length; n++) {
      if (names[n].indexOf('__AG_') !== 0) { continue; }
      var st = rows[r][names[n]];
      if (st && st.renderedRow && st.renderedRow.rowNode) { api = st.renderedRow.rowNode.gridApi; break; }
    }
  }
  var expected = null;
  if (api && typeof api.forEachNode === 'function') {
    api.forEachNode(function (node) { if (node && node.data && String(node.data.id) === ID) { expected = node.data.reviewContent; } });
  }
  var shown = root.querySelectorAll('.txt-detail');
  if (expected === null || shown.length !== 1 || norm(shown[0].textContent) !== norm(expected)) {
    return { reason: 'NOT_THIS_REVIEW' };
  }
  var labels = [];
  var strongs = root.querySelectorAll('strong');
  for (var s = 0; s < strongs.length; s++) { if (norm(strongs[s].textContent).replace(/ /g, '') === LABEL) { labels.push(strongs[s]); } }
  if (labels.length !== 1) { return { reason: labels.length ? 'AMBIGUOUS_REPLY' : 'NO_REPLY_SECTION' }; }
  var form = labels[0].closest('form');
  if (!form) { return { reason: 'NO_REPLY_SECTION' }; }
  var fields = form.querySelectorAll('textarea');
  var bound = [];
  for (var f = 0; f < fields.length; f++) { if (fields[f].getAttribute('ng-model') === MODEL) { bound.push(fields[f]); } }
  if (bound.length !== 1) { return { reason: bound.length ? 'AMBIGUOUS_REPLY' : 'NO_REPLY_FIELD' }; }
  if (!/(^|\\s)ng-pristine(\\s|$)/.test(String(form.className || ''))) { return { reason: 'FORM_NOT_PRISTINE' }; }
  var value = String(bound[0].value || '');
  if (value.trim().length === 0) { return { reason: 'NO_REPLY_IN_FIELD' }; }
  return { reason: 'OK', replyText: value.trim(), repliedAt: null, textPath: MODEL, datePath: null };
})()`;
}

export function buildNaverReviewDetailCloseLocateScript(): string {
  return `(function () {
  var REFUSED = ${REPLY_LANE_REFUSED_WORDS.toString()};
  var CLOSE = ${CLOSE_WORDS.toString()};
  var MARK = ${JSON.stringify(DETAIL_CLOSE_MARK)};
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  var old = document.querySelectorAll('[' + MARK + ']');
  for (var o = 0; o < old.length; o++) { old[o].removeAttribute(MARK); }
  var roots = [];
  var cands = document.querySelectorAll('.modal, [role="dialog"], [uib-modal-window], .modal-dialog');
  for (var i = 0; i < cands.length; i++) { if (visible(cands[i])) { roots.push(cands[i]); } }
  if (roots.length === 0) { return { reason: 'NO_DETAIL_OPEN' }; }
  var controls = roots[0].querySelectorAll('button, a, [role="button"], [ng-click]');
  for (var c = 0; c < controls.length; c++) {
    var el = controls[c];
    if (!visible(el)) { continue; }
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    var label = [el.getAttribute('title') || '', el.getAttribute('aria-label') || ''].join(' ').trim();
    var closeWord = CLOSE.test(text) || /닫기|close/i.test(label);
    if (!closeWord || REFUSED.test(text) || REFUSED.test(label)) { continue; }
    el.setAttribute(MARK, '1');
    return { reason: 'OK', controlTag: String(el.tagName).toLowerCase() };
  }
  return { reason: 'NO_CLOSE_CONTROL' };
})()`;
}
