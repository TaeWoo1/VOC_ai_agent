import type { Frame, Page } from "playwright";
import {
  type ExportCandidateVisibility,
  type ExportCandidateVisibilitySummary,
  summarizeExportCandidateVisibility,
} from "./esm-export-visibility";
import {
  frameHostAllowed,
  type FrameAwareExportScan,
  type FrameScanResult,
  summarizeFrameAwareExportScan,
} from "./esm-frame-scan";
import { esmUrlCategory, type EsmUrlCategory, extractEsmReviewProbeSignals, type SanitizedEsmReviewProbeSignals } from "./esm-review-probe";

/**
 * SHARED live, STRICT NO-CLICK classification of an ALREADY-OPEN ESM+ review page.
 *
 * This is the single source of the Gate-2 no-click scan: a bounded DOM settle + a
 * frame-aware, allowlist-gated, read-only export-candidate scan → one sanitized
 * classification. It takes an open `page` and NEVER launches or closes a browser, so it
 * can be called once (the `classify-esm-review` CLI) or repeatedly against the SAME
 * persistent context (the keep-open TTL probe) without duplicating the risky scan logic.
 *
 * STRICT NO-CLICK: every read is text/attribute/computed-style/geometry only — it never
 * clicks, never waits for a download, never captures or persists, writes no status, and
 * sends nothing to a backend. Output is sanitized booleans / bucketed counts / category
 * enums — never a selector, raw URL/host, raw HTML, or any account/store/product/review
 * datum. Cross-origin frames are entered ONLY via the operator-configured ESM-family
 * allowlist (`frameHostAllowed`), which is fail-closed (empty → no cross-origin read).
 */

const NETWORKIDLE_BUDGET_MS = 8_000;
const STABILITY_INTERVAL_MS = 500;
const STABILITY_STABLE_READS = 3;
const STABILITY_MAX_CHECKS = 24; // ≤ ~12s, bounded

/** Sanitized outcome of the bounded DOM-settle (no raw content, just a category). */
export type DomSettleResult = "stable" | "stable-no-networkidle" | "unsettled";

/** The ONLY shape this module emits — the sanitized Gate-2 classification of one page. */
export interface SanitizedEsmReviewClassification {
  domSettle: DomSettleResult;
  allowlistConfigured: boolean;
  signals: SanitizedEsmReviewProbeSignals;
  frameAware: FrameAwareExportScan;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Live: total element count of the top document (a number, never any DOM text). */
async function domElementCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("*").length);
}

/**
 * Best-effort, BOUNDED settle before reading: try `networkidle` on a short budget, then
 * poll the top-document element count until it is unchanged across STABLE_READS samples,
 * or give up after a bounded number of checks. Returns a sanitized category only.
 */
export async function settleEsmDom(page: Page): Promise<DomSettleResult> {
  let networkIdle = false;
  try {
    await page.waitForLoadState("networkidle", { timeout: NETWORKIDLE_BUDGET_MS });
    networkIdle = true;
  } catch {
    /* SPAs keep connections open; not a failure — fall through to the stability poll. */
  }

  let previous = -1;
  let stableReads = 0;
  for (let i = 0; i < STABILITY_MAX_CHECKS; i += 1) {
    const count = await domElementCount(page);
    if (count === previous) {
      stableReads += 1;
      if (stableReads >= STABILITY_STABLE_READS) {
        return networkIdle ? "stable" : "stable-no-networkidle";
      }
    } else {
      stableReads = 0;
      previous = count;
    }
    await sleep(STABILITY_INTERVAL_MS);
  }
  return "unsettled";
}

/**
 * READ-ONLY in-frame export-candidate descriptor extractor. Runs IN the browser context
 * (passed to `frame.evaluate`), so it must be self-contained. It only READS attributes /
 * computed style / geometry via the robust visibility cross-check (`getComputedStyle` /
 * `getBoundingClientRect` / `offsetParent` / `getClientRects` / `disabled` /
 * `aria-disabled`) — it never acts on an element and NEVER returns the matched text.
 */
function candidateScanInFrame(): { candidates: ExportCandidateVisibility[]; shadowRootHostCount: number } {
  const KW = /엑셀|excel|다운로드|download|내려받기|내보내기|export|추출|csv|xlsx/i;
  const nodes = Array.from(
    document.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']"),
  );
  const candidates: Array<{
    offsetParentPresent: boolean;
    clientRectsPresent: boolean;
    boundingBoxNonZero: boolean;
    displayNotNone: boolean;
    visibilityNotHidden: boolean;
    notDisabled: boolean;
    notAriaDisabled: boolean;
  }> = [];
  for (const el of nodes) {
    const text = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${(el as HTMLInputElement).value ?? ""}`;
    if (!KW.test(text)) continue;
    const he = el as HTMLElement;
    const cs = getComputedStyle(he);
    const rect = he.getBoundingClientRect();
    candidates.push({
      offsetParentPresent: he.offsetParent !== null,
      clientRectsPresent: he.getClientRects().length > 0,
      boundingBoxNonZero: rect.width > 0 && rect.height > 0,
      displayNotNone: cs.display !== "none",
      visibilityNotHidden: cs.visibility !== "hidden" && cs.visibility !== "collapse",
      notDisabled: !(el as HTMLButtonElement).disabled,
      notAriaDisabled: el.getAttribute("aria-disabled") !== "true",
    });
  }
  let shadowRootHostCount = 0;
  for (const el of Array.from(document.querySelectorAll("*"))) {
    if ((el as Element & { shadowRoot?: unknown }).shadowRoot) shadowRootHostCount += 1;
  }
  return { candidates, shadowRootHostCount };
}

/**
 * Same-origin guard, computed in Node from the frame + top URLs. Only the ORIGIN
 * comparison result (a boolean) is used; the raw URLs are never emitted. A non-http(s) /
 * opaque / unparseable frame URL (e.g. `about:blank`) fails closed → not scanned.
 */
function sameOrigin(frameUrl: string, topUrl: string): boolean {
  try {
    return new URL(frameUrl).origin === new URL(topUrl).origin;
  } catch {
    return false;
  }
}

/** Evaluate the in-frame descriptor extractor in one frame (top or child). */
async function scanFrameCandidates(
  frame: Frame,
): Promise<{ candidates: ExportCandidateVisibility[]; shadowRootHostCount: number }> {
  return frame.evaluate(candidateScanInFrame);
}

/**
 * READ-ONLY frame-aware export scan. Runs `candidateScanInFrame` in the TOP document, in
 * each SAME-ORIGIN child frame, and in each cross-origin child frame whose host is on the
 * operator-configured ESM-family `allowlist`. Every other cross-origin frame is skipped
 * (never entered); an inaccessible frame is `blocked`. Fail-closed: empty allowlist → no
 * cross-origin read. Returns the top-document candidates + per-frame SANITIZED summaries +
 * a coarse `EsmUrlCategory` + an `allowlisted` boolean per frame — never a raw frame URL.
 */
export async function scanEsmFramesForExport(
  page: Page,
  allowlist: readonly string[],
): Promise<{
  topCandidates: ExportCandidateVisibility[];
  shadowRootHostCount: number;
  frames: Array<{
    frameUrlCategory: EsmUrlCategory;
    readResult: FrameScanResult;
    allowlisted: boolean;
    summary: ExportCandidateVisibilitySummary | null;
  }>;
}> {
  const mainFrame = page.mainFrame();
  const topUrl = page.url();
  const top = await scanFrameCandidates(mainFrame);

  const children = page.frames().filter((f) => f !== mainFrame);
  const frames: Array<{
    frameUrlCategory: EsmUrlCategory;
    readResult: FrameScanResult;
    allowlisted: boolean;
    summary: ExportCandidateVisibilitySummary | null;
  }> = [];
  for (const frame of children) {
    const frameUrlCategory = esmUrlCategory(frame.url());
    const isSameOrigin = sameOrigin(frame.url(), topUrl);
    const allowlisted = !isSameOrigin && frameHostAllowed(frame.url(), allowlist);
    if (!isSameOrigin && !allowlisted) {
      frames.push({ frameUrlCategory, readResult: "skipped-cross-origin", allowlisted: false, summary: null });
      continue;
    }
    try {
      const scan = await scanFrameCandidates(frame);
      frames.push({
        frameUrlCategory,
        readResult: "read",
        allowlisted,
        summary: summarizeExportCandidateVisibility(scan.candidates),
      });
    } catch {
      frames.push({ frameUrlCategory, readResult: "blocked", allowlisted, summary: null });
    }
  }
  return { topCandidates: top.candidates, shadowRootHostCount: top.shadowRootHostCount, frames };
}

/**
 * Run the full Gate-2 no-click classification against an ALREADY-OPEN page: settle, scan
 * frames, build the sanitized session/export signals + the frame-aware aggregate. No
 * launch, no close, no click, no download — just one sanitized classification of the page
 * as the human left it. Reused by the classify CLI and the keep-open TTL probe.
 */
export async function classifyOpenEsmReviewPage(
  page: Page,
  allowlist: readonly string[],
): Promise<SanitizedEsmReviewClassification> {
  const domSettle = await settleEsmDom(page);
  const html = await page.content();
  const scan = await scanEsmFramesForExport(page, allowlist);
  const topVis = summarizeExportCandidateVisibility(scan.topCandidates);

  const signals = extractEsmReviewProbeSignals({
    url: page.url(),
    html,
    frameUrls: page.frames().map((f) => f.url()),
    shadowRootHostCount: scan.shadowRootHostCount,
    exportCandidateTotal: topVis.total,
    exportCandidateVisible: topVis.visible,
    exportCandidateEnabled: topVis.enabled,
    exportCandidateActionable: topVis.actionable,
  });
  const frameAware = summarizeFrameAwareExportScan({ topDocument: topVis, frames: scan.frames });

  return { domSettle, allowlistConfigured: allowlist.length > 0, signals, frameAware };
}
