/**
 * Live, STRICT NO-CLICK ESM+ REVIEW export classifier — one human-attended diagnostic run.
 *
 *   set -a && . ./.env && set +a   # load ESM_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npm run classify-esm-review -- --i-understand-this-opens-live-esm
 *
 * This is Gate 2 of the ESM+ REVIEW model-C discovery ladder
 * (`docs/esmplus-review-export-discovery.md`). It mirrors the NAVER
 * `classify-export-same-session` boundary, for ESM+ (Gmarket / Auction): it reads the
 * page a human reached and classifies the review-export surface from the rendered
 * STRUCTURE ALONE — it never clicks a control, never waits for a download, never
 * captures or persists a file, writes no status record, starts no backend, touches no
 * DB, and sends nothing to SellerOps.
 *
 * It is structurally separate from any trigger/capture path: it imports only the PURE
 * probe (`extractEsmReviewProbeSignals`) plus the approval/sentinel helpers and the
 * channel-generic persistent-context launcher. Every read is READ-ONLY (text /
 * attribute / visibility scan) and the only output is sanitized booleans / bucketed
 * counts / category enums — never a selector, raw URL, raw HTML, or any account /
 * store / product / review / customer datum.
 *
 * The ESM session lives ONLY in the dedicated `cfg.esmProfileDir` (separate from the
 * NAVER profile). A human performs all login / 2FA / CAPTCHA; the collector never
 * types credentials and never bypasses auth.
 *
 * CONTINUATION: like the NAVER probes it does NOT read a terminal keypress (the harness
 * can't reliably deliver Enter). It polls for the ESM sentinel file whose exact absolute
 * path it prints; create that file when ready. Run only ONE probe/classifier at a time.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run ESM approval flag.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Frame, Page } from "playwright";
import { loadConfig } from "../config";
import {
  type ExportCandidateVisibility,
  type ExportCandidateVisibilitySummary,
  summarizeExportCandidateVisibility,
} from "../esm/esm-export-visibility";
import {
  type FrameScanResult,
  summarizeFrameAwareExportScan,
} from "../esm/esm-frame-scan";
import { esmApprovalRequiredMessage, hasEsmLiveApproval } from "../esm/esm-live-approval";
import { esmUrlCategory, type EsmUrlCategory, extractEsmReviewProbeSignals } from "../esm/esm-review-probe";
import { esmSentinelPathFor } from "../esm/esm-sentinel";
import { log } from "../log";
import { launchPersistentBrowser } from "../profile";

// Network-idle is a best-effort first try; SPAs (like this review surface) often keep
// connections open, so a timeout here is NOT failure — the DOM-stability poll follows.
const NETWORKIDLE_BUDGET_MS = 8_000;
// Bounded DOM-stability poll: consider the DOM settled once the total element count is
// unchanged across STABLE_READS consecutive samples, or give up after MAX_STABILITY_CHECKS.
const STABILITY_INTERVAL_MS = 500;
const STABILITY_STABLE_READS = 3;
const STABILITY_MAX_CHECKS = 24; // ≤ ~12s, bounded
// The human may need to clear 2FA/CAPTCHA and any account/store flow; give them plenty
// of time, but never wait forever.
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

/** Sanitized outcome of the bounded DOM-settle (no raw content, just a category). */
type DomSettleResult = "stable" | "stable-no-networkidle" | "unsettled";

/** Prompt shown after the browser opens. The exact sentinel path is printed below it. */
const CONFIRM_PROMPT = [
  "",
  "A browser window is open on ESM+ (Gmarket / Auction). In that SAME window:",
  "  1) Complete the ESM+ login (and any 2FA/CAPTCHA) yourself.",
  "  2) Navigate to the review-management / feedback page and, if you can, make the",
  "     export controls visibly loaded.",
  "  3) Leave the browser OPEN.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  'just say "ready" and Claude creates it). The collector is polling for it and will',
  "then read ONLY sanitized structural signals and classify the export surface. It",
  "never clicks a control, never waits for a file, captures nothing, writes no status",
  "record, starts no backend, and sends nothing to SellerOps. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE ESM+ no-click review export classifier — explicit per-run approval required.");
  console.error(" Read-only: a human logs in; the collector reads SANITIZED structural signals");
  console.error(" and classifies the export surface. No click, no file, no status write.");
  console.error(line);
}

/** Live: total element count of the top document (a number, never any DOM text). */
async function domElementCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("*").length);
}

/**
 * Best-effort, BOUNDED settle before reading. The earlier version waited only for
 * `networkidle` (which timed out on this SPA, so the scan ran on an unsettled DOM and
 * mis-counted visibility). Now: try `networkidle` on a short budget, then poll the
 * top-document element count until it is unchanged across STABLE_READS samples (the
 * SPA has finished injecting controls), or give up after a bounded number of checks.
 * Returns a sanitized category only — never reads or returns any DOM content.
 */
async function settleDom(page: Page): Promise<DomSettleResult> {
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
 * READ-ONLY in-frame export-candidate descriptor extractor. Runs IN the browser
 * context (passed to `frame.evaluate`), so it must be self-contained (no outer refs).
 * Finds interactive elements whose accessible text reads like an export/download
 * control and, for each, extracts a small fixed set of BOOLEAN visibility descriptors
 * via `getComputedStyle` / `getBoundingClientRect` / `offsetParent` / `getClientRects`
 * / `disabled` / `aria-disabled` — the robust cross-check. It only READS attributes /
 * computed style / geometry — it never acts on an element, and it NEVER returns the
 * matched text. The booleans are folded into sanitized buckets by the pure
 * `summarizeExportCandidateVisibility`.
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
 * comparison result (a boolean) is used; the raw URLs are never emitted. A non-http(s)
 * / opaque / unparyseable frame URL (e.g. `about:blank`) fails closed → not scanned.
 */
function sameOrigin(frameUrl: string, topUrl: string): boolean {
  try {
    return new URL(frameUrl).origin === new URL(topUrl).origin;
  } catch {
    return false;
  }
}

/**
 * READ-ONLY frame-aware export scan. Runs `candidateScanInFrame` in the TOP document
 * and in each SAME-ORIGIN child frame; cross-origin frames are deliberately skipped
 * (we never reach into third-party frame content) and an inaccessible same-origin
 * frame is recorded as `blocked`. Returns the top-document candidates + per-frame
 * SANITIZED summaries + the coarse `EsmUrlCategory` of each frame — never a raw frame
 * URL, selector, attribute, or any DOM text.
 */
async function scanFramesForExport(page: Page): Promise<{
  topCandidates: ExportCandidateVisibility[];
  shadowRootHostCount: number;
  frames: Array<{
    frameUrlCategory: EsmUrlCategory;
    readResult: FrameScanResult;
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
    summary: ExportCandidateVisibilitySummary | null;
  }> = [];
  for (const frame of children) {
    const frameUrlCategory = esmUrlCategory(frame.url());
    if (!sameOrigin(frame.url(), topUrl)) {
      frames.push({ frameUrlCategory, readResult: "skipped-cross-origin", summary: null });
      continue;
    }
    try {
      const scan = await scanFrameCandidates(frame);
      frames.push({
        frameUrlCategory,
        readResult: "read",
        summary: summarizeExportCandidateVisibility(scan.candidates),
      });
    } catch {
      // Detached / inaccessible same-origin frame — record sanitized, never the error.
      frames.push({ frameUrlCategory, readResult: "blocked", summary: null });
    }
  }
  return { topCandidates: top.candidates, shadowRootHostCount: top.shadowRootHostCount, frames };
}

/** Evaluate the in-frame descriptor extractor in one frame (top or child). */
async function scanFrameCandidates(
  frame: Frame,
): Promise<{ candidates: ExportCandidateVisibility[]; shadowRootHostCount: number }> {
  return frame.evaluate(candidateScanInFrame);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Best-effort: remove the sentinel if present. Used at startup (clear stale) and cleanup. */
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort — a leftover is cleared by the next run's startup unlink anyway */
  }
}

/**
 * Poll for the sentinel file up to `timeoutMs`. Returns true once it appears, false on
 * timeout. Bounded by a fixed iteration count. The caller clears any stale sentinel
 * BEFORE calling this, so a hit only ever reflects a post-startup creation.
 */
async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(intervalMs);
  }
  return existsSync(path);
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasEsmLiveApproval(args)) {
    console.error(esmApprovalRequiredMessage());
    process.exit(3);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.esmReviewUrl) {
    console.error("Set ESM_REVIEW_URL to the ESM+ review-management/export page URL first.");
    process.exit(2);
    return;
  }

  // Single source of truth for the continuation file; clear any stale sentinel BEFORE
  // waiting so a leftover from a crashed run can never auto-proceed.
  const sentinelPath = esmSentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx = await launchPersistentBrowser(cfg.esmProfileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    // 1) Open the review route — this typically redirects to login / account select.
    await page.goto(cfg.esmReviewUrl, { waitUntil: "domcontentloaded" });

    // 2) Hand off to the human IN THE SAME CONTEXT; wait for the sentinel (not stdin).
    console.error(CONFIRM_PROMPT);
    console.error("");
    console.error(`  Sentinel file (create this when ready):`);
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      // Never read a half-loaded page on a timeout — abort cleanly without a snapshot.
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("esm.classify.aborted", { reason: "sentinel-timeout" });
      return;
    }

    // 3) Read the page AS THE HUMAN LEFT IT (no re-navigation — a re-nav can reset the SPA).
    const domSettle = await settleDom(page);
    const html = await page.content();
    // Frame-aware read-only scan: top document + each SAME-ORIGIN child frame.
    const scan = await scanFramesForExport(page);
    // Pure, robust visibility cross-check on the TOP document (offsetParent OR
    // client-rects OR box, not CSS-hidden; enabled = not disabled/aria-disabled).
    const topVis = summarizeExportCandidateVisibility(scan.topCandidates);

    // Top-document sanitized classification (kept SEPARATE from the frame view).
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

    // Aggregate top + per-frame scopes (where, if anywhere, an actionable control lives).
    const frameAware = summarizeFrameAwareExportScan({ topDocument: topVis, frames: scan.frames });

    const summary = { domSettle, signals, frameAware };

    // Sanitized JSON is the only stdout payload; the log echoes coarse scalars only.
    console.log(JSON.stringify(summary, null, 2));
    log("esm.review.classify.no-click", {
      domSettle,
      sessionVerdict: signals.sessionVerdict,
      exportLayoutHint: signals.exportLayoutHint,
      topDocActionable: signals.hasActionableExportCandidate,
      aggregateActionable: frameAware.hasActionableExportCandidate,
      actionableScope: frameAware.actionableScope,
      skippedFrameCount: frameAware.skippedFrameCount,
      asyncMarkerPresent: signals.asyncMarkerPresent,
      manageFeedbackRouteLike: signals.manageFeedbackRouteLike,
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
