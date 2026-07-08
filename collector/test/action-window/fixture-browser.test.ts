/**
 * Browser fixture tests for the Action Window Runtime (R1). Gated behind RUN_INTEGRATION=1 so the
 * default offline `npm test` never launches a browser (repo convention). Uses ONLY the local
 * synthetic fixture — no marketplace, credentials, profile, or downloads.
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/fixture-browser.test.ts
 *
 * The ONLY click on the target is `page.click(...)` in this TEST file (simulating the user). No
 * production Action Window code clicks — asserted structurally in engine.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

import { validateEventEnvelope, validateRunView, findProhibitedFields } from "../../../contracts/action-window/v1/index";
import { ActionWindowEngine } from "../../src/action-window/engine";
import { runSyntheticLoop } from "../../src/action-window/harness";
import { fixtureHtml } from "../../src/action-window/fixture";
import { mountOverlay, overlayMounted } from "../../src/action-window/overlay";

const RUN = process.env.RUN_INTEGRATION === "1";
const clickTarget = (page: Page) => page.click("[data-aw-target]"); // TEST-ONLY user simulation
const engineFor = (id: string) => new ActionWindowEngine({ runId: id, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });

describe.skipIf(!RUN)("action-window browser fixture", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  const withPage = async (fn: (p: Page) => Promise<void>) => {
    const page = await browser.newPage();
    try {
      await fn(page);
    } finally {
      await page.close();
    }
  };

  it("normal: full loop completes on a real user click, overlay repositions, events sanitized", async () => {
    await withPage(async (page) => {
      const engine = engineFor("run_b1");
      const r = await runSyntheticLoop(page, engine, {
        mode: "normal",
        simulateUserAction: clickTarget,
        shiftLayoutBeforeObserve: true,
        observeTimeoutMs: 5000,
      });
      expect(r.finalStage).toBe("COMPLETE");
      expect(r.view.status).toBe("COMPLETED");
      expect(r.observed).toBe(true);
      expect(r.downstream).toEqual({ processed: 1 });
      expect(r.overlayRepositioned).toBe(true);
      expect(validateRunView(r.view)).toEqual({ ok: true });
      for (const e of r.events) {
        expect(validateEventEnvelope(e)).toEqual({ ok: true });
        expect(findProhibitedFields(e)).toEqual([]);
      }
      // cleanup: overlay removed, observation flag cleared
      expect(await overlayMounted(page)).toBe(false);
      expect(await page.evaluate(() => "__aw_observed__" in window)).toBe(false);
    });
  });

  it("overlay is mounted but does NOT intercept the target click", async () => {
    await withPage(async (page) => {
      await page.setContent(fixtureHtml("normal"));
      await mountOverlay(page, { stepNumber: 2, totalSteps: 3, copyKey: "actionWindow.step.userTargetAction", guidanceEnabled: true });
      expect(await overlayMounted(page)).toBe(true);
      await clickTarget(page);
      const done = await page.evaluate(() => document.body.getAttribute("data-aw-state") === "done");
      expect(done).toBe(true); // click reached the target through the overlay
    });
  });

  it("guidance off hides the overlay", async () => {
    await withPage(async (page) => {
      await page.setContent(fixtureHtml("normal"));
      await mountOverlay(page, { stepNumber: 2, totalSteps: 3, copyKey: "actionWindow.step.userTargetAction", guidanceEnabled: false });
      const display = await page.evaluate(() => document.getElementById("__aw_overlay__")?.style.display);
      expect(display).toBe("none");
    });
  });

  it("zero candidates → TARGET_NOT_FOUND", async () => {
    await withPage(async (page) => {
      const engine = engineFor("run_b2");
      const r = await runSyntheticLoop(page, engine, { mode: "no-candidate", simulateUserAction: clickTarget, observeTimeoutMs: 1500 });
      expect(r.finalStage).toBe("FAILED");
      expect(r.view.blocker?.code).toBe("TARGET_NOT_FOUND");
    });
  });

  it("multiple candidates → TARGET_AMBIGUOUS", async () => {
    await withPage(async (page) => {
      const engine = engineFor("run_b3");
      const r = await runSyntheticLoop(page, engine, { mode: "multi-candidate", simulateUserAction: clickTarget, observeTimeoutMs: 1500 });
      expect(r.finalStage).toBe("FAILED");
      expect(r.view.blocker?.code).toBe("TARGET_AMBIGUOUS");
    });
  });

  it("target replaced after highlight → UI_DRIFT", async () => {
    await withPage(async (page) => {
      const engine = engineFor("run_b4");
      const r = await runSyntheticLoop(page, engine, { mode: "replaced", simulateUserAction: clickTarget, triggerDriftBeforeVerify: true, observeTimeoutMs: 5000 });
      expect(r.finalStage).toBe("FAILED");
      expect(r.view.blocker?.code).toBe("UI_DRIFT");
    });
  });

  it("clicked but expected state unchanged → no false completion", async () => {
    await withPage(async (page) => {
      const engine = engineFor("run_b5");
      const r = await runSyntheticLoop(page, engine, { mode: "unchanged", simulateUserAction: clickTarget, observeTimeoutMs: 5000 });
      expect(r.observed).toBe(true);
      expect(r.finalStage).toBe("WAIT_FOR_USER_ACTION");
      expect(r.view.status).toBe("WAITING_FOR_HUMAN");
      expect(r.events.some((e) => e.type === "RUN_COMPLETED")).toBe(false);
    });
  });

  it("invalid surface (login gate) → UNSUPPORTED_STATE", async () => {
    await withPage(async (page) => {
      const engine = engineFor("run_b6");
      const r = await runSyntheticLoop(page, engine, { mode: "session-required", observeTimeoutMs: 1500 });
      expect(r.finalStage).toBe("FAILED");
      expect(r.view.blocker?.code).toBe("UNSUPPORTED_STATE");
    });
  });
});
