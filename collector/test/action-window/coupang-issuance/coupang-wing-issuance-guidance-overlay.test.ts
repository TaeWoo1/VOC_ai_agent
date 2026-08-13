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
  OPERATOR_STEP_BRIEF,
  OPERATOR_STEP_LABELS,
  OPERATOR_STEP_TITLES,
  STEPS_WITH_DETAIL_OPEN,
} from "../../../src/action-window/coupang-wing-issuance-driver";
import type { CoupangIssuanceTarget } from "../../../src/action-window/coupang-issuance/coupang-issuance-driver";

/**
 * The steps with no promoted locator — every one must behave identically.
 *
 * `confirm_purpose` and `terms_consent` LEFT this list on 2026-08-11, when the guided-control calibration
 * measured the `확인` control, the `OPEN API` option label and the two consent sentences on the live purpose and
 * terms screens. They are now anchored, multi-ring steps, covered in
 * `coupang-wing-multi-ring-highlight.test.ts`. What remains is the two steps that are guidance rather than a
 * WING control at all: reaching a page. Its signature is a synthetic constant derived from no element, which is
 * the property this file is really about. `return` was the second until the credentials step absorbed it — that
 * step rings a real control, so it is not locator-less.
 */
const GUIDANCE_TARGETS: readonly CoupangIssuanceTarget[] = ["reach_open_api"];

interface MountCall {
  dockedPanelOnly?: boolean;
  stepNumber: number;
  label?: string;
  badgeLabel?: string;
  detail?: string;
  detailExpanded?: boolean;
}

/** A value-free locate result the fake returns for the audited fixed-label script — count + an opaque sig. */
const FAKE_LOCATE = { count: 1, sig: "a1b2c3d4e5f60718" };

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
      const isClear = script.includes("coupang-issuance-cleartag");
      this.order.push(isClear ? "clearTag" : "script");
      // The clear-tag IIFE answers a boolean; the fixed-label locate answers `{count, sig}`. Returning `true`
      // for both made every RING-path target resolve to `count: undefined` and mount nothing, so a test could
      // only ever reach the docked steps — which is how the anchored steps' panel options went unasserted.
      return isClear ? true : { ...FAKE_LOCATE };
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
      // The panel leads with the BRIEF and carries the complete copy behind its disclosure — which still
      // renders it, so nothing the walk ever said has been dropped, only moved one press away.
      expect(page.mounts[0]?.label, target).toBe(OPERATOR_STEP_BRIEF[target]);
      expect(page.mounts[0]?.detail, target).toBe(OPERATOR_STEP_LABELS[target]);
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

  it("**the copy of every step that names a consequence attributes it**", () => {
    // Corrected twice. `issue_final`'s chip read "⚠ 키가 생성되는 단계" and its panel "⚠ 여기서 실제로 키가
    // 생성됩니다" — asserted from a button label, refuted 2026-08-12 when the control was pressed and issued
    // nothing (`WING_KEY_CREATION_CONTROL_REFUTATION`). The warning now lives on the control that has the
    // consequence, and it is measured.
    expect(OPERATOR_STEP_TITLES.issue_final).not.toContain("키가 생성");
    expect(OPERATOR_STEP_LABELS.issue_final).not.toContain("여기서 실제로 키가 생성됩니다");
    // …and it does not claim SellerOps VERIFIED the absence, because it cannot: an issued surface and a no-key
    // one are measurably indistinguishable to it. The seller is told whose report this is.
    for (const clause of [
      "'약관 동의 및 Key 발급받기'를 직접 누르세요",
      "이 버튼에서는 키가 발급되지 않고",
      "SellerOps는 키 발급 여부를 확인할 수 없습니다",
    ]) {
      expect(OPERATOR_STEP_LABELS.issue_final, clause).toContain(clause);
    }
    // **The second correction was itself a removal.** It said "그 화면은 아직 SellerOps가 안내하지 않으니 직접
    // 진행해 주세요" and "Access Key가 화면에 표시되면 아래 버튼을 누르세요" — both true when written, both false
    // once the vendor screen was measured and the walk gained steps for it. Guidance that apologises for not
    // guiding, on a step that now guides, is the same class of stale safety copy as the warning above.
    expect(OPERATOR_STEP_LABELS.issue_final).not.toContain("아직 SellerOps가 안내하지 않으니");
    expect(OPERATOR_STEP_LABELS.issue_final).not.toContain("Access Key가 화면에 표시되면");
    expect(OPERATOR_STEP_LABELS.issue_final).toContain("자동으로 넘어갑니다");
  });

  it("**the key-issuing step carries the consequence, in the panel AND the chip**", () => {
    // The one control in the walk that brings a real credential into existence. Every other chip names a
    // control; this one names the consequence, because the panel alone should not have to carry a fact this
    // size — and the previous owner of that warning did not have the consequence at all.
    expect(OPERATOR_STEP_TITLES.vendor_confirm).toContain("키 발급");
    for (const clause of [
      "'확인'을 직접 누르세요",
      "여기서 실제 API 키가 발급되어 라이브 계정 상태가 바뀝니다",
      "지우려면 나중에 별도의 삭제 작업이 필요합니다",
      // SellerOps presses nothing and types nothing — the fields are the seller's own company details.
      "이 버튼을 절대 누르지 않고, 입력란에 아무것도 쓰지 않습니다",
    ]) {
      expect(OPERATOR_STEP_LABELS.vendor_confirm, clause).toContain(clause);
    }
    // The method step names the chosen option and says who chooses. `연동업체 선택` is measured to the same
    // standard and is not named, because the walk guides ONE method by product decision.
    expect(OPERATOR_STEP_LABELS.vendor_method).toContain("'자체개발(직접입력)'을 직접 선택하세요");
    // 업체명 was ALREADY painting on the untouched vendor screen; only URL and IP 주소 appeared on selection.
    expect(OPERATOR_STEP_LABELS.vendor_method).toContain("업체명은 이미 화면에 있습니다");
    expect(OPERATOR_STEP_LABELS.vendor_method).toContain("SellerOps는 선택하지 않습니다");
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

/**
 * The panel leads with a BRIEF and keeps the complete copy behind a disclosure. What has to hold is that
 * nothing was lost in the shortening, and that the two steps carrying a safety claim never hide it.
 */
describe("the panel's brief — shorter, and still safe to act on alone", () => {
  const TARGETS = Object.keys(OPERATOR_STEP_LABELS) as CoupangIssuanceTarget[];

  it("every step has one, and it is shorter than the complete copy it fronts", () => {
    for (const target of TARGETS) {
      const brief = OPERATOR_STEP_BRIEF[target];
      expect(brief, target).toBeTruthy();
      expect(brief.length, `${target} brief is not shorter`).toBeLessThanOrEqual(OPERATOR_STEP_LABELS[target].length);
    }
  });

  it("**the key-creating step's brief carries the warning itself** — a collapsed panel must still be honest", () => {
    // The one step where the collapsed state, read alone, would otherwise be "press this button". It names the
    // consequence before the instruction, and its detail opens by itself on top of that.
    expect(OPERATOR_STEP_BRIEF.vendor_confirm).toContain("실제 API 키가 발급됩니다");
    expect(OPERATOR_STEP_BRIEF.vendor_confirm).toContain("'확인'을 직접 누르세요");
    // The IP row is the step's live-observed failure mode: typing an IP without pressing 추가 registers nothing.
    expect(OPERATOR_STEP_BRIEF.vendor_confirm).toContain("추가");
  });

  it("a brief never CONTRADICTS the copy it fronts — the two 'no key here' steps stay consistent", () => {
    expect(OPERATOR_STEP_BRIEF.issue).toContain("키는 아직 만들어지지 않습니다");
    expect(OPERATOR_STEP_BRIEF.issue_final).toContain("이 버튼에서는 키가 발급되지 않습니다");
    expect(OPERATOR_STEP_BRIEF.issue_final).not.toContain("키가 발급됩니다.");
  });

  it("**the disclosure opens by itself on exactly the two safety-bearing steps**", async () => {
    // The two are the walk's safety copy: the control that creates the credential, and the one immediately
    // before it that is routinely mistaken for it.
    expect([...STEPS_WITH_DETAIL_OPEN].sort()).toEqual(["issue_final", "vendor_confirm"]);
    // …and the wiring is real, not a constant nobody reads: mounted expanded here, absent everywhere else.
    const expanded = driverWith(true);
    await expanded.driver.highlightTarget("issue_final");
    expect(expanded.page.mounts[0]?.detailExpanded).toBe(true);
    for (const target of ["issue", "credentials", "return"] as CoupangIssuanceTarget[]) {
      const { driver, page } = driverWith(true);
      await driver.highlightTarget(target);
      expect(page.mounts[0]?.detail, target).toBe(OPERATOR_STEP_LABELS[target]);
      expect(page.mounts[0]?.detailExpanded, target).toBeUndefined();
    }
  });
});

describe("the locator-less steps, continued", () => {
  it("mounts NO spotlight ring for them — a docked mount makes no claim about where a control is", async () => {
    const { driver, page } = driverWith(true);
    await driver.highlightTarget("reach_open_api");
    // `dockedPanelOnly` is the whole claim: no anchor lookup, no ring, no dimming, no scroll.
    expect(page.mounts[0]?.dockedPanelOnly).toBe(true);
  });
});
