/**
 * **In-page interactive calibration** (read-only) — the overlay the operator uses to teach the runtime WHICH
 * review row and WHICH body/date/rating/reply-control elements to read, by **clicking the real elements
 * directly**. A document-level capture-phase listener intercepts each click (`preventDefault` +
 * `stopImmediatePropagation`), so the click NEVER reaches a NAVER handler and nothing on the page is triggered;
 * the runtime records only the clicked element's **relative child-index path** within the row (never a selector,
 * class, or text). Direct-click capture (rather than enumerating candidate badges) works regardless of NAVER's
 * real DOM — there is no candidate net to miss.
 *
 * Exports STRINGS (browser JS source) so the module stays browser-type-free/source-scannable. The runtime never
 * calls `.click()`/`.type()`/submit — it only reads which element the operator clicked and its structural path.
 * A small fixed banner (pointer-events:none, so it never intercepts) shows the current step in Korean.
 */
import { REVIEW_ROW_CONTAINER_GROUPS } from "./reply-row-mapping-artifact";

const GROUPS_JSON = JSON.stringify(REVIEW_ROW_CONTAINER_GROUPS);

/**
 * Install the direct-click calibration capture + banner. Steps in order: pick the ROW (click anywhere inside the
 * target review row — the nearest generic-container ancestor becomes the row), then click the BODY, DATE, RATING,
 * and REPLY-control elements. State lives on `window.__awCalib`; the CLI polls {@link IN_PAGE_CALIBRATION_READ}.
 */
export const IN_PAGE_CALIBRATION_INSTALL = `(() => {
  var GROUPS = ${GROUPS_JSON};
  var ORDER = [];
  var LABELS = { ROW: '대상 리뷰의 본문 글자를 한 번 클릭하세요 (그 줄 전체가 선택됩니다)', DONE: '완료! 저장 중…' };
  var st = { step: 'ROW', order: ORDER, parentPath: null, rowTag: null, rowIndex: null, paths: {}, done: false, lastError: null, rowDiag: null, groups: GROUPS };
  window.__awCalib = st;

  var banner = document.getElementById('__aw_calib_banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '__aw_calib_banner';
    banner.setAttribute('aria-hidden', 'true');
    banner.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483600;pointer-events:none;background:#111;color:#fff;font:14px system-ui;padding:8px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
    document.body.appendChild(banner);
  }
  function paint() { banner.textContent = 'SellerOps 캘리브레이션 — ' + (LABELS[st.step] || st.step); }
  paint();

  function sameTagSiblings(el) {
    if (!el.parentElement) { return 1; }
    return Array.prototype.filter.call(el.parentElement.children, function (c) { return c.tagName === el.tagName; }).length;
  }
  // Sanitized ancestry (tag + repetition + text length + which generic group matched) — structural evidence only.
  function ancestry(el) {
    var out = [], cur = el, d = 0;
    while (cur && cur.nodeType === 1 && d < 16) {
      var g = -1;
      for (var i = 0; i < GROUPS.length; i++) {
        if (Array.prototype.indexOf.call(document.querySelectorAll(GROUPS[i]), cur) >= 0) { g = i; break; }
      }
      out.push({ tag: cur.tagName, sibs: sameTagSiblings(cur), text: (cur.textContent || '').trim().length, group: g });
      cur = cur.parentElement; d++;
    }
    return out;
  }
  // The review ROW = the DEEPEST ancestor that is a REPEATED, TEXT-RICH unit — i.e. it has >= 2 same-tag
  // siblings that ALSO carry substantial text (the sibling reviews). This is tag-agnostic (NAVER rows are plain
  // <div>s, not li/tr/article), so it finds the individual review line rather than a control cell or a wrapper.
  function findRow(el) {
    var cur = el, d = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur.parentElement && d < 25) {
      var p = cur.parentElement;
      var sameTag = Array.prototype.filter.call(p.children, function (c) { return c.tagName === cur.tagName; });
      if (sameTag.length >= 2 && (cur.textContent || '').trim().length > 150) {
        var richSibs = 0;
        for (var i = 0; i < sameTag.length; i++) { if ((sameTag[i].textContent || '').trim().length > 150) { richSibs++; } }
        if (richSibs >= 2) { return { root: cur, parent: p, tag: cur.tagName, rowIndex: sameTag.indexOf(cur) }; }
      }
      cur = p; d++;
    }
    return null;
  }
  function pathFromRoot(root, el) {
    var path = [], cur = el;
    while (cur && cur !== root) {
      var p = cur.parentElement;
      if (!p) { return null; }
      path.unshift(Array.prototype.indexOf.call(p.children, cur));
      cur = p;
    }
    return cur === root ? path : null;
  }
  function descend(root, path) {
    var el = root;
    for (var i = 0; i < path.length; i++) {
      if (!el || !el.children || path[i] < 0 || path[i] >= el.children.length) { return null; }
      el = el.children[path[i]];
    }
    return el || null;
  }
  function rowRoot() {
    if (!st.parentPath) { return null; }
    var parent = descend(document.body, st.parentPath);
    if (!parent) { return null; }
    var rows = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === st.rowTag; });
    return rows[st.rowIndex] || null;
  }

  // Single click: the operator clicks the target review's body; the whole review row (a repeated text-rich unit)
  // is designated, and the clicked element's path within it is captured for the cross-source EVIDENCE attempt.
  function handler(ev) {
    if (!st || st.done) { return; }
    var el = ev.target;
    if (el && el.id === '__aw_calib_banner') { return; }
    ev.preventDefault();
    ev.stopImmediatePropagation();
    st.rowDiag = ancestry(el);
    var r = findRow(el);
    if (!r) { st.lastError = 'ROW_NOT_FOUND'; paint(); return; }
    var pp = pathFromRoot(document.body, r.parent);
    if (!pp) { st.lastError = 'ROW_PARENT_UNADDRESSABLE'; paint(); return; }
    st.parentPath = pp; st.rowTag = r.tag; st.rowIndex = r.rowIndex;
    st.paths.body = pathFromRoot(r.root, el) || [];
    r.root.setAttribute('data-aw-calib-row', '1'); r.root.style.outline = '3px solid #2b6cff';
    st.step = 'DONE'; st.done = true; st.lastError = null; paint();
  }
  window.__awCalibHandler = handler;
  document.addEventListener('click', handler, true);
  return true;
})()`;

/** Read the sanitized calibration state — indices, structural paths, step, done, lastError. No text/selector. */
export const IN_PAGE_CALIBRATION_READ = `(() => {
  var s = window.__awCalib;
  if (!s) { return null; }
  return {
    step: s.step, done: !!s.done, lastError: s.lastError || null, rowDiag: s.rowDiag || null,
    parentPath: s.parentPath || null, rowTag: s.rowTag || null, rowIndex: s.rowIndex,
    body: s.paths.body || null, date: s.paths.date || null, rating: s.paths.rating || null, reply: s.paths.reply || null,
  };
})()`;

/** Remove the calibration listener, banner, outlines, and state. Idempotent, read-only. */
export const IN_PAGE_CALIBRATION_TEARDOWN = `(() => {
  if (window.__awCalibHandler) { document.removeEventListener('click', window.__awCalibHandler, true); }
  var b = document.getElementById('__aw_calib_banner');
  if (b && b.parentNode) { b.parentNode.removeChild(b); }
  var row = document.querySelector('[data-aw-calib-row]');
  if (row) { row.removeAttribute('data-aw-calib-row'); row.style.outline = ''; }
  try { delete window.__awCalib; delete window.__awCalibHandler; }
  catch (e) { window.__awCalib = undefined; window.__awCalibHandler = undefined; }
  return true;
})()`;

/** The shape {@link IN_PAGE_CALIBRATION_READ} returns (all coarse/structural). */
export interface RowDiagEntry {
  tag: string;
  sibs: number;
  text: number;
  group: number;
}

export interface CalibrationReadState {
  step: string;
  done: boolean;
  lastError: string | null;
  rowDiag: RowDiagEntry[] | null;
  parentPath: number[] | null;
  rowTag: string | null;
  rowIndex: number | null;
  body: number[] | null;
  date: number[] | null;
  rating: number[] | null;
  reply: number[] | null;
}
