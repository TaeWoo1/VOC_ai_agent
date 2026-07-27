/**
 * **Guided Acquisition Reliability — headless recovery E2E.**
 *
 * Gated behind RUN_INTEGRATION=1 so the default offline `npm test` never launches a browser (repo convention).
 * Uses ONLY local synthetic pages — no marketplace, credentials, profile, or downloads:
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/initial-import/guided-acquisition-recovery.e2e.test.ts
 *
 * It proves, against a REAL headless page, the two DOM mechanisms the reliability layer's parks depend on and
 * that unit tests can only approximate with fakes:
 *
 *  1. **Overlay visibility.** `mountOverlay` paints a spotlight only when its `[data-aw-target]` exists, and
 *     SILENTLY paints nothing when it does not — the exact "logged in, no highlight" failure. `overlayMounted`
 *     (what `verifyOverlayVisible` reads) reports the difference, so OVERLAY_NOT_VISIBLE is detectable in fact,
 *     not just in theory.
 *  2. **Window close → re-open.** A closed page resolves the close signal the boot wires (`page.once("close")`),
 *     and a fresh page in the SAME context recovers — the shape of the SURFACE_CLOSED park and its re-check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mountOverlay, overlayMounted, overlayTop } from "../../../src/action-window/overlay";

const RUN = process.env.RUN_INTEGRATION === "1";

const withTarget = `<!doctype html><html><body style="height:3000px">
  <button data-aw-target="1" style="position:absolute;top:1500px">엑셀 다운로드</button>
</body></html>`;
const noTarget = `<!doctype html><html><body><button>엑셀 다운로드</button></body></html>`;

describe.skipIf(!RUN)("Guided Acquisition Reliability — headless recovery", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("overlay paints and is detected as visible when its target exists", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(withTarget);
      await mountOverlay(page, { stepNumber: 5, totalSteps: 8, copyKey: "actionWindow.import.export", guidanceEnabled: true });
      // What verifyOverlayVisible reads: the spotlight is really on the page.
      expect(await overlayMounted(page)).toBe(true);
      // And it was scrolled into view rather than drawn off-screen (Run 7 attempt-3 finding).
      const top = await overlayTop(page);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(1000);
    } finally {
      await page.close();
    }
  });

  it("overlay silently paints NOTHING when the target is absent — the OVERLAY_NOT_VISIBLE signal is real", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(noTarget);
      // mountOverlay does not throw — it just returns having drawn nothing (the silent failure).
      await mountOverlay(page, { stepNumber: 5, totalSteps: 8, copyKey: "actionWindow.import.export", guidanceEnabled: true });
      // This is exactly what verifyOverlayVisible checks to throw OVERLAY_NOT_VISIBLE.
      expect(await overlayMounted(page)).toBe(false);
    } finally {
      await page.close();
    }
  });

  it("a closed window resolves the close signal, and a fresh page in the same context recovers", async () => {
    const context: BrowserContext = await browser.newContext();
    try {
      const page: Page = await context.newPage();
      await page.setContent(withTarget);
      // The exact wiring the boot uses.
      const closed = new Promise<void>((resolve) => page.once("close", () => resolve()));
      await page.close();
      // Resolves — the session would park on SURFACE_CLOSED here.
      await expect(closed).resolves.toBeUndefined();

      // Re-open: a fresh page in the SAME context (cookies/session survive), the SURFACE_CLOSED re-check shape.
      const reopened = await context.newPage();
      await reopened.setContent(withTarget);
      await mountOverlay(reopened, { stepNumber: 1, totalSteps: 8, copyKey: "actionWindow.import.export", guidanceEnabled: true });
      expect(await overlayMounted(reopened)).toBe(true);
    } finally {
      await context.close();
    }
  });
});
