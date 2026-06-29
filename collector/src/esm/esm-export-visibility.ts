/**
 * Pure export-candidate VISIBILITY model — SANITIZED, browser-free, testable.
 *
 * Gate-2's first live no-click run found an ambiguity: enabled export candidates
 * were present (`enabledExportCandidateCount: few`) but ZERO registered as visible
 * (`visibleExportCandidateCount: none`), so `hasActionableExportCandidate` was false
 * — while the page's DOM hydration wait had timed out. The live scan judged
 * "visible" by `offsetParent !== null` ALONE, which reports false for common,
 * perfectly-visible cases: an element inside a `position: fixed`/portaled container,
 * or read before the SPA settled.
 *
 * This module separates the visibility DECISION (pure, unit-tested here) from the
 * live DOM READ (which stays in the CLI). The CLI extracts, per candidate, a small
 * fixed set of BOOLEAN descriptors — `getComputedStyle` / `getBoundingClientRect` /
 * `offsetParent` / `getClientRects` / `disabled` / `aria-disabled` — and passes them
 * here. No descriptor copies any DOM text, so the descriptors and every summary are
 * non-sensitive: `JSON.stringify` of them can never contain a label, selector,
 * product name, review text, id, or token.
 *
 * The cross-check is deliberately ROBUST-OR for "rendered" (any of offsetParent /
 * client rects / non-zero box) AND must NOT be CSS-hidden (display:none /
 * visibility:hidden|collapse) — so a portaled/fixed control is no longer mis-counted
 * as hidden, while a genuinely `display:none` control still is.
 */

/** Per-candidate boolean descriptor. Every field is computed in-browser; none is text. */
export interface ExportCandidateVisibility {
  /** `el.offsetParent !== null` — cheap, but false-negative for fixed/portaled nodes. */
  offsetParentPresent: boolean;
  /** `el.getClientRects().length > 0` — true when the element generates box(es). */
  clientRectsPresent: boolean;
  /** `getBoundingClientRect()` has BOTH width and height > 0. */
  boundingBoxNonZero: boolean;
  /** computed `display` is not `none`. */
  displayNotNone: boolean;
  /** computed `visibility` is neither `hidden` nor `collapse`. */
  visibilityNotHidden: boolean;
  /** the control is not `disabled` (HTML form-control disabled). */
  notDisabled: boolean;
  /** the control is not `aria-disabled="true"`. */
  notAriaDisabled: boolean;
}

/**
 * Rendered = laid out by ANY robust signal (offsetParent OR client rects OR a
 * non-zero box) AND not CSS-hidden (display:none / visibility:hidden|collapse). The
 * robust-OR fixes the `offsetParent`-only false negative; the CSS-hidden AND keeps a
 * truly hidden control out.
 */
export function candidateRendered(v: ExportCandidateVisibility): boolean {
  const laidOut = v.offsetParentPresent || v.clientRectsPresent || v.boundingBoxNonZero;
  return laidOut && v.displayNotNone && v.visibilityNotHidden;
}

/** Enabled = neither `disabled` nor `aria-disabled="true"`. */
export function candidateEnabled(v: ExportCandidateVisibility): boolean {
  return v.notDisabled && v.notAriaDisabled;
}

/** Actionable (no-click) = rendered AND enabled. Still NEVER clicked — this only counts. */
export function candidateActionable(v: ExportCandidateVisibility): boolean {
  return candidateRendered(v) && candidateEnabled(v);
}

/** Raw counts over a candidate set. Counts only — the CLI buckets them before output. */
export interface ExportCandidateVisibilitySummary {
  total: number;
  visible: number;
  enabled: number;
  actionable: number;
}

/**
 * Pure: fold per-candidate descriptors into total / visible / enabled / actionable
 * counts. Deterministic and browser-free, so the visibility logic is unit-tested
 * offline against synthetic descriptor sets (offsetParent-hidden, portaled/collapsed,
 * disabled, post-hydration visible).
 */
export function summarizeExportCandidateVisibility(
  candidates: ExportCandidateVisibility[],
): ExportCandidateVisibilitySummary {
  let visible = 0;
  let enabled = 0;
  let actionable = 0;
  for (const c of candidates) {
    if (candidateRendered(c)) visible += 1;
    if (candidateEnabled(c)) enabled += 1;
    if (candidateActionable(c)) actionable += 1;
  }
  return { total: candidates.length, visible, enabled, actionable };
}
