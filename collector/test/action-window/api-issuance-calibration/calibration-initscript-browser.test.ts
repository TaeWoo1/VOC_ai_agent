/**
 * REAL-CHROMIUM contract test for the init-script + exposeBinding capture model. Gated behind
 * RUN_INTEGRATION=1 so the default offline `npm test` never launches a browser (repo convention):
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/api-issuance-calibration/calibration-initscript-browser.test.ts
 *
 * Hermetic: only `data:` / `srcdoc` documents (no network, no NAVER). It pins the exact Playwright behaviour
 * the reliability fix relies on — `BrowserContext.addInitScript` auto-runs the capture listener in EVERY new
 * document (first load, after goto, after reload, in a new tab) and in EVERY child frame, and
 * `BrowserContext.exposeBinding` installs the stage/capture `window` functions in every frame — and encodes
 * the three retired live failures as regressions:
 *   (#1) the listener is present AFTER a navigation with NO Node-side re-arm (auto-install asserts);
 *   (#2) a capture succeeds with ZERO polling re-arm (hotkey → binding → collector, no page.evaluate re-arm);
 *   (#3) navigating the page DURING the flow raises NO unhandled rejection / no crash.
 *
 * `page.keyboard` / `page.hover` are TEST-ONLY operator simulation — the guard scans only the source files.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import {
  buildCalibrationInitScript,
  CAL_CAPTURE_BINDING,
  CAL_STAGE_BINDING,
  DEFAULT_CALIBRATION_HOTKEY,
} from "../../../src/action-window/api-issuance-calibration/calibration-inpage";
import { createCaptureChannel, type CaptureBindingSource } from "../../../src/action-window/api-issuance-calibration/calibration-binding";

const RUN = process.env.RUN_INTEGRATION === "1";

interface CollectedCapture {
  frameCategory: unknown;
  matchCount: unknown;
  stageNonce: unknown;
  isMainFrame: boolean;
}

const BTN = "<button id=\"cap-btn\">x</button>";
// Single-quoted attributes so the button survives being embedded inside a double-quoted `srcdoc="..."`.
const CHILD_DOC = "<button id='cap-btn'>x</button>";
const dataUrl = (body: string): string => `data:text/html,<!doctype html>${encodeURIComponent(body).replace(/%20/g, " ")}`;

describe.skipIf(!RUN)("calibration init-script — real Chromium contract", () => {
  let browser: Browser | null = null;
  beforeAll(async () => {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      browser = null; // browser binary unavailable → each test it.skip()s
    }
  });
  afterAll(async () => {
    await browser?.close();
  });

  /** Fresh context with the stage provider (nonce "n1"/kind "api_group") + a capture collector + the init script. */
  async function freshContext(): Promise<{ ctx: BrowserContext; captures: CollectedCapture[] }> {
    const ctx = await browser!.newContext();
    const captures: CollectedCapture[] = [];
    await ctx.exposeBinding(CAL_STAGE_BINDING, () => ({ nonce: "n1", kind: "api_group" }));
    await ctx.exposeBinding(CAL_CAPTURE_BINDING, (source, p: Record<string, unknown>) => {
      const s = source as unknown as { frame: Frame; page: Page };
      captures.push({
        frameCategory: p.frameCategory,
        matchCount: p.matchCount,
        stageNonce: p.stageNonce,
        isMainFrame: s.frame === s.page.mainFrame(),
      });
    });
    await ctx.addInitScript(buildCalibrationInitScript(DEFAULT_CALIBRATION_HOTKEY));
    return { ctx, captures };
  }

  const installed = (target: Page | Frame): Promise<boolean> =>
    (target as unknown as { evaluate<T>(f: () => T): Promise<T> }).evaluate(
      () => (window as unknown as { __soCalInstalled__?: boolean }).__soCalInstalled__ === true,
    );

  it("auto-installs in the first document, after goto, after reload, and in a new tab (#1 no Node re-arm)", async (c) => {
    if (!browser) return c.skip();
    const { ctx } = await freshContext();
    try {
      const page = await ctx.newPage();
      await page.goto(dataUrl(BTN)); // first document
      expect(await installed(page)).toBe(true);

      await page.goto(dataUrl("<button id=\"b2\">y</button>")); // after a navigation — NO Node re-arm ran
      expect(await installed(page)).toBe(true);

      await page.reload(); // after reload
      expect(await installed(page)).toBe(true);

      const tab2 = await ctx.newPage(); // a NEW tab
      await tab2.goto(dataUrl(BTN));
      expect(await installed(tab2)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it("auto-installs in a CHILD frame (addInitScript reaches every frame)", async (c) => {
    if (!browser) return c.skip();
    const { ctx } = await freshContext();
    try {
      const page = await ctx.newPage();
      await page.setContent(`<!doctype html><iframe srcdoc="${CHILD_DOC}"></iframe>`);
      await page.waitForFunction(() => window.frames.length > 0);
      const child = page.frames().find((f) => f !== page.mainFrame())!;
      expect(await installed(child)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it("captures from the TOP frame via the hotkey (#2 capture with zero polling re-arm)", async (c) => {
    if (!browser) return c.skip();
    const { ctx, captures } = await freshContext();
    try {
      const page = await ctx.newPage();
      await page.goto(dataUrl(BTN));
      await page.hover("#cap-btn");
      await page.keyboard.press("Control+Shift+K");
      await page.waitForFunction(() => document.querySelectorAll("[data-sellerops-cal-toast]").length > 0);
      // The capture push is fire-and-forget; wait for the binding to land it.
      await expect.poll(() => captures.length).toBe(1);
      expect(captures[0]).toMatchObject({ frameCategory: "top", matchCount: 1, stageNonce: "n1", isMainFrame: true });
    } finally {
      await ctx.close();
    }
  });

  it("captures from a CHILD frame with the authoritative child frame category", async (c) => {
    if (!browser) return c.skip();
    const { ctx, captures } = await freshContext();
    try {
      const page = await ctx.newPage();
      await page.setContent(`<!doctype html><iframe srcdoc="${CHILD_DOC}"></iframe>`);
      await page.waitForFunction(() => window.frames.length > 0);
      const child = page.frames().find((f) => f !== page.mainFrame())!;
      await child.hover("#cap-btn"); // sets the child window's hovered element
      // Dispatch the hotkey keydown INSIDE the child frame (page.keyboard routes to the top frame instead).
      // TEST-ONLY simulation of the operator's Ctrl+Shift+K — the guard scans only the source files.
      await child.dispatchEvent("#cap-btn", "keydown", { key: "K", ctrlKey: true, shiftKey: true, bubbles: true });
      await child.waitForFunction(() => document.querySelectorAll("[data-sellerops-cal-toast]").length > 0);
      await expect.poll(() => captures.length).toBe(1);
      expect(captures[0]).toMatchObject({ frameCategory: "child", matchCount: 1, stageNonce: "n1", isMainFrame: false });
    } finally {
      await ctx.close();
    }
  });

  it("an off-host frame's capture is rejected by the Node channel (host allow-list)", (c) => {
    if (!browser) return c.skip();
    const channel = createCaptureChannel({ urlCategory: "api_center_host", isActivePage: () => true });
    channel.setActiveStage("n1", "api_group");
    const offHost = {
      frame: { url: () => "https://ads.example.com/frame" },
      page: { mainFrame: () => ({}) },
    } as unknown as CaptureBindingSource;
    channel.onCapture(offHost, { stageNonce: "n1", tagName: "button", matchCount: 1, candidateSelector: 'button[id="x"]' });
    expect(channel.takeCaptureFor("n1")).toBeNull();
  });

  it("the real channel's isActivePage gate adopts from the active tab and rejects a stale tab (real Page identity)", async (c) => {
    if (!browser) return c.skip();
    // Drive the PRODUCTION channel with the PRODUCTION predicate `(p) => p === ctx.pages().at(-1)` against
    // REAL Playwright `Page` objects — closing the gap that the unit tests only stub `isActivePage`. The frame
    // url is a host-passing stand-in (data: pages don't classify as the API-center host); the point under test
    // is that `source.page` reference-identity against the live active tab actually decides adoption.
    const ctx = await browser.newContext();
    const channel = createCaptureChannel({
      urlCategory: "api_center_host",
      isActivePage: (p) => p === ctx.pages().at(-1),
    });
    channel.setActiveStage("n1", "api_group");
    try {
      const page1 = await ctx.newPage();
      const apiCenterFrame = { url: () => "https://apicenter.commerce.naver.com/" };
      const payload = { stageNonce: "n1", tagName: "button", matchCount: 1, candidateSelector: 'button[id="cap-btn"]', frameCategory: "top" };
      // page1 is the active (last) tab → adopted.
      channel.onCapture({ frame: apiCenterFrame, page: page1 } as unknown as CaptureBindingSource, payload);
      expect(channel.takeCaptureFor("n1")).not.toBeNull();

      // Open a second tab so page1 is no longer active; a fresh nonce's capture from the STALE page1 is rejected.
      channel.setActiveStage("n2", "api_group");
      const page2 = await ctx.newPage();
      await page2.goto(dataUrl(BTN));
      channel.onCapture({ frame: apiCenterFrame, page: page1 } as unknown as CaptureBindingSource, { ...payload, stageNonce: "n2" });
      expect(channel.takeCaptureFor("n2")).toBeNull();
      // …but a capture from the now-active page2 IS adopted.
      channel.onCapture({ frame: apiCenterFrame, page: page2 } as unknown as CaptureBindingSource, { ...payload, stageNonce: "n2" });
      expect(channel.takeCaptureFor("n2")).not.toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it("navigating DURING the flow raises no unhandled rejection / no crash (#3)", async (c) => {
    if (!browser) return c.skip();
    const { ctx } = await freshContext();
    const rejections: unknown[] = [];
    const onRej = (e: unknown): void => void rejections.push(e);
    process.on("unhandledRejection", onRej);
    try {
      const page = await ctx.newPage();
      await page.goto(dataUrl(BTN));
      await page.hover("#cap-btn");
      // Fire the hotkey and immediately navigate — the binding round-trip races the navigation.
      await page.keyboard.press("Control+Shift+K");
      await page.goto(dataUrl("<button id=\"b3\">z</button>"));
      await page.reload();
      // The listener is present again after every navigation with no Node re-arm.
      expect(await installed(page)).toBe(true);
      await new Promise((r) => setTimeout(r, 100));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRej);
      await ctx.close();
    }
  });
});
