/**
 * **API-center calibration — the in-page STRING scripts (STRUCTURE ONLY, value-free).**
 *
 * These are the browser-side half of the multi-surface selector calibrator (`src/cli/calibrate-api-center.ts`).
 * They gather a RAW STRUCTURAL capture of the element the operator hovered and confirmed with a hotkey; they
 * NEVER decide what is kept — that is the pure gate in `./calibration.ts` (`sanitizeCapture`). The strict
 * division of labour is the whole safety story: the page gathers structure, `calibration.ts` sanitizes.
 *
 * Every export is a **string IIFE**, not a passed function. tsx/esbuild instruments named/module functions
 * with a `__name` helper that does not exist in the page context, so a serialized function throws
 * `ReferenceError: __name is not defined`; a string literal is never instrumented. Kept ES5-plain (no arrow,
 * no `Set`, no spread) so it runs across page runtimes.
 *
 * **Hard forbidden in EVERY script (enforced by `calibration-guard.test.ts`):** reading `.value`,
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

/** Window vars the scripts communicate through (documented so the reset script clears exactly these). */
export const CAL_HOVER_VAR = "__cal_hover__";
export const CAL_CAPTURE_VAR = "__cal_capture__";
export const CAL_CLICK_VAR = "__cal_click__";

/**
 * Build the ARM script for a specific hotkey. Arms THREE read-only listeners on `document`:
 *  (a) `mouseover` (capture) → remember the hovered element in `window.__cal_hover__`;
 *  (b) `keydown` (capture) → when the calibration hotkey fires, freeze the CURRENTLY-hovered element into
 *      `window.__cal_capture__` (a reference snapshot; the structural extraction happens in READ_CAPTURED_TARGET);
 *  (c) `click` (CAPTURE phase, passive) → set `window.__cal_click__ = true` so operator navigation can be
 *      OBSERVED. It NEVER calls preventDefault / stopPropagation and NEVER generates a click.
 * Idempotent: prior calibration listeners are removed before re-arming so they never accumulate.
 */
export function buildArmCalibrationCapture(hotkey: CalibrationHotkey): string {
  return `(function () {
  /* cal-arm */
  var HK = ${JSON.stringify({ ctrl: hotkey.ctrl, shift: hotkey.shift, alt: hotkey.alt, key: hotkey.key.toUpperCase() })};
  var w = window;
  var prior = w.__cal_listeners__;
  if (prior) {
    document.removeEventListener('mouseover', prior.over, true);
    document.removeEventListener('keydown', prior.key, true);
    document.removeEventListener('click', prior.click, true);
  }
  function onOver(e) { w.__cal_hover__ = e.target; }
  function onKey(e) {
    if (!!e.ctrlKey === HK.ctrl && !!e.shiftKey === HK.shift && !!e.altKey === HK.alt
        && String(e.key).toUpperCase() === HK.key) {
      w.__cal_capture__ = w.__cal_hover__ || null;
    }
  }
  function onClick() { w.__cal_click__ = true; }
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onClick, { capture: true, passive: true });
  w.__cal_listeners__ = { over: onOver, key: onKey, click: onClick };
  w.__cal_click__ = false;
  return true;
})()`;
}

/** The ARM script for the default hotkey (Ctrl+Shift+K). */
export const ARM_CALIBRATION_CAPTURE = buildArmCalibrationCapture(DEFAULT_CALIBRATION_HOTKEY);

/**
 * Read `window.__cal_capture__` (the element the operator confirmed with the hotkey) and return the STRUCTURAL
 * capture shape `calibration.ts` consumes — WITHOUT the `targetKind`, which the CLI attaches from the stage.
 * STRUCTURE ONLY: never reads any field VALUE (incl. Client ID / Secret), text, or HTML. The credential-value
 * flag is derived from the element TYPE and from a container's aria-label ATTRIBUTE mentioning a secret — never
 * by reading the value. Returns `null` when nothing was captured this checkpoint.
 */
export const READ_CAPTURED_TARGET = `(function () {
  /* cal-read-capture */
  var el = window.__cal_capture__;
  if (!el || !el.tagName) { return null; }
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  function attr(name) { return el.getAttribute ? el.getAttribute(name) : null; }
  var tagName = String(el.tagName).toLowerCase();
  var role = attr('role') || undefined;
  var inputType = (tagName === 'input' && el.type) ? String(el.type) : undefined;
  var isReadOnly = (el.hasAttribute && el.hasAttribute('readonly')) || el.readOnly === true || el.disabled === true;

  /* credential-value detection — ATTRIBUTE PRESENCE only, never the value. A password input, OR an
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
    var v = attr(NAMES[n]);
    if (v !== null && v !== undefined && String(v).length > 0) { stableAttributes.push({ name: NAMES[n], value: String(v) }); }
  }

  /* candidate selector: strongest safe attr first. A credential-value element gets an EMPTY selector
     (position only) — its value-bearing control must never seed a selector. */
  function esc(s) { return String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"'); }
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
})()`;

/** Return whether the operator's own navigation click was observed since the last read, then reset the flag. */
export const READ_CLICK_OBSERVED = `(function () {
  /* cal-click-observed */
  var v = !!window.__cal_click__;
  window.__cal_click__ = false;
  return v;
})()`;

/** Clear the calibration window vars (per-checkpoint reset). */
export const RESET_CAPTURE = `(function () {
  /* cal-reset */
  window.__cal_hover__ = null;
  window.__cal_capture__ = null;
  window.__cal_click__ = false;
  return true;
})()`;
