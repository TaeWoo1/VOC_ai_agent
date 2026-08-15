/**
 * **Does the seller actually SEE the ring?** — the one question the DOM cannot answer.
 *
 * On 2026-08-15 a live locate reported `highlighted: true` and the operator, looking at the real WING screen,
 * reported no ring. Both were correct. The annotate script set `outline` on the matched `<tr>` with
 * `outline-offset: 2px`, which paints the ring OUTSIDE the row's own box — so nothing changed where a seller
 * looks. Every offline test passed, because every offline test asked the DOM, and the DOM was telling the
 * truth.
 *
 * (The first diagnosis recorded here was that Chromium does not paint an outline on a table row at all. It
 * does. That conclusion came from screenshotting only the row's own clip — measuring the wrong region, not
 * finding the wrong property — and an independent review caught it. The fix stands; the reason is this one.)
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
   * The failure this file exists for, pinned as its own case — and stated correctly, which it was not at
   * first.
   *
   * The old treatment was `outline` on the `<tr>` with `outline-offset: 2px`. It IS painted; the offset puts
   * it OUTSIDE the row's own box, so nothing inside the row changes. The first measurement here screenshotted
   * only the row and concluded "Chromium does not paint an outline on a table row", which is false — the
   * wrong region was being measured, not the wrong property.
   *
   * What was true, and what the operator observed on the real WING screen, is that the mark did not land
   * where a seller looks: inside the row. That is what this pins.
   */
  it("the old row outline leaves the row's own pixels untouched", async () => {
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

    expect(computed).toBe("rgb(43, 108, 255)"); // the property applies...
    expect(after.equals(before)).toBe(true); // ...and the row the seller is looking at is unchanged
    await page.close();
  });

  /**
   * The row the match chose must still be the row that is there. An index and a header width are not an
   * identity: a list that re-renders with one new review on top keeps its shape and hands back a different
   * review — and the run reported that as a successful locate.
   */
  it("refuses to ring a row that is no longer the one the match chose", async () => {
    const page = await reviewPage();
    const anchors = { dateText: "2026.08.10", ratingText: "4", productText: "15411270785 (81234567890)" };

    // A new 상품평 arrives at the top: index 1 is now a different review.
    await page.evaluate(() => {
      const body = document.querySelector("tbody")!;
      const fresh = body.rows[0]!.cloneNode(true) as HTMLElement;
      body.insertBefore(fresh, body.rows[0]!);
    });

    expect(await page.evaluate(buildReviewRowAnnotateScript(1, anchors))).toBe(0);
    expect(await page.locator(`[${REVIEW_TARGET_ATTRIBUTE}]`).count()).toBe(0);
    await page.close();
  });

  /** The same anchors on an unchanged page still ring it — the check refuses drift, not the ordinary case. */
  it("rings the row when its anchors still match", async () => {
    const page = await reviewPage();
    const anchors = { dateText: "2026.08.10", ratingText: "4", productText: "15411270785 (81234567890)" };

    expect(await page.evaluate(buildReviewRowAnnotateScript(1, anchors))).toBe(1);
    await page.close();
  });

  /**
   * The seller's own inline styling must survive. The teardown used to delete `background-color` and
   * `box-shadow` outright, taking WING's with them — a permanent change to their page by a run that promises
   * it only adds a ring and takes it off.
   */
  it("puts the page's own inline styles back", async () => {
    const page = await browser.newPage();
    await page.setContent(WING_HTML);
    await page.evaluate(() => {
      for (const cell of Array.from(document.querySelectorAll("tbody tr:nth-child(2) td"))) {
        (cell as HTMLElement).setAttribute("style", "background-color: rgb(255, 240, 200);");
      }
    });
    const styleOf = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("tbody tr:nth-child(2) td")).map((c) => c.getAttribute("style")),
      );
    const before = await styleOf();

    expect(await page.evaluate(buildReviewRowAnnotateScript(1))).toBe(1);
    await page.evaluate(REVIEW_TARGET_TEARDOWN);

    expect(await styleOf()).toEqual(before);
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
