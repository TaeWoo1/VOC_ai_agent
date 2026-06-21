/**
 * Read-only LIVE export-target probe — Playwright DOM/frame/visibility READER (live adapter).
 *
 * This is the one piece of the live probe that touches the rendered page. It runs a READ-ONLY,
 * per-frame in-page scan (the same `frame.evaluate(...)` shape as `probe-export-same-session.ts`'s
 * `scanExportCandidates`) across the main frame and every readable child frame, and returns ONLY
 * scalar counts/booleans (`RawLiveProbeSignals`) to the pure core (`live-export-target-probe.ts`).
 *
 * It exists to answer what the static HTML cannot: are there ACTUALLY-VISIBLE review rows, and is
 * an empty-state placeholder ACTUALLY visible (vs. present-but-hidden — the false-positive cause)?
 *
 * READ-ONLY CONTRACT — it never clicks, fills, presses, focuses, submits, navigates, dispatches an
 * event, waits for a download, saves a file, uploads, or writes status. Each `evaluate` body only
 * READS text/attributes/geometry inside the browser to compute counts and booleans; raw text never
 * crosses back — only numbers/booleans do. A per-frame try/catch degrades a detached / cross-origin
 * / navigating frame to "skipped" instead of aborting the run. The NAVER-specific row / empty-state
 * / grid selectors are heuristics that live here (the adapter), kept internal and never emitted; a
 * source-guard test forbids every action verb and asserts the returned shape is scalars only.
 *
 * LIVE-ONLY: invoked only from the gated same-session capture CLI under explicit per-run approval,
 * and (this slice) only in the DIAGNOSTIC branch — it never changes a gate decision or adds a click.
 */
import type { Frame, Page } from "playwright";
import type { PwPage } from "../profile";
import type { RawLiveProbeSignals } from "./live-export-target-probe";

/** One frame's read-only scan result — visible-row count + visible empty/grid booleans. */
interface FrameScan {
  rows: number;
  emptyVisible: boolean;
  gridVisible: boolean;
}

/**
 * READ-ONLY in-page scan, runnable in any frame's context. Counts ACTUALLY-VISIBLE candidate
 * review rows (excluding header rows), and reports whether a visible empty-state placeholder and a
 * visible grid-like surface exist. It only READS text/attributes/geometry — never a click, focus,
 * submit, or dispatched event — and returns only numbers/booleans (never the matched text).
 */
async function scanFrame(frame: Frame): Promise<FrameScan> {
  return frame.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const he = el as HTMLElement;
      return he.offsetParent !== null || he.getClientRects().length > 0;
    };

    // Visible review rows: role/structure rows, excluding header rows, that are actually painted.
    // Under virtualization only the viewport's rows are present — a lower bound, which is fine
    // (the decision needs presence, not the true total).
    const ROW_SEL = "[role='row'], tbody tr, [role='grid'] [role='row'], ul[role='list'] > li";
    let rows = 0;
    for (const el of Array.from(document.querySelectorAll(ROW_SEL))) {
      if (el.closest("thead")) continue;
      if (el.querySelector("th, [role='columnheader']")) continue;
      if (isVisible(el)) rows += 1;
    }

    // Visible empty-state placeholder: a short, visible node whose text reads as an empty result.
    // The whole point is the VISIBILITY test — a present-but-hidden placeholder must NOT count.
    const EMPTY_RE =
      /(?:검색|조회)\s*결과가?\s*없|결과가?\s*없습니다|등록된?\s*리뷰가?\s*없|리뷰가?\s*(?:존재하지\s*)?없|(?:데이터|내역|항목)이?\s*없|no\s+(?:results?|data|reviews?|records?|items?)\b/i;
    let emptyVisible = false;
    for (const el of Array.from(document.querySelectorAll("div, p, span, td, li, section, strong, em"))) {
      if (!isVisible(el)) continue;
      const t = (el.textContent ?? "").trim();
      if (t.length > 0 && t.length <= 120 && EMPTY_RE.test(t)) {
        emptyVisible = true;
        break;
      }
    }

    // Visible grid-like surface: a rendered table/grid/list container (vs. an un-rendered SPA shell).
    let gridVisible = false;
    for (const el of Array.from(
      document.querySelectorAll("table, tbody, [role='grid'], [role='table'], ul[role='list']"),
    )) {
      if (isVisible(el)) {
        gridVisible = true;
        break;
      }
    }

    return { rows, emptyVisible, gridVisible };
  });
}

/**
 * Gather rendered-page signals read-only across the main frame and every child frame, summing the
 * visible-row counts and OR-folding the visible empty/grid booleans. A frame that throws (detached,
 * cross-origin, navigating) is skipped — the run still completes. Returns scalars only.
 *
 * Cast `PwPage → Page` internally so the pure core can stay browser-free and unit-testable: the
 * core only ever calls this through the injected `readSignalsFn`.
 */
export async function readLiveProbeSignals(page: PwPage): Promise<RawLiveProbeSignals> {
  const real = page as unknown as Page;
  const allFrames = real.frames();
  const mainFrame = real.mainFrame();
  const childFrames = allFrames.filter((f) => f !== mainFrame);

  let visibleRowCount = 0;
  let visibleEmptyState = false;
  let visibleGridLikeSurface = false;
  let framesChecked = 0;

  for (const frame of [mainFrame, ...childFrames]) {
    try {
      const scan = await scanFrame(frame);
      visibleRowCount += scan.rows;
      visibleEmptyState = visibleEmptyState || scan.emptyVisible;
      visibleGridLikeSurface = visibleGridLikeSurface || scan.gridVisible;
      framesChecked += 1;
    } catch {
      // detached / cross-origin / navigating frame → skip this frame, keep going
    }
  }

  return {
    visibleRowCount,
    visibleEmptyState,
    visibleGridLikeSurface,
    frameTotal: allFrames.length,
    framesChecked,
  };
}
