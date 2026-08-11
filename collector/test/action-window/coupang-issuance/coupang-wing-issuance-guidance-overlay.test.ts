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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CoupangWingIssuanceDriver,
  OPERATOR_STEP_LABELS,
  OPERATOR_STEP_TITLES,
} from "../../../src/action-window/coupang-wing-issuance-driver";
import type { CoupangIssuanceTarget } from "../../../src/action-window/coupang-issuance/coupang-issuance-driver";

/**
 * The steps with no promoted locator — every one must behave identically.
 *
 * `confirm_purpose` and `terms_consent` LEFT this list on 2026-08-11, when the guided-control calibration
 * measured the `확인` control, the `OPEN API` option label and the two consent sentences on the live purpose and
 * terms screens. They are now anchored, multi-ring steps, covered in
 * `coupang-wing-multi-ring-highlight.test.ts`. What remains is the two steps that are guidance rather than a
 * WING control at all: reaching a page, and going back to SellerOps. Their signatures are synthetic constants
 * derived from no element, which is the property this file is really about.
 */
const GUIDANCE_TARGETS: readonly CoupangIssuanceTarget[] = ["reach_open_api", "return"];

interface MountCall {
  dockedPanelOnly?: boolean;
  stepNumber: number;
  label?: string;
  badgeLabel?: string;
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

  it("the CHIP gets a short title, never the instruction — the panel owns the copy", async () => {
    // Live-observed 2026-08-11 at the key-creation step: the chip above the ring is `white-space:nowrap` (a
    // wrapping chip would grow down over the control it points at), so the full instruction ran off the
    // viewport — cutting off "SellerOps는 이 버튼을 절대 누르지 않고, 자동으로 넘어가지도 않습니다". The promise
    // not to press it, pushed off-screen at the one control that presses it, while the panel below showed it in
    // full. Two renderings of one sentence, one of them silently incomplete.
    for (const target of GUIDANCE_TARGETS) {
      const { driver, page } = driverWith(true);
      await driver.highlightTarget(target);
      expect(page.mounts[0]?.badgeLabel, target).toBe(OPERATOR_STEP_TITLES[target]);
      expect(page.mounts[0]?.label, target).toBe(OPERATOR_STEP_LABELS[target]);
    }
  });
});

describe("the chip's title and the panel's instruction are different things", () => {
  const TARGETS = Object.keys(OPERATOR_STEP_LABELS) as CoupangIssuanceTarget[];

  it("every step has a title, and it is materially shorter than its instruction", () => {
    for (const target of TARGETS) {
      const title = OPERATOR_STEP_TITLES[target];
      expect(title, target).toBeTruthy();
      // A ceiling, not a guideline: the chip cannot wrap, so a long title is a truncated one.
      expect(title.length, `${target} title is too long for a nowrap chip`).toBeLessThanOrEqual(24);
      expect(title.length, target).toBeLessThan(OPERATOR_STEP_LABELS[target].length);
    }
  });

  it("a title is never a shortened INSTRUCTION — that is how a safety clause goes missing", () => {
    // Each title names the control or the act. An abbreviated instruction reads like guidance while having
    // dropped whatever did not fit, which is exactly the failure this split repairs.
    //
    // What is forbidden is a CLAIM about SellerOps's own behaviour — `SellerOps는 …` — because that is the
    // shape of every disclosure clause, and a chip cannot hold one whole. A destination is fine:
    // `SellerOps로 돌아가기` names where the seller goes, and asserts nothing about what we do or don't do.
    for (const target of TARGETS) {
      expect(OPERATOR_STEP_TITLES[target], target).not.toContain("SellerOps는");
      expect(OPERATOR_STEP_TITLES[target], target).not.toContain("자동으로 넘어");
    }
  });

  it("**the key-creation step's chip still warns**, and its full instruction is untouched", () => {
    // The one chip that must carry a warning: shortening it must not turn "키가 생성된다" into a neutral label.
    expect(OPERATOR_STEP_TITLES.issue_final).toContain("⚠");
    expect(OPERATOR_STEP_TITLES.issue_final).toContain("키가 생성");
    // …and the panel's copy keeps every sentence the approval harness reproduces before the grant.
    for (const clause of [
      "여기서 실제로 키가 생성됩니다.",
      "'약관 동의 및 Key 발급받기' 버튼을 직접 누르세요",
      "버튼을 절대 누르지 않고, 자동으로 넘어가지도 않습니다.",
    ]) {
      expect(OPERATOR_STEP_LABELS.issue_final, clause).toContain(clause);
    }
  });

  it("the chip has a STRUCTURAL ceiling too — a long label is visibly cut, not lost off-screen", () => {
    // The backstop for whatever the next long label is: an ellipsis says something is missing, where running
    // off the viewport is indistinguishable from text that was never written.
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/overlay.ts"), "utf8");
    const badge = src.slice(src.indexOf("badge.style.cssText"), src.indexOf("box.appendChild(badge)"));
    expect(badge).toContain("text-overflow:ellipsis");
    expect(badge).toContain("overflow:hidden");
    expect(badge).toContain("max-width:");
    // `nowrap` STAYS: a wrapping chip grows downward over the control it points at.
    expect(badge).toContain("white-space:nowrap");
  });
});

describe("the locator-less steps, continued", () => {
  it("mounts NO spotlight ring for them — a docked mount makes no claim about where a control is", async () => {
    const { driver, page } = driverWith(true);
    await driver.highlightTarget("return");
    // `dockedPanelOnly` is the whole claim: no anchor lookup, no ring, no dimming, no scroll.
    expect(page.mounts[0]?.dockedPanelOnly).toBe(true);
  });
});
