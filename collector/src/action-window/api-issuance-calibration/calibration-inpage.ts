/**
 * **API-center calibration — the in-page INIT SCRIPT (STRUCTURE ONLY, value-free).**
 *
 * This is the browser-side half of the multi-surface selector calibrator (`instruments/calibration/calibrate-api-center.ts`).
 * It gathers a RAW STRUCTURAL capture of the element the operator hovered and confirmed with a hotkey; it
 * NEVER decides what is kept — that is the pure gate in `./calibration.ts` (`sanitizeCapture`). The strict
 * division of labour is the whole safety story: the page gathers structure, `calibration.ts` sanitizes.
 *
 * **Capture model — init-script + exposeBinding (the race-immune replacement).** The previous model armed
 * in-page listeners via `page.evaluate` and re-armed them by Node polling; a navigation destroyed the
 * listeners between the arm and the operator's hotkey (0 captures), and a re-arm `page.evaluate` that raced
 * the navigation crashed the process. This model installs {@link buildCalibrationInitScript} once via
 * `BrowserContext.addInitScript`: Playwright re-runs it automatically at the start of EVERY new document
 * (navigation / reload / new tab) and in EVERY child frame, BEFORE the page's own scripts — so a live
 * listener is always present without any Node-side re-arm to race. Captures are pushed Node-ward through
 * `BrowserContext.exposeBinding` functions ({@link CAL_CAPTURE_BINDING} / {@link CAL_STAGE_BINDING}) that
 * exist in every frame; the CLI never polls the page to re-arm, so no `page.evaluate` can race a navigation.
 *
 * The script is a **string IIFE**, not a passed function. tsx/esbuild instruments named/module functions
 * with a `__name` helper that does not exist in the page context, so a serialized function throws
 * `ReferenceError: __name is not defined`; a string literal is never instrumented. Kept ES5-plain (no arrow,
 * no `Set`, no spread; `.then` + `function` are fine) so it runs across page runtimes.
 *
 * **Hard forbidden in this script (enforced by `calibration-guard.test.ts`):** reading `.value`,
 * `.textContent`, `.innerText`, `.innerHTML`, `.outerHTML`, any full-DOM dump, clipboard, or screenshot; and
 * NEVER `preventDefault` / `stopPropagation` / `dispatchEvent` — the observer only WATCHES the operator's own
 * navigation, it never generates or blocks a click. `getAttribute` / `querySelectorAll` / `addEventListener` /
 * `getBoundingClientRect` are the allowed structural reads. A credential / readonly element's VALUE is never
 * read — only its type / readonly-ness / attribute PRESENCE and geometry.
 */

/** The keyboard combo that CONFIRMS a hovered element for calibration. The combo is defined + exposed here. */
export interface CalibrationHotkey {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** The main key, case-insensitive (compared upper-cased against `KeyboardEvent.key`). */
  key: string;
}

/** Default calibration hotkey: **Ctrl+Shift+K**. */
export const DEFAULT_CALIBRATION_HOTKEY: CalibrationHotkey = { ctrl: true, shift: true, alt: false, key: "K" };

/** Human-legible label for the default hotkey (printed in operator instructions; never a value). */
export const DEFAULT_CALIBRATION_HOTKEY_LABEL = "Ctrl+Shift+K";

/** Render a hotkey as a legible label like `Ctrl+Shift+K` (for sanitized operator instructions). */
export function hotkeyLabel(hk: CalibrationHotkey): string {
  const parts: string[] = [];
  if (hk.ctrl) parts.push("Ctrl");
  if (hk.shift) parts.push("Shift");
  if (hk.alt) parts.push("Alt");
  parts.push(hk.key.toUpperCase());
  return parts.join("+");
}

/**
 * The two `window` binding names the init script calls to reach Node. Both are valid JS identifiers and are
 * installed in every frame by `BrowserContext.exposeBinding`. The init script interpolates THESE constants
 * (never a divergent hardcoded literal), so a rename here stays consistent between page and Node.
 *   • {@link CAL_STAGE_BINDING} — a read-only pull: returns the current `{nonce, kind}` (or null) so a stale
 *     hotkey with no active stage does nothing.
 *   • {@link CAL_CAPTURE_BINDING} — a fire-and-forget push of the STRUCTURAL capture payload to Node.
 */
export const CAL_STAGE_BINDING = "__soCalStage__";
export const CAL_CAPTURE_BINDING = "__soCalCapture__";

/** Marks the calibration overlay toasts so a redraw can dedupe them without reading any content. */
export const CAL_TOAST_ATTR = "data-sellerops-cal-toast";

/**
 * Build the ONE value-free init script for a specific hotkey. `BrowserContext.addInitScript(this)` makes
 * Playwright run it at the start of every new document and every child frame, before the page's own scripts.
 *
 * IDEMPOTENT PER DOCUMENT: `window.__soCalInstalled__` short-circuits a second install in the SAME document,
 * while a fresh document (nav / reload / new tab / child frame) is a new realm without the flag, so
 * addInitScript's re-run installs exactly once per document — a live document is never double-installed.
 *
 * Installs THREE `document` listeners (capture phase), all read-only:
 *  (a) `mouseover` → remember the hovered element in `window.__soCalHover__`;
 *  (b) `click` (passive) → set `window.__soCalClick__ = true` so the operator's OWN navigation can be
 *      OBSERVED. It NEVER preventDefault / stopPropagation / dispatchEvent and NEVER generates a click;
 *  (c) `keydown` → when the calibration hotkey fires, take the hovered element and CAPTURE. It first pulls
 *      the current stage via `window[CAL_STAGE_BINDING]()` (a Promise): with no active stage (`!stage.nonce`)
 *      a stale/late hotkey does nothing; otherwise it builds the STRUCTURAL capture (STRUCTURE ONLY — tag,
 *      role, input type, readonly-ness, credential-value flag via TYPE + an ancestor aria-label mentioning a
 *      secret, ancestry tag chain, sibling position, bounding box, stable attributes via `getAttribute`, a
 *      candidate selector — EMPTY for a credential-value element — and its `querySelectorAll` match count),
 *      stamps it with the stage kind + nonce + frame category + observed-click flag, renders a value-free ack
 *      toast, then FIRE-AND-FORGETs `window[CAL_CAPTURE_BINDING](payload)` (never awaited). Node authoritatively
 *      re-derives the frame category and re-validates host / tab / nonce before adopting anything.
 */
export function buildCalibrationInitScript(hotkey: CalibrationHotkey): string {
  return `(function () {
  /* cal-init-script */
  var w = window;
  if (w.__soCalInstalled__) { return; }
  w.__soCalInstalled__ = true;
  var HK = ${JSON.stringify({ ctrl: hotkey.ctrl, shift: hotkey.shift, alt: hotkey.alt, key: hotkey.key.toUpperCase() })};
  var STAGE_BINDING = ${JSON.stringify(CAL_STAGE_BINDING)};
  var CAPTURE_BINDING = ${JSON.stringify(CAL_CAPTURE_BINDING)};
  var TOAST_ATTR = ${JSON.stringify(CAL_TOAST_ATTR)};

  function esc(s) { return String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"'); }

  /* Build the STRUCTURAL capture of an element — STRUCTURE ONLY, never a field value / text / HTML. Mirrors
     the frozen gate's expectations: getAttribute over the priority names, a credential-value element seeds an
     EMPTY selector, matchCount via querySelectorAll(...).length. */
  function buildCapture(el) {
    function attr(name) { return el.getAttribute ? el.getAttribute(name) : null; }
    var tagName = String(el.tagName).toLowerCase();
    var role = attr('role') || undefined;
    var inputType = (tagName === 'input' && el.type) ? String(el.type) : undefined;
    var isReadOnly = (el.hasAttribute && el.hasAttribute('readonly')) || el.readOnly === true || el.disabled === true;

    /* credential-value detection — ATTRIBUTE PRESENCE / TYPE only, never the value. A password input, OR an
       input/readonly field inside a container whose aria-label mentions a secret. */
    var isInputLike = tagName === 'input' || tagName === 'textarea';
    var mentionsSecret = false;
    var node = el;
    for (var d = 0; d < 6 && node; d++) {
      var al = (node.getAttribute ? (node.getAttribute('aria-label') || '') : '');
      var lc = String(al).toLowerCase();
      if (lc.indexOf('secret') !== -1 || lc.indexOf('client-secret') !== -1 || String(al).indexOf('시크릿') !== -1) {
        mentionsSecret = true; break;
      }
      node = node.parentElement;
    }
    var isCredentialValueElement = inputType === 'password' || ((isInputLike || isReadOnly) && mentionsSecret);

    /* ancestry (nearest-first tag names only — no values) */
    var ancestryTags = [];
    var a = el.parentElement;
    while (a && ancestryTags.length < 12) { ancestryTags.push(String(a.tagName).toLowerCase()); a = a.parentElement; }

    /* sibling position */
    var slice = Function.prototype.call.bind(Array.prototype.slice);
    var siblingIndex = 0, siblingCount = 1;
    if (el.parentElement) {
      var sibs = slice(el.parentElement.children);
      siblingCount = sibs.length;
      siblingIndex = sibs.indexOf(el);
      if (siblingIndex < 0) siblingIndex = 0;
    }

    /* geometry */
    var box = { x: 0, y: 0, w: 0, h: 0 };
    if (el.getBoundingClientRect) {
      var r = el.getBoundingClientRect();
      box = { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    /* stable attributes (structural attr names only; getAttribute is allowed for these) */
    var NAMES = ['id', 'data-testid', 'data-test', 'data-cy', 'data-qa', 'aria-label', 'name', 'role', 'class'];
    var stableAttributes = [];
    for (var n = 0; n < NAMES.length; n++) {
      var av = attr(NAMES[n]);
      if (av !== null && av !== undefined && String(av).length > 0) { stableAttributes.push({ name: NAMES[n], value: String(av) }); }
    }

    /* candidate selector: strongest safe attr first. A credential-value element gets an EMPTY selector
       (position only) — its value-bearing control must never seed a selector. */
    var candidateSelector = '';
    if (!isCredentialValueElement) {
      var PRIORITY = ['id', 'data-testid', 'data-test', 'data-cy', 'data-qa', 'aria-label', 'name', 'role', 'class'];
      for (var p = 0; p < PRIORITY.length; p++) {
        var pv = attr(PRIORITY[p]);
        if (pv !== null && pv !== undefined && String(pv).length > 0) {
          candidateSelector = tagName + '[' + PRIORITY[p] + '="' + esc(pv) + '"]';
          break;
        }
      }
    }

    var matchCount = 0;
    if (candidateSelector) {
      try { matchCount = document.querySelectorAll(candidateSelector).length; } catch (e) { matchCount = 0; }
    }

    return {
      tagName: tagName,
      role: role,
      inputType: inputType,
      isReadOnly: isReadOnly,
      isCredentialValueElement: isCredentialValueElement,
      ancestryTags: ancestryTags,
      siblingIndex: siblingIndex,
      siblingCount: siblingCount,
      boundingBox: box,
      stableAttributes: stableAttributes,
      candidateSelector: candidateSelector,
      matchCount: matchCount,
      viewport: { w: window.innerWidth || 0, h: window.innerHeight || 0 }
    };
  }

  /* Value-free ack toast: fixed label + injected target KIND (a closed-vocab enum) + integer match count +
     resolved/unresolved. Text is assembled via a text node — never innerHTML / any element value/text.
     pointer-events:none so it can never intercept the operator's own clicks. */
  function showAck(kind, matchCount) {
    if (!document.body) { return; }
    var prevT = document.querySelectorAll('[' + TOAST_ATTR + ']');
    for (var pi = 0; pi < prevT.length; pi++) { if (prevT[pi].parentNode) { prevT[pi].parentNode.removeChild(prevT[pi]); } }
    var resolved = matchCount === 1 ? 'resolved' : 'unresolved';
    var text = '대상 캡처 완료 · ' + String(kind || 'target') + ' · matches: ' + matchCount + ' · ' + resolved;
    var t = document.createElement('div');
    t.setAttribute(TOAST_ATTR, '1');
    t.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);' +
      'background:rgba(17,24,39,0.94);color:#fff;padding:8px 14px;border-radius:8px;' +
      'font:13px/1.4 -apple-system,system-ui,sans-serif;pointer-events:none;max-width:80vw;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    t.appendChild(document.createTextNode(text));
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, 3000);
  }

  function frameKind() {
    /* window.top access can throw on a cross-origin frame — that is definitively a child; Node re-derives it
       authoritatively from source.page.mainFrame() anyway. */
    try { return (window.top === window) ? 'top' : 'child'; } catch (e) { return 'child'; }
  }

  function onOver(e) { w.__soCalHover__ = e.target; }
  function onClick() { w.__soCalClick__ = true; }
  function onKey(e) {
    if (!(!!e.ctrlKey === HK.ctrl && !!e.shiftKey === HK.shift && !!e.altKey === HK.alt
        && String(e.key).toUpperCase() === HK.key)) { return; }
    var el = w.__soCalHover__ || null;
    if (!el || !el.tagName) { return; }
    var stageFn = w[STAGE_BINDING];
    if (typeof stageFn !== 'function') { return; }
    var pending;
    try { pending = stageFn(); } catch (err) { return; }
    if (!pending || typeof pending.then !== 'function') { return; }
    pending.then(function (stage) {
      if (!stage || !stage.nonce) { return; } /* no active stage → a stale/late hotkey does nothing */
      var payload = buildCapture(el);
      payload.targetKind = stage.kind;
      payload.stageNonce = stage.nonce;
      payload.frameCategory = frameKind();
      payload.operatorClickObserved = !!w.__soCalClick__;
      showAck(stage.kind, payload.matchCount);
      var captureFn = w[CAPTURE_BINDING];
      if (typeof captureFn === 'function') { try { captureFn(payload); } catch (err2) { /* fire-and-forget */ } }
    });
  }

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onClick, { capture: true, passive: true });
  w.__soCalClick__ = false;
})()`;
}

/**
 * A value-free "capture required / try again" toast, rendered NODE-side via a settled one-shot evaluate when
 * the operator signalled ready on a REQUIRED stage without having captured a target. Carries ONLY a fixed
 * instruction string — no kind, selector, value, or count. pointer-events:none so it never intercepts a click.
 */
export const CAPTURE_REQUIRED_TOAST = `(function () {
  /* cal-capture-required-toast */
  if (!document.body) { return false; }
  var prevT = document.querySelectorAll('[${CAL_TOAST_ATTR}]');
  for (var pi = 0; pi < prevT.length; pi++) { if (prevT[pi].parentNode) { prevT[pi].parentNode.removeChild(prevT[pi]); } }
  var t = document.createElement('div');
  t.setAttribute('${CAL_TOAST_ATTR}', '1');
  t.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);' +
    'background:rgba(153,27,27,0.95);color:#fff;padding:8px 14px;border-radius:8px;' +
    'font:13px/1.4 -apple-system,system-ui,sans-serif;pointer-events:none;max-width:80vw;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  t.appendChild(document.createTextNode('대상 캡처 필요 · 대상 위에 마우스를 올리고 단축키를 누르세요'));
  document.body.appendChild(t);
  setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, 3000);
  return true;
})()`;
