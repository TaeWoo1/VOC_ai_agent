/**
 * **When the seller's browser is allowed to appear.**
 *
 * The import agent used to launch Chromium while starting up. The product owner watched that in use on
 * 2026-07-26 and reversed it: a window that appears before the seller has asked for anything arrives while they
 * are still in SellerOps choosing how far back to import, and it arrives before the screen that explains it.
 *
 * These tests pin the two halves of the replacement. The easy half is "opens on demand, exactly once". The half
 * that needs the tests is the exemptions: a teardown, or an idle poll of a panel that does not exist, must never
 * be the thing that puts a browser on someone's screen — and both of those run on paths where no surface has
 * been opened at all.
 *
 * Offline: the launch is an injected thunk, so nothing here touches Playwright.
 */
import { describe, expect, it } from "vitest";
import { LazyImportDriver } from "../../../src/action-window/initial-import/lazy-import-driver";
import { ImportFixtureDriver } from "../../../src/action-window/initial-import/import-fixture-driver";

const REQUIRED = { start: "2026-06-01", end: "2026-06-30" };

/** A lazy driver over a fixture, counting how many times the surface was actually brought up. */
function lazy(opts: { failFirst?: boolean } = {}) {
  const inner = new ImportFixtureDriver();
  let opens = 0;
  let failures = 0;
  const driver = new LazyImportDriver({
    open: async () => {
      opens += 1;
      if (opts.failFirst && failures === 0) {
        failures += 1;
        throw new Error("profile locked");
      }
      return inner;
    },
  });
  return { driver, inner, opens: () => opens };
}

describe("LazyImportDriver — nothing opens until a run needs the page", () => {
  it("opens nothing on construction", () => {
    const l = lazy();
    expect(l.opens()).toBe(0);
    expect(l.driver.isOpen()).toBe(false);
    expect(l.inner.calls).toEqual([]);
  });

  it("opens on the first call that needs the surface, and delegates it", async () => {
    const l = lazy();
    await l.driver.prepareSurface();
    expect(l.opens()).toBe(1);
    expect(l.driver.isOpen()).toBe(true);
    expect(l.inner.calls).toEqual(["prepareSurface"]);
  });

  it("opens once for a whole run, not once per call", async () => {
    const l = lazy();
    await l.driver.prepareSurface();
    await l.driver.readSurfaceFacts();
    await l.driver.locateTarget("start_date");
    await l.driver.isTargetPrefilled("start_date", REQUIRED);
    await l.driver.readSelectedScope(REQUIRED);
    expect(l.opens()).toBe(1);
  });

  /**
   * The three things that can be the FIRST call all arrive at once in a real run: the engine's `prepareSurface`,
   * the panel render that follows the frontend's pack, and the panel poll. Each awaiting its own launch would
   * open several browsers on the seller's machine.
   */
  it("opens ONE browser when several calls race to be first", async () => {
    const l = lazy();
    await Promise.all([
      l.driver.prepareSurface(),
      l.driver.readSurfaceFacts(),
      l.driver.locateTarget("export"),
    ]);
    expect(l.opens()).toBe(1);
  });

  /** A launch that failed once must not poison the agent: the seller's next attempt tries again. */
  it("does not cache a failed launch", async () => {
    const l = lazy({ failFirst: true });
    await expect(l.driver.prepareSurface()).rejects.toThrow(/profile locked/);
    expect(l.driver.isOpen()).toBe(false);

    await l.driver.prepareSurface();
    expect(l.opens()).toBe(2);
    expect(l.driver.isOpen()).toBe(true);
  });

  it("delegates every surface-needing call once open", async () => {
    const l = lazy();
    await l.driver.prepareSurface();
    await l.driver.highlightTarget("start_date");
    await l.driver.armTargetObserve("start_date");
    await l.driver.waitForTargetAction("start_date");
    await l.driver.detectDownload();
    await l.driver.validateArtifact("a1b2c3d4e5f60718");
    await l.driver.ingest("a1b2c3d4e5f60718", "MACHINE_MATCHED");
    expect(l.inner.calls).toEqual([
      "prepareSurface",
      "highlight:start_date",
      "observe:start_date",
      "wait:start_date",
      "detectDownload",
      "validate:a1b2c3d4e5f60718",
      "ingest:a1b2c3d4e5f60718",
    ]);
    expect(l.opens()).toBe(1);
  });
});

/**
 * **The exemptions.** Each of these runs on a path where the surface may never have been opened, and each would
 * otherwise cause a browser to appear for no reason the seller could understand.
 */
describe("LazyImportDriver — what must never cause a launch", () => {
  /**
   * The one that matters most. `cleanup` runs on every fail-closed path, including ones reached before the
   * surface exists — a refused ticket, a scope the server would not resolve. Launching a browser to clean up
   * nothing would be an interruption caused entirely by our own error handling.
   */
  it("cleans up without opening anything", async () => {
    const l = lazy();
    await l.driver.cleanup();
    expect(l.opens()).toBe(0);
    expect(l.inner.cleanupCount()).toBe(0);
  });

  it("clears a highlight that cannot exist without opening anything", async () => {
    const l = lazy();
    await l.driver.clearTargetHighlight();
    expect(l.opens()).toBe(0);
    expect(l.inner.calls).toEqual([]);
  });

  /** A panel that does not exist has not been pressed. `null` is the true answer, not a guess. */
  it("answers a panel poll with null instead of opening a page to look", async () => {
    const l = lazy();
    expect(await l.driver.takeGuidanceIntent()).toBeNull();
    expect(l.opens()).toBe(0);
  });

  it("removes a panel that was never mounted without opening anything", async () => {
    const l = lazy();
    await l.driver.renderGuidance(null);
    expect(l.opens()).toBe(0);
    expect(l.inner.guidanceRenders).toEqual([]);
  });

  /**
   * Drawing one is different: a run that has something to SAY to the seller has already opened the surface or is
   * about to, and a panel is only ever drawn for a run that started.
   */
  it("does open in order to draw a panel", async () => {
    const l = lazy();
    await l.driver.renderGuidance({
      product: "SellerOps",
      stepLine: "",
      instruction: "PICK-START",
      requiredRange: "",
      blocked: null,
      completion: null,
      actions: [],
    });
    expect(l.opens()).toBe(1);
    expect(l.inner.lastGuidance()?.instruction).toBe("PICK-START");
  });

  /** Once a surface DOES exist, the exemptions stop applying — teardown has real work to do. */
  it("delegates teardown and polls once a surface has been opened", async () => {
    const l = lazy();
    await l.driver.prepareSurface();
    l.inner.pressPanel("REQUEST_STEP_RECHECK");

    expect(await l.driver.takeGuidanceIntent()).toBe("REQUEST_STEP_RECHECK");
    await l.driver.clearTargetHighlight();
    await l.driver.cleanup();

    expect(l.opens()).toBe(1);
    expect(l.inner.calls).toContain("clearHighlight");
    expect(l.inner.cleanupCount()).toBe(1);
  });
});
