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

export const OPEN_TARGET_ATTRIBUTE = "data-aw-reply-open-target";
export const COMPOSER_TARGET_ATTRIBUTE = "data-aw-reply-target";

/** Wording that OPENS a composer. Korean written as \u escapes so the emitted source stays ASCII. */
const OPEN_WORDS = ["\\ub2f5\\uae00", "\\ub2f5\\ubcc0", "\\ub313\\uae00", "reply", "comment"];
/** Wording that SUBMITS. A control carrying any of these is never tagged, whatever else it says. */
const SUBMIT_WORDS = [
  "\\ub4f1\\ub85d", "\\uc800\\uc7a5", "\\uc81c\\ucd9c", "\\uc804\\uc1a1", "\\uc644\\ub8cc", "\\ubc1c\\uc1a1",
  "submit", "post", "send", "publish", "save",
];

const SCOPE_FN = `
function __awMatchedScope() {
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
  // they both pass on NAVER's real sign-in page: \`https://nid.naver.com/nidlogin.login?mode=form&url=…\`
  // has no \`/login\` path segment ("nidlogin" is one word) and carries no \`data-page\`. So a run landing
  // on the login screen was told it was signed in, went on to scan that page for review rows, found none,
  // and failed as TARGET_NOT_FOUND — twice, on two live sittings, while the seller was still typing.
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
  try { delete window.__awReplyRowObserved; delete window.__awReplyRowHandler; delete window.__awReplyObserved; }
  catch (e) { window.__awReplyRowObserved = undefined; window.__awReplyRowHandler = undefined; window.__awReplyObserved = undefined; }
  return true;
})()`;
