/**
 * **Operator-visibility proofs (RUN_INTEGRATION=1; headed = AW_HEADED=1).** Two Run 7 attempt-3 live
 * findings, over 100% synthetic pages (no marketplace markup/trademark/data, no network):
 *
 *   1. **Highlight tracks the target through scroll/layout.** attempt 3's export control was below
 *      the fold, so the fixed overlay drew OFF-SCREEN and the seated operator saw no highlight.
 *      `mountOverlay` now scrolls the control into view and glues the box to it on scroll/resize.
 *   2. **Export-scope read-back.** attempt 3's operator confirmed §8 on a view that differed from the
 *      range that actually exported. `readExportScope` reads the selected range/filters so the CLI can
 *      show the seller the scope that WILL export (operator-local; never logged/transported).
 *
 *   # automated, headless:
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/naver-live-visibility.test.ts
 *   # headed — a HUMAN watches the highlight follow the control while scrolling:
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-live-visibility.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { NaverLiveProbeDriver } from "../../src/action-window/naver-live-driver";
import { mountOverlay, unmountOverlay, overlayMounted } from "../../src/action-window/overlay";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEADED = process.env.AW_HEADED === "1";
const VIEWPORT_H = 720;

/** A tall page whose export control sits FAR below the fold, plus a selected range + filters. */
const tallExportPage = (): string => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0} .spacer{height:2400px;background:#fafafa}
    .toolbar{padding:16px} button{padding:10px 18px}
  </style></head><body>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <div class="toolbar">
      <label>시작일 <input type="date" id="from" value="2026-07-01"></label>
      <label>종료일 <input type="date" id="to" value="2026-07-23"></label>
      <select id="rating"><option>전체 평점</option><option selected>낮은 평점(1~2점)</option></select>
      <label><input type="checkbox" id="answered" checked> 답변완료 포함</label>
    </div>
    <div class="spacer">…리뷰 목록… (합성)</div>
    <div class="toolbar"><button id="exp" data-aw-target data-aw-role="primary-action">엑셀 다운로드</button></div>
    <div class="spacer">…더 많은 목록… (합성)</div>
  </body></html>`;

describe.skipIf(!RUN)("Operator visibility: scroll-tracking highlight + export-scope read-back", () => {
  let browser: Browser;
  let page: Page;
  const dirs: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: !HEADED });
  });
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(async () => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    await page?.close().catch(() => {});
  });

  function newDriver(): NaverLiveProbeDriver {
    const d = mkdtempSync(join(tmpdir(), "aw-live-vis-"));
    dirs.push(d);
    return new NaverLiveProbeDriver(page, {
      quarantineDir: d,
      ingest: () => Promise.reject(new Error("ingest is out of scope for visibility proofs")),
    });
  }

  /** The overlay box's viewport top (fixed-positioned, so this is its on-screen position). */
  function overlayViewportTop(): Promise<number> {
    return page.evaluate(() => {
      const b = document.getElementById("__aw_overlay__");
      return b ? Math.round(b.getBoundingClientRect().top) : NaN;
    });
  }
  /** The target's own viewport top — the overlay must sit ~6px above it. */
  function targetViewportTop(): Promise<number> {
    return page.evaluate(() => Math.round(document.querySelector("[data-aw-target]")!.getBoundingClientRect().top));
  }

  it(
    "a below-the-fold control is scrolled into view and the highlight sits on it (not off-screen)",
    async () => {
      page = await browser.newPage({ viewport: { width: 1000, height: VIEWPORT_H } });
      await page.setContent(tallExportPage());
      // Before highlight the control is far below the fold.
      expect(await targetViewportTop()).toBeGreaterThan(VIEWPORT_H);

      await mountOverlay(page, { stepNumber: 2, totalSteps: 3, copyKey: "x", guidanceEnabled: true });
      expect(await overlayMounted(page)).toBe(true);

      // scrollIntoView({block:"center"}) brought the control INTO the viewport, and the overlay is on it.
      const targetTop = await targetViewportTop();
      expect(targetTop).toBeGreaterThanOrEqual(0);
      expect(targetTop).toBeLessThan(VIEWPORT_H);
      expect(await overlayViewportTop()).toBeCloseTo(targetTop - 6, -1); // overlay glued ~6px above
    },
    HEADED ? 120_000 : undefined,
  );

  it(
    "the highlight stays glued to the control as the operator scrolls",
    async () => {
      page = await browser.newPage({ viewport: { width: 1000, height: VIEWPORT_H } });
      await page.setContent(tallExportPage());
      await mountOverlay(page, { stepNumber: 2, totalSteps: 3, copyKey: "x", guidanceEnabled: true });

      const before = await overlayViewportTop();
      // The operator scrolls; a naive fixed overlay would stay put and drift off the control.
      await page.evaluate(() => window.scrollBy(0, 300));
      await page.waitForTimeout(50); // let the scroll handler run
      const targetTop = await targetViewportTop();
      const after = await overlayViewportTop();

      expect(after).not.toBeCloseTo(before, -1); // it moved with the scroll
      expect(after).toBeCloseTo(targetTop - 6, -1); // and it is still on the control
      await unmountOverlay(page);
      // The in-page scroll tracker is torn down on unmount (no residual listener).
      expect(await page.evaluate(() => "__aw_overlay_untrack__" in window)).toBe(false);
    },
    HEADED ? 120_000 : undefined,
  );

  it(
    "readExportScope reflects the selected range and active filters (operator-local)",
    async () => {
      page = await browser.newPage({ viewport: { width: 1000, height: VIEWPORT_H } });
      await page.setContent(tallExportPage());
      const driver = newDriver();

      const scope = await driver.readExportScope();
      expect(scope.rangeValues).toEqual(["2026-07-01", "2026-07-23"]);
      expect(scope.filterLabels).toContain("낮은 평점(1~2점)"); // the selected <select> option
      expect(scope.filterLabels).toContain("답변완료 포함"); // the checked checkbox's label
    },
    HEADED ? 120_000 : undefined,
  );

  it(
    "readExportScope fails soft to an empty read-back when no range controls exist",
    async () => {
      page = await browser.newPage();
      await page.setContent("<!doctype html><html><body><button data-aw-target>엑셀</button></body></html>");
      const driver = newDriver();
      const scope = await driver.readExportScope();
      expect(scope.rangeValues).toEqual([]);
      expect(scope.filterLabels).toEqual([]);
    },
    HEADED ? 120_000 : undefined,
  );
});
