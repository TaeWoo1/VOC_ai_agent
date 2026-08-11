/**
 * **Every locator-less step presents itself the same way, and says honestly whether it did.**
 *
 * The guided walk has five steps with no promoted locator. Four route through one branch that CLEARS the prior
 * step's `data-aw-target` and then mounts the panel DOCKED; two — `reach_open_api` and `return` — had their own
 * branch that did neither, which is the exact defect the docked mode was added to fix:
 *
 *  - `return` follows `credentials`, whose tag is still on the Access Key row (nothing clears a tag between
 *    steps — `clearHighlight` only runs on park paths), so the anchored mount found that STALE anchor and drew
 *    the ring on the Access Key row while the panel read `SellerOps로 돌아가기 7/7`;
 *  - `reach_open_api` runs on a fresh window where no tag exists at all, so `mountOverlay` returned at
 *    `if (!target && !o.dockedPanelOnly) return;` having created NOTHING — and the branch answered
 *    `{count: 1, sig}` regardless, so the engine barriered on step 1 with no on-page instruction rendered.
 *
 * Behavioural, over a FAKE page — no browser, no WING. The fake exposes only `evaluate` / `url` / `on`, so any
 * value read (`inputValue` / `textContent` / `getAttribute` / clipboard / screenshot) would throw here.
 */
import { describe, expect, it } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import type { CoupangIssuanceTarget } from "../../../src/action-window/coupang-issuance/coupang-issuance-driver";

/** The five steps with no promoted locator — every one must behave identically. */
const GUIDANCE_TARGETS: readonly CoupangIssuanceTarget[] = ["reach_open_api", "confirm_purpose", "terms_consent", "return"];

interface MountCall {
  dockedPanelOnly?: boolean;
  stepNumber: number;
  label?: string;
}

/**
 * A read-only fake page that can tell the driver's three in-page calls apart:
 *   - a STRING script (the clear-tag IIFE),
 *   - `evaluate(fn, opts)` — the overlay mount, whose options we capture,
 *   - `evaluate(fn)` with no argument — the `overlayMounted` read.
 */
class FakePage {
  readonly order: string[] = [];
  readonly mounts: MountCall[] = [];
  constructor(private readonly mounted: boolean) {}
  url(): string {
    return "https://wing.coupang.com/vendor/open-api";
  }
  on(): void {
    /* close handler — never fires here */
  }
  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") {
      this.order.push(script.includes("coupang-issuance-cleartag") ? "clearTag" : "script");
      return true;
    }
    if (arg !== undefined) {
      this.order.push("mount");
      this.mounts.push(arg as MountCall);
      return undefined;
    }
    this.order.push("overlayMounted");
    return this.mounted;
  }
}

function driverWith(mounted: boolean): { driver: CoupangWingIssuanceDriver; page: FakePage } {
  const page = new FakePage(mounted);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { driver: new CoupangWingIssuanceDriver(page as any), page };
}

describe("the locator-less steps all present themselves DOCKED, with no stale anchor", () => {
  it.each(GUIDANCE_TARGETS)("%s clears the prior tag, then mounts docked — in that order", async (target) => {
    const { driver, page } = driverWith(true);
    await driver.highlightTarget(target);
    // The clear must come FIRST. Clearing after the mount would leave the mount reading the stale tag, and
    // clearing without mounting docked would replace a misplaced panel with no panel at all — the two halves
    // only work together.
    expect(page.order.indexOf("clearTag")).toBeGreaterThan(-1);
    expect(page.order.indexOf("clearTag")).toBeLessThan(page.order.indexOf("mount"));
    expect(page.mounts).toHaveLength(1);
    expect(page.mounts[0]?.dockedPanelOnly, target).toBe(true);
  });

  it.each(GUIDANCE_TARGETS)("%s reports count 0 when nothing actually mounted", async (target) => {
    // The honesty half. `reach_open_api` used to answer `{count: 1}` unconditionally, so the engine armed a
    // barrier on step 1 with no instruction on screen and no way to notice. A locate result is a MEASUREMENT.
    const { driver } = driverWith(false);
    expect(await driver.highlightTarget(target)).toEqual({ count: 0 });
  });

  it.each(GUIDANCE_TARGETS)("%s reports a unique 16-hex sig when it did mount", async (target) => {
    const { driver } = driverWith(true);
    const res = await driver.highlightTarget(target);
    expect(res.count).toBe(1);
    expect(res.sig).toMatch(/^[0-9a-f]{16}$/);
  });

  it("locate and highlight agree on the signature — the engine's anti-drift check needs them equal", async () => {
    for (const target of GUIDANCE_TARGETS) {
      const { driver } = driverWith(true);
      const located = await driver.locateTarget(target);
      const highlighted = await driver.highlightTarget(target);
      expect(highlighted.sig, target).toBe(located.sig);
    }
  });

  it("each guidance step's signature is DISTINCT — one step's overlay is never mistaken for another's", async () => {
    const sigs = new Set<string>();
    for (const target of GUIDANCE_TARGETS) {
      const { driver } = driverWith(true);
      sigs.add((await driver.locateTarget(target)).sig!);
    }
    expect(sigs.size).toBe(GUIDANCE_TARGETS.length);
  });

  it("mounts NO spotlight ring for them — a docked mount makes no claim about where a control is", async () => {
    const { driver, page } = driverWith(true);
    await driver.highlightTarget("return");
    // `dockedPanelOnly` is the whole claim: no anchor lookup, no ring, no dimming, no scroll.
    expect(page.mounts[0]?.dockedPanelOnly).toBe(true);
  });
});
