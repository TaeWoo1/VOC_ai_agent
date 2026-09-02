/**
 * **Row-scoped composer seams (READ-ONLY in-page strings).** Acceptance Closure §3: the composer a guided run
 * fills must be structurally tied to the exact matched review — never "the one composer on the page".
 *
 * Every string here runs inside the seller's page and returns counts/booleans/integers only. They mark, they
 * never press: the one click lives in `reply-composer-open.ts`, the one fill in `reply-composer-fill.ts`.
 *
 * The matched row is the element `inPageOutlineRowAt` marked with `data-aw-id-match` after re-verifying the
 * channel review id fingerprint on it. Its SCOPE is widened exactly as the ladder widens (`__awScopeFor`):
 * the ancestors that contain this row and no other candidate row — so a composer NAVER renders as a sibling
 * panel under the row still belongs to this row alone, and a composer under another row never does.
 */
import { ID_MATCH_MARKER_ATTRIBUTE, IN_PAGE_ID_HELPERS } from "./review-id-probe-inpage";
import { IN_PAGE_FINGERPRINT_FN } from "./review-body-fingerprint-inpage";

export const OPEN_TARGET_ATTRIBUTE = "data-aw-reply-open-target";
export const COMPOSER_TARGET_ATTRIBUTE = "data-aw-reply-target";
/**
 * The verified DETAIL SCOPE, when the surface puts the composer outside the row.
 *
 * Observed live 2026-09-03: NAVER's review grid has no composer in the row at all. The review-body cell is a
 * link (`ng-click="vm.func.openReviewDetailModal(<reviewId>, true)"`) that opens a modal, and the reply box
 * lives in THAT modal. The row-scope rule could never reach it, which is why every earlier run located the
 * right review and then found zero composers.
 *
 * A modal is only accepted as the scope after its own text fingerprints to the SAME
 * `review-body-fingerprint/v1` the submission target carries — the identity check that replaces "it is inside
 * the row we verified". Without that, filling a panel would be filling whatever happened to be open.
 */
export const DETAIL_SCOPE_ATTRIBUTE = "data-aw-reply-scope";

/** Wording that OPENS a composer. Korean written as \u escapes so the emitted source stays ASCII. */
const OPEN_WORDS = ["\\ub2f5\\uae00", "\\ub2f5\\ubcc0", "\\ub313\\uae00", "reply", "comment"];
/** Wording that SUBMITS. A control carrying any of these is never tagged, whatever else it says. */
const SUBMIT_WORDS = [
  "\\ub4f1\\ub85d", "\\uc800\\uc7a5", "\\uc81c\\ucd9c", "\\uc804\\uc1a1", "\\uc644\\ub8cc", "\\ubc1c\\uc1a1",
  "submit", "post", "send", "publish", "save",
];

const SCOPE_FN = `
function __awMatchedScope() {
  // A VERIFIED detail scope wins when one exists: the composer is there, not in the row (see
  // DETAIL_SCOPE_ATTRIBUTE). It is only ever set after the body fingerprint matched, so trusting it here is
  // trusting that check, not the fact that a modal happens to be open.
  var detail = document.querySelector('[${DETAIL_SCOPE_ATTRIBUTE}]');
  if (detail) { return detail; }
  var row = document.querySelector('[${ID_MATCH_MARKER_ATTRIBUTE}]');
  if (!row) { return null; }
  return __awScopeFor(row, __awIdRows());
}
function __awWording(el) {
  var s = (el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('value') || '');
  return s.toLowerCase();
}
function __awHasAny(text, words) {
  for (var i = 0; i < words.length; i++) { if (text.indexOf(words[i].toLowerCase()) >= 0) { return true; } }
  return false;
}
var __awOpenWords = ${JSON.stringify(OPEN_WORDS)}.map(function (w) { return JSON.parse('"' + w + '"'); });
var __awSubmitWords = ${JSON.stringify(SUBMIT_WORDS)}.map(function (w) { return JSON.parse('"' + w + '"'); });
function __awComposersIn(scope) {
  var nodes = scope.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var visible = !!(n.offsetWidth || n.offsetHeight || (n.getClientRects && n.getClientRects().length));
    if (visible) { out.push(n); }
  }
  return out;
}`;

/**
 * Tag the ONE open control inside the matched row's scope. Returns the candidate count (1 ⇒ tagged). A control
 * whose wording contains a submit word is excluded before counting; a scope that already shows a composer
 * reports 0 candidates and sets nothing (there is nothing to open).
 */
export const IN_PAGE_TAG_OPEN_CONTROL = `(() => {
${IN_PAGE_ID_HELPERS}
${SCOPE_FN}
  var scope = __awMatchedScope();
  if (!scope) { return -1; }
  if (__awComposersIn(scope).length > 0) { return 0; }
  var nodes = scope.querySelectorAll('button, a, [role="button"], input[type="button"]');
  var candidates = [];
  for (var i = 0; i < nodes.length && i < 256; i++) {
    var el = nodes[i];
    var text = __awWording(el);
    if (!__awHasAny(text, __awOpenWords)) { continue; }
    if (__awHasAny(text, __awSubmitWords)) { continue; }
    if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'submit') { continue; }
    if (el.getAttribute('type') === 'submit') { continue; }
    candidates.push(el);
  }
  if (candidates.length === 1) {
    candidates[0].setAttribute('${OPEN_TARGET_ATTRIBUTE}', '1');
    candidates[0].style.outline = '2px dashed #2b6cff';
  }
  return candidates.length;
})()`;

/**
 * Tag the ONE control inside the matched row that opens THIS review's detail.
 *
 * Used only when the row carries no 답글-worded control — which is every NAVER review row, observed live. The
 * candidate is chosen by IDENTITY, not by wording: a control is eligible only when one of its own id-shaped
 * tokens fingerprints to the review id the backend holds. On the live page exactly one element qualifies
 * (`<a ng-click="vm.func.openReviewDetailModal(<id>, true)">`), and the product links beside it — which carry
 * the PRODUCT number, not the review id — do not.
 *
 * Submit wording still disqualifies a control outright, before identity is even considered: an id match is a
 * reason to believe a control is about this review, never a reason to press something that posts.
 *
 * Returns the number of eligible controls. Exactly 1 is tagged; anything else tags nothing.
 */
export function inPageTagDetailControl(reviewIdFingerprint: string): string {
  return `(async () => {
${IN_PAGE_ID_HELPERS}
${SCOPE_FN}
  var scope = __awMatchedScope();
  if (!scope) { return -1; }
  var want = ${JSON.stringify(reviewIdFingerprint)};
  var nodes = scope.querySelectorAll('a, button, [role="button"], [ng-click]');
  var hits = [];
  for (var i = 0; i < nodes.length && i < 256; i++) {
    var el = nodes[i];
    if (__awHasAny(__awWording(el), __awSubmitWords)) { continue; }
    var texts = [];
    var attrs = el.attributes;
    for (var a = 0; a < attrs.length; a++) {
      if (attrs[a].name === 'class' || attrs[a].name === 'style') { continue; }
      if (attrs[a].value) { texts.push(attrs[a].value); }
    }
    var toks = __awIdTokens(texts.join(' '));
    var fps = await __awFingerprintAll(toks);
    if (fps.indexOf(want) >= 0) { hits.push(el); }
  }
  if (hits.length === 1) {
    hits[0].setAttribute('${OPEN_TARGET_ATTRIBUTE}', '1');
    hits[0].style.outline = '2px dashed #2b6cff';
  }
  return hits.length;
})()`;
}

/**
 * After the detail control was pressed: find the panel that is showing THIS review, and mark it as the scope.
 *
 * The panel is accepted only when its own text fingerprints to the `review-body-fingerprint/v1` the submission
 * target carries — the same one-way hash the backend computed over the stored body. That is the whole identity
 * argument: "the composer is inside the row we verified" is replaced by "the panel says back the review we
 * approved a reply for". Exactly one panel must match; zero or several tags nothing and the run fails closed.
 *
 * Read-only apart from the single marker attribute. Returns `{candidates, matched}` — counts, never text.
 */
export function inPageVerifyDetailScope(bodyFingerprint: string): string {
  return `(async () => {
${IN_PAGE_FINGERPRINT_FN}
  var want = ${JSON.stringify(bodyFingerprint)};
  var seen = document.querySelectorAll('[role="dialog"], [class*="modal-content"], [class*="layer-content"], [class*="popup-content"]');
  var visible = [];
  for (var i = 0; i < seen.length && i < 32; i++) {
    var el = seen[i];
    if (!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length))) { continue; }
    if (__awComposersIn2(el).length !== 1) { continue; }
    visible.push(el);
  }
  // The panel's OWN text is not the review body - it also holds labels, the product name, the buttons. So the
  // check is whether SOME element inside it says back exactly the body we hold: one descendant whose text
  // fingerprints to the same review-body-fingerprint/v1 the submission target carries. Bounded walk.
  var matches = [];
  for (var v = 0; v < visible.length; v++) {
    var panel = visible[v];
    var nodes = panel.querySelectorAll('*');
    var hit = false;
    for (var n = 0; n < nodes.length && n < 400 && !hit; n++) {
      var text = nodes[n].innerText || nodes[n].textContent || '';
      if (text.length < 2 || text.length > 4000) { continue; }
      var fp = await __awReviewBodyFingerprint(text);
      if (fp === want) { hit = true; }
    }
    if (hit) { matches.push(panel); }
  }
  // NESTED matches are the same panel at two depths, not two panels: a modal's outer container and its
  // content both carry the review and the one composer. Keep the innermost, exactly as the row scan keeps the
  // innermost row. Two matches that do NOT contain each other are real ambiguity and tag nothing.
  var innermost = [];
  for (var a = 0; a < matches.length; a++) {
    var containsAnother = false;
    for (var b = 0; b < matches.length; b++) {
      if (a !== b && matches[a].contains(matches[b])) { containsAnother = true; break; }
    }
    if (!containsAnother) { innermost.push(matches[a]); }
  }
  if (innermost.length === 1) { innermost[0].setAttribute('${DETAIL_SCOPE_ATTRIBUTE}', '1'); }
  return { candidates: visible.length, matched: innermost.length, nested: matches.length - innermost.length };
  function __awComposersIn2(scope) {
    var nodes = scope.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.offsetWidth || n.offsetHeight || (n.getClientRects && n.getClientRects().length)) { out.push(n); }
    }
    return out;
  }
})()`;
}

/** Count the composers inside the matched row's scope and fingerprint the single one (structural integer). */
export const IN_PAGE_SCOPED_COMPOSER_SIGNALS = `(() => {
${IN_PAGE_ID_HELPERS}
${SCOPE_FN}
  var scope = __awMatchedScope();
  if (!scope) { return { composerCandidateCount: 0, structuralFingerprint: 0 }; }
  var candidates = __awComposersIn(scope);
  var fp = 0;
  if (candidates.length === 1) {
    var el = candidates[0];
    var all = Array.prototype.slice.call(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    var s = el.tagName + ':' + (el.getAttribute('role') || '') + ':' + all.indexOf(el);
    for (var i = 0; i < s.length; i++) { fp = (fp * 31 + s.charCodeAt(i)) | 0; }
    fp = fp >>> 0;
  }
  return { composerCandidateCount: candidates.length, structuralFingerprint: fp };
})()`;

/** Mark the single scoped composer for the fill; returns the count actually found at annotation time. */
export const IN_PAGE_ANNOTATE_SCOPED_COMPOSER = `(() => {
${IN_PAGE_ID_HELPERS}
${SCOPE_FN}
  var scope = __awMatchedScope();
  if (!scope) { return 0; }
  var candidates = __awComposersIn(scope);
  if (candidates.length === 1) { candidates[0].setAttribute('${COMPOSER_TARGET_ATTRIBUTE}', '1'); }
  return candidates.length;
})()`;

/** Arm a plain observer for the SELLER's own press on the tagged open control (fallback barrier). Boolean only. */
export const IN_PAGE_ARM_OPEN_OBSERVER = `(() => {
  window.__awReplyRowObserved = false;
  var ctrl = document.querySelector('[${OPEN_TARGET_ATTRIBUTE}]') || document.querySelector('[${ID_MATCH_MARKER_ATTRIBUTE}]');
  var handler = function () { window.__awReplyRowObserved = true; };
  window.__awReplyRowHandler = handler;
  if (ctrl) { ctrl.addEventListener('click', handler, true); }
  return !!ctrl;
})()`;

/** A coarse login signal: the page is not a login page. Boolean only. */
export const IN_PAGE_LOGIN_SIGNAL = `(() => {
  var body = document.body ? (document.body.getAttribute('data-page') || '') : '';
  var url = String(location.href || '');
  var host = String(location.hostname || '');
  // The AUTH HOSTS, checked by name (2026-09-03). The two text tests below were the whole signal and
  // they both pass on NAVER's real sign-in page: https://nid.naver.com/nidlogin.login?mode=form&url=...
  // has no "/login" path segment ("nidlogin" is one word) and carries no data-page. So a run landing
  // on the login screen was told it was signed in, went on to scan that page for review rows, found none,
  // and failed as TARGET_NOT_FOUND, twice, on two live sittings, while the seller was still typing.
  // A host is not a heuristic: these are the pages NAVER sends an unauthenticated seller to.
  var authHost = /(^|\\.)nid\\.naver\\.com$/i.test(host) || /(^|\\.)accounts\\.commerce\\.naver\\.com$/i.test(host);
  return !authHost && !/login|\\ub85c\\uadf8\\uc778/i.test(body) && !/\\/login/i.test(url);
})()`;

/** Remove every marker/outline/observer this module set. Idempotent; read-only. */
export const IN_PAGE_SCOPED_TEARDOWN = `(() => {
  var open = document.querySelector('[${OPEN_TARGET_ATTRIBUTE}]');
  if (open) {
    open.removeAttribute('${OPEN_TARGET_ATTRIBUTE}');
    open.style.outline = '';
    if (window.__awReplyRowHandler) { open.removeEventListener('click', window.__awReplyRowHandler, true); }
  }
  var composer = document.querySelector('[${COMPOSER_TARGET_ATTRIBUTE}]');
  if (composer) { composer.removeAttribute('${COMPOSER_TARGET_ATTRIBUTE}'); }
  var scope = document.querySelector('[${DETAIL_SCOPE_ATTRIBUTE}]');
  if (scope) { scope.removeAttribute('${DETAIL_SCOPE_ATTRIBUTE}'); }
  try { delete window.__awReplyRowObserved; delete window.__awReplyRowHandler; delete window.__awReplyObserved; }
  catch (e) { window.__awReplyRowObserved = undefined; window.__awReplyRowHandler = undefined; window.__awReplyObserved = undefined; }
  return true;
})()`;
