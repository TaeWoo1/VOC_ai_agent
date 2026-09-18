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
 *  - {@link buildNaverReviewReplyReadScript}: with the detail open, read from the detail's own view model the one
 *    reply text (and date) of the object whose id is that review's id. Buyer identifiers are never read; the review's
 *    own text never leaves. When the model does not hold one unambiguous reply, it refuses and reports only key
 *    NAMES, so the gap is exact rather than guessed.
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
export const REPLY_READ_REASONS = ["OK", "NO_DETAIL_OPEN", "AMBIGUOUS_DETAIL", "NOT_IN_DETAIL_MODEL", "NO_REPLY_IN_MODEL", "AMBIGUOUS_REPLY"] as const;

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

export function buildNaverReviewReplyReadScript(reviewId: string): string {
  return `(function () {
  var ID = ${idLiteral(reviewId)};
  var DENY = ${BUYER_KEY_DENY.toString()};
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  var roots = [];
  var cands = document.querySelectorAll('.modal, [role="dialog"], [uib-modal-window], .modal-dialog');
  for (var i = 0; i < cands.length; i++) {
    if (!visible(cands[i])) { continue; }
    var nested = false;
    for (var j = 0; j < roots.length; j++) { if (roots[j].contains(cands[i])) { nested = true; } }
    if (!nested) { roots.push(cands[i]); }
  }
  if (roots.length === 0) { return { reason: 'NO_DETAIL_OPEN' }; }
  if (roots.length > 1) { return { reason: 'AMBIGUOUS_DETAIL', detailCount: roots.length }; }
  var ng = window.angular;
  if (!ng || typeof ng.element !== 'function') { return { reason: 'NOT_IN_DETAIL_MODEL', scopes: 0 }; }
  var scopes = [];
  var els = [roots[0]].concat(Array.prototype.slice.call(roots[0].querySelectorAll('*'), 0, 400));
  for (var e = 0; e < els.length; e++) {
    var sc = null;
    try { sc = ng.element(els[e]).scope(); } catch (x) { sc = null; }
    if (sc && scopes.indexOf(sc) < 0) { scopes.push(sc); }
  }
  var seen = [];
  var found = null;
  function search(obj, depth) {
    if (found || !obj || typeof obj !== 'object' || depth > 4 || seen.indexOf(obj) >= 0 || seen.length > 3000) { return; }
    seen.push(obj);
    if (String(obj.id) === ID || String(obj.reviewId) === ID) { found = obj; return; }
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].charAt(0) === '$') { continue; }
      var v; try { v = obj[keys[k]]; } catch (x) { continue; }
      if (v && typeof v === 'object') { search(v, depth + 1); }
    }
  }
  for (var s = 0; s < scopes.length && !found; s++) { search(scopes[s], 0); }
  if (!found) { return { reason: 'NOT_IN_DETAIL_MODEL', scopes: scopes.length }; }
  var texts = [];
  var dates = [];
  function collect(obj, path, depth, inReply) {
    if (!obj || typeof obj !== 'object' || depth > 3) { return; }
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key.charAt(0) === '$' || DENY.test(key)) { continue; }
      var v; try { v = obj[key]; } catch (x) { continue; }
      var here = path ? path + '.' + key : key;
      var replyish = inReply || /comment|reply|answer/i.test(key);
      if (typeof v === 'string' && v.trim().length > 0) {
        if (replyish && /date|at$|dt$|dttm|time/i.test(key)) { dates.push({ path: here, value: v }); }
        else if (replyish && !/type|status|yn$|flag|code|id$/i.test(key) && key !== 'reviewContent') {
          texts.push({ path: here, value: v });
        }
      } else if (v && typeof v === 'object') {
        collect(v, here, depth + 1, replyish);
      }
    }
  }
  collect(found, '', 0, false);
  var distinct = [];
  for (var t = 0; t < texts.length; t++) {
    if (distinct.indexOf(texts[t].value.trim()) < 0) { distinct.push(texts[t].value.trim()); }
  }
  if (distinct.length === 0) {
    // Key NAMES only, so the gap is exact: where the model keeps things, never what it holds.
    return { reason: 'NO_REPLY_IN_MODEL', keys: Object.keys(found).filter(function (k) { return !DENY.test(k); }) };
  }
  if (distinct.length > 1) { return { reason: 'AMBIGUOUS_REPLY', paths: texts.map(function (x) { return x.path; }) }; }
  var textPath = null;
  for (var p = 0; p < texts.length; p++) { if (texts[p].value.trim() === distinct[0]) { textPath = texts[p].path; break; } }
  return { reason: 'OK', replyText: distinct[0], repliedAt: dates.length ? dates[0].value : null, textPath: textPath,
    datePath: dates.length ? dates[0].path : null };
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
