/**
 * **Does the seller actually SEE the ring?** — the one question the DOM cannot answer.
 *
 * On 2026-08-15 a live locate reported `highlighted: true` and the operator, looking at the real WING screen,
 * reported no ring. Both were correct. The annotate script set `outline` on the matched `<tr>`, the computed
 * style read back `rgb(43, 108, 255) solid 3px`, and **Chromium painted nothing**: an outline on a table row
 * is not rendered. Every offline test passed, because every offline test asked the DOM.
 *
 * So this one asks the PIXELS. It renders a WING-shaped 상품평 table in a real Chromium, screenshots the
 * matched row, runs the annotate script, screenshots it again, and asserts the two images differ — then runs
 * the teardown and asserts the row is byte-identical to how it started. A test that asserted a style property
 * would have shipped that bug twice.
 *
 * Gated on `RUN_INTEGRATION=1`, like the WING-resident overlay browser test next door: `npm test` stays
 * hermetic and browser-free.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  REVIEW_TARGET_ATTRIBUTE,
  REVIEW_TARGET_TEARDOWN,
  buildReviewRowAnnotateScript,
} from "../../src/action-window/coupang-review/review-row-inpage";

const RUN = process.env.RUN_INTEGRATION === "1";

/**
 * A 상품평 list shaped like the real one: the header words the reader resolves roles from, a 구매자 column it
 * must exclude, and — deliberately — cells with their OWN background, so the tint has a real cascade to win.
 */
const WING_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>상품평</title>
<style>
  body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #fff; }
  table { border-collapse: collapse; width: 760px; }
  th, td { border: 1px solid #e5e7eb; padding: 10px; background: #ffffff; font-size: 13px; }
  thead th { background: #f8fafc; }
</style></head>
<body>
  <table>
    <thead><tr>
      <th>번호</th><th>노출상품ID (옵션ID)</th><th>상품명</th><th>구매자</th><th>평점</th><th>내용</th><th>등록일</th>
    </tr></thead>
    <tbody>
      <tr><td>1</td><td>15411270785 (81234567890)</td><td>무선 이어폰</td><td>김서연</td><td>5</td><td>배송도 빠르고 포장도 꼼꼼했어요</td><td>2026.08.11</td></tr>
      <tr><td>2</td><td>15411270785 (81234567890)</td><td>무선 이어폰</td><td>박민준</td><td>4</td><td>생각보다 작지만 쓸 만합니다</td><td>2026.08.10</td></tr>
      <tr><td>3</td><td>15411270785 (81234567890)</td><td>무선 이어폰</td><td>이도윤</td><td>1</td><td>연결이 자꾸 끊깁니다</td><td>2026.08.09</td></tr>
    </tbody>
  </table>
</body></html>`;

let browser: Browser;
beforeAll(async () => {
  if (!RUN) return;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function reviewPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(WING_HTML);
  return page;
}

describe.skipIf(!RUN)("the locate ring, as the seller sees it", () => {
  it("changes the pixels of the row it marks", async () => {
    const page = await reviewPage();
    const row = page.locator("tbody tr").nth(1);

    const before = await row.screenshot();
    expect(await page.evaluate(buildReviewRowAnnotateScript(1))).toBe(1);
    const after = await row.screenshot();

    expect(after.equals(before)).toBe(false);
    await page.close();
  });

  /**
   * The failure this file exists for, pinned as its own case: the old treatment reports itself as applied and
   * paints nothing. If someone puts it back, this fails while the DOM-level tests stay green.
   */
  it("an outline on the ROW paints nothing — which is why the band is on the cells", async () => {
    const page = await reviewPage();
    const row = page.locator("tbody tr").nth(1);

    const before = await row.screenshot();
    const computed = await page.evaluate(() => {
      const tr = document.querySelectorAll("tbody tr")[1] as HTMLElement;
      tr.style.outline = "3px solid #2b6cff";
      tr.style.outlineOffset = "2px";
      return getComputedStyle(tr).outlineColor;
    });
    const after = await row.screenshot();

    expect(computed).toBe("rgb(43, 108, 255)"); // the DOM says yes...
    expect(after.equals(before)).toBe(true); // ...and the screen says nothing happened
    await page.close();
  });

  it("leaves every other row untouched", async () => {
    const page = await reviewPage();
    const other = page.locator("tbody tr").nth(2);

    const before = await other.screenshot();
    expect(await page.evaluate(buildReviewRowAnnotateScript(1))).toBe(1);
    const after = await other.screenshot();

    expect(after.equals(before)).toBe(true);
    await page.close();
  });

  it("takes the ring back off, leaving the row exactly as it was", async () => {
    const page = await reviewPage();
    const row = page.locator("tbody tr").nth(1);

    const before = await row.screenshot();
    expect(await page.evaluate(buildReviewRowAnnotateScript(1))).toBe(1);
    const cleared = await page.evaluate(REVIEW_TARGET_TEARDOWN);
    const after = await row.screenshot();

    expect(cleared).toBeGreaterThan(0);
    expect(after.equals(before)).toBe(true);
    expect(await page.locator(`[${REVIEW_TARGET_ATTRIBUTE}]`).count()).toBe(0);
    await page.close();
  });

  /** A marketplace stylesheet must not be able to win the cascade and hide the one thing the run draws. */
  it("survives a page whose own styles fight it", async () => {
    const page = await browser.newPage();
    await page.setContent(
      WING_HTML.replace(
        "</style>",
        "tbody td { background: #ffffff !important; box-shadow: none !important; }</style>",
      ),
    );
    const row = page.locator("tbody tr").nth(1);

    const before = await row.screenshot();
    expect(await page.evaluate(buildReviewRowAnnotateScript(1))).toBe(1);
    const after = await row.screenshot();

    expect(after.equals(before)).toBe(false);
    await page.close();
  });
});
