/**
 * **In-page helpers for the same-session COMPOSER abort rehearsal (ISOLATED, read-only).**
 *
 * The composer-side counterparts to the row-abort in-page scripts. Every string here is a SINGLE JS
 * expression (an IIFE) safe to hand to `page.evaluate(string)`, and the two exported callbacks are real
 * functions handed to `ElementHandle.evaluate(fn)`.
 *
 * HARD BOUNDARIES (source-guard enforced): nothing here clicks, types, pastes, submits, or dispatches an
 * event on a NAVER control. The only page effects are (a) intercepting the operator's OWN click with
 * `preventDefault` so it marks — but does not activate — the composer, (b) read-only outline/marker
 * attributes for visual confirmation, and (c) a SellerOps overlay panel that is `pointer-events:none` and
 * carries the seller's own approved draft as `textContent` (never an input `value`). The operator performs
 * every real interaction; the runtime observes and annotates.
 */

/**
 * Arm a capture-phase listener so the operator's NEXT click on the composer surface is intercepted (nothing
 * fires on NAVER) and the EXACT clicked element is marked as the retained composer ANCHOR. A distinct green
 * banner tells the operator what to do. Mirrors the row `ARM_ABORT_CAPTURE`, on whichever page is active
 * after the entry transition (the review detail page for the body-link strategy, or the same list page for
 * the checkbox+toolbar strategy).
 */
export const ARM_COMPOSER_CAPTURE = `(() => {
  window.__awComposerPicked = false;
  var prev = document.querySelector('[data-aw-composer-anchor]');
  if (prev) { prev.removeAttribute('data-aw-composer-anchor'); }
  var banner = document.getElementById('__aw_composer_banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '__aw_composer_banner';
    banner.setAttribute('aria-hidden', 'true');
    banner.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483602;pointer-events:none;background:#0a7f42;color:#fff;font:14px system-ui;padding:8px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
    banner.textContent = 'SellerOps composer abort 리허설 — 답변 입력창을 한 번 클릭하세요 (입력·전송 금지)';
    document.body.appendChild(banner);
  }
  var handler = function (ev) {
    if (!ev.target || (ev.target.id === '__aw_composer_banner')) { return; }
    ev.preventDefault(); ev.stopImmediatePropagation();
    ev.target.setAttribute('data-aw-composer-anchor', '1');
    window.__awComposerPicked = true;
    banner.textContent = 'SellerOps composer abort 리허설 — 입력창 지정됨. 하이라이트·초안 확인 후 abort 하세요';
    document.removeEventListener('click', handler, true);
  };
  window.__awComposerHandler = handler;
  document.addEventListener('click', handler, true);
  return true;
})()`;

/** True once the operator has clicked (and thereby designated) the composer. */
export const COMPOSER_PICKED = `(() => window.__awComposerPicked === true)()`;

/**
 * Count GENERIC composer candidates currently on the page — a textarea, a `contenteditable`, or an ARIA
 * textbox. Invents no NAVER-specific selector. Used to observe the inline (checkbox+toolbar) entry transition
 * by detecting an INCREASE over the pre-entry count (the list page's own inputs, if any, are the baseline).
 */
export const COMPOSER_CENSUS = `(() => document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]').length)()`;

/**
 * Tear down every composer-abort artifact this module installs: the capture banner + handler, the retained
 * anchor marker, the read-only outline, and the SellerOps draft overlay. Idempotent and best-effort.
 */
export const COMPOSER_TEARDOWN = `(() => {
  var b = document.getElementById('__aw_composer_banner');
  if (b && b.parentNode) { b.parentNode.removeChild(b); }
  var o = document.getElementById('__aw_draft_overlay');
  if (o && o.parentNode) { o.parentNode.removeChild(o); }
  if (window.__awComposerHandler) { document.removeEventListener('click', window.__awComposerHandler, true); }
  var a = document.querySelector('[data-aw-composer-anchor]');
  if (a) { a.removeAttribute('data-aw-composer-anchor'); }
  var h = document.querySelector('[data-aw-composer-highlight]');
  if (h) { h.removeAttribute('data-aw-composer-highlight'); if (h.style) { h.style.outline = ''; h.style.outlineOffset = ''; } }
  try { delete window.__awComposerPicked; delete window.__awComposerHandler; } catch (e) { window.__awComposerPicked = undefined; }
  return true;
})()`;

/**
 * Build the read-only SellerOps draft overlay expression. A fixed, `pointer-events:none` panel that shows the
 * seller's OWN approved reply draft so they can visually confirm what they would post — then ABORT without
 * pasting it. The text is embedded via `JSON.stringify` (a valid, escaped JS string literal — it cannot break
 * out of the expression) and rendered with `textContent`, never into an input `value`. Distinct SellerOps
 * styling so it is never mistaken for the NAVER composer.
 */
export function renderDraftOverlay(draftBody: string): string {
  // JSON.stringify yields a valid, fully-escaped JS string literal — it cannot break out of the expression.
  const embedded = JSON.stringify(draftBody);
  return `(() => {
    var id = '__aw_draft_overlay';
    var prev = document.getElementById(id);
    if (prev && prev.parentNode) { prev.parentNode.removeChild(prev); }
    var box = document.createElement('div');
    box.id = id;
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;max-width:380px;max-height:50vh;overflow:auto;z-index:2147483601;pointer-events:none;background:#0a2a1c;color:#eafff2;font:13px/1.55 system-ui;padding:12px 14px;border:1px solid #0a7f42;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.45);white-space:pre-wrap;word-break:break-word';
    var label = document.createElement('div');
    label.style.cssText = 'font-weight:700;margin-bottom:6px;color:#7ff0b0';
    label.textContent = 'SellerOps · 승인된 답변 초안 (읽기 전용 — 붙여넣지 마세요)';
    var body = document.createElement('div');
    body.textContent = ${embedded};
    box.appendChild(label); box.appendChild(body);
    document.body.appendChild(box);
    return true;
  })()`;
}

/**
 * Resolve the composer from the operator's clicked anchor and outline it READ-ONLY (green). The operator may
 * click a child (a placeholder/label) inside the composer, so walk self-or-ancestor to the nearest textarea /
 * `contenteditable` / ARIA textbox; if none is found within a shallow bound, outline the clicked element
 * itself. Only style + a marker attribute + scroll — no input value is ever set. Handed to `handle.evaluate`.
 */
export function resolveAndOutlineComposer(element: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: any = element;
  let d = 0;
  while (cur && d < 15) {
    const tag = (cur.tagName || "").toUpperCase();
    const ce = cur.getAttribute ? cur.getAttribute("contenteditable") : null;
    const role = cur.getAttribute ? cur.getAttribute("role") : null;
    if (tag === "TEXTAREA" || ce === "true" || ce === "" || role === "textbox") {
      target = cur;
      break;
    }
    cur = cur.parentElement;
    d += 1;
  }
  if (target.setAttribute) target.setAttribute("data-aw-composer-highlight", "1");
  if (target.style) {
    target.style.outline = "3px solid #0a7f42";
    target.style.outlineOffset = "2px";
  }
  if (target.scrollIntoView) target.scrollIntoView({ block: "center" });
}

/** Best-effort removal of the composer outline/marker resolved from the same clicked anchor. */
export function clearComposerOutline(element: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: any = element;
  let d = 0;
  while (cur && d < 15) {
    const tag = (cur.tagName || "").toUpperCase();
    const ce = cur.getAttribute ? cur.getAttribute("contenteditable") : null;
    const role = cur.getAttribute ? cur.getAttribute("role") : null;
    if (tag === "TEXTAREA" || ce === "true" || ce === "" || role === "textbox") {
      target = cur;
      break;
    }
    cur = cur.parentElement;
    d += 1;
  }
  if (target.removeAttribute) target.removeAttribute("data-aw-composer-highlight");
  if (target.style) {
    target.style.outline = "";
    target.style.outlineOffset = "";
  }
}
