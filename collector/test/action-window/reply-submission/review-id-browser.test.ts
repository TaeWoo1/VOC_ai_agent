/**
 * **Review-id reconciliation real-DOM rung (RUN_INTEGRATION=1; headless, fully automated).**
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/reply-submission/review-id-browser.test.ts
 *
 * Two things can only be proven in a real browser, and both are load-bearing for the live run:
 *
 *  1. **Cross-port parity** — the in-page `crypto.subtle` implementation of `review-id-fingerprint/v1`
 *     produces exactly the digests in the shared golden vectors (which the Node port and the Java port also
 *     produce). Without this, an in-page "match" would mean nothing.
 *  2. **The ladder actually finds an id in a DOM** — and, just as importantly, the fail-closed paths really
 *     fail: a duplicated id across two rows must not resolve, and an absent id must not resolve to anything.
 *
 * The page is 100% synthetic: a review-list-*shaped* fixture with no marketplace trademark, markup, or seller
 * data. Canary strings are planted in every row so the test can prove no page text ever crosses back. Nothing
 * here touches live NAVER, and the fixture is served over `localhost` (a secure context, as `crypto.subtle`
 * requires — live NAVER is https).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import {
  IN_PAGE_ID_OUTLINE_TEARDOWN,
  ID_MATCH_MARKER_ATTRIBUTE,
  inPageOutlineRowAt,
  inPageReviewIdLadder,
} from "../../../src/action-window/reply-submission/review-id-probe-inpage";
import { IN_PAGE_REVIEW_ID_FINGERPRINT_FN } from "../../../src/action-window/reply-submission/review-id-fingerprint-inpage";
import { channelReviewIdFingerprint } from "../../../src/action-window/reply-submission/review-id-fingerprint";
import {
  buildReviewIdLocatorKey,
  locateRowByReviewId,
} from "../../../src/action-window/reply-submission/review-id-locator";
import { REVIEW_ID_VECTORS } from "./review-id-fingerprint.test";
import { parseLadderResult } from "../../../src/cli/run-review-id-reconciliation-live-naver";

const RUN = process.env.RUN_INTEGRATION === "1";
const AS_OF = { year: 2026, month: 7, day: 20 };
const CONTEXT = { channel: "naver", sellerAccountId: "acct-0001" };

const TARGET_ID = "1234567890";
const OTHER_ID = "2222222222";
const THIRD_ID = "3333333333";
const TARGET_FP = channelReviewIdFingerprint(TARGET_ID)!;
/** Planted strings that must never appear in anything the ladder returns. */
const CANARIES = ["CANARY_REVIEW_BODY", "CANARY_AUTHOR", "CANARY_ORDER_9911223344556677"];

/**
 * A review-list-shaped fixture. Each row exposes its id at a DIFFERENT rung on purpose, so one page exercises
 * the whole ladder: row 0 in an anchor href, row 1 in a data attribute, row 2 in a checkbox value.
 */
function fixtureHtml(ids: readonly string[], rowsShareOneId = false): string {
  const rows = ids
    .map((id, i) => {
      const effective = rowsShareOneId ? ids[0]! : id;
      return `
    <li class="rv">
      <input type="checkbox" value="rv-${effective}" />
      <a href="/review/detail?reviewNo=${effective}&page=1">리뷰 상세 보기</a>
      <div data-review-no="${effective}">
        <span aria-label="평점 1점">1점</span>
        <time datetime="2026-02-01">2026.02.01</time>
        <p>${CANARIES[0]}-${i} 배송이 너무 느리고 포장이 엉망이었습니다. 다시는 구매하지 않겠습니다. 정말 실망했어요.</p>
        <span>${CANARIES[1]}-${i}</span>
        <span>${CANARIES[2]}</span>
      </div>
    </li>`;
    })
    .join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>fixture</title></head>
<body><main><ul id="list">${rows}</ul></main></body></html>`;
}

let server: http.Server;
let browser: Browser;
let baseUrl = "";
let html = fixtureHtml([TARGET_ID, OTHER_ID, THIRD_ID]);

beforeAll(async () => {
  if (!RUN) return;
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

async function freshPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  return page;
}
function evalOn<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

describe.runIf(RUN)("review-id-fingerprint/v1 — in-page port parity with the golden vectors", () => {
  it("every golden vector produces the same digest in a real browser as in Node", async () => {
    const page = await freshPage();
    try {
      const raws = REVIEW_ID_VECTORS.cases.map((c) => c.raw);
      const actual = await evalOn<(string | null)[]>(
        page,
        `(async () => {
${IN_PAGE_REVIEW_ID_FINGERPRINT_FN}
var inputs = ${JSON.stringify(raws)};
var out = [];
for (var i = 0; i < inputs.length; i++) { out.push(await __awReviewIdFingerprint(inputs[i])); }
return out;
})()`,
      );
      expect(actual).toEqual(REVIEW_ID_VECTORS.cases.map((c) => c.fingerprint));
      // And the Node port agrees with both, which is the three-way proof.
      expect(actual).toEqual(raws.map((r) => channelReviewIdFingerprint(r)));
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.runIf(RUN)("the discovery ladder over a real DOM", () => {
  it("resolves EXACTLY ONE row for the target id, and reports the rung it came from", async () => {
    html = fixtureHtml([TARGET_ID, OTHER_ID, THIRD_ID]);
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      expect(parsed.candidates.length).toBe(3);
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      const outcome = locateRowByReviewId(key, CONTEXT, parsed.candidates, { rating: 1 });
      expect(outcome).toMatchObject({ matched: true, matchCount: 1, rowIndex: 0 });
      // The fixture puts the id in the checkbox value, the href AND a data attribute of the same row, and
      // none of those render as text — so `anchor-href` is the earliest rung that carries it.
      expect(outcome.matched ? outcome.source : null).toBe("anchor-href");
      expect(outcome.matched ? outcome.secondary.asserted : []).toContain("rating");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("FAILS CLOSED when two rows carry the same id — no 'first wins'", async () => {
    html = fixtureHtml([TARGET_ID, TARGET_ID, THIRD_ID], true);
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      const outcome = locateRowByReviewId(key, CONTEXT, parsed.candidates);
      expect(outcome).toMatchObject({ matched: false, reason: "MULTIPLE_MATCH" });
      expect(outcome.matchCount).toBeGreaterThan(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("FAILS CLOSED when the id is absent from the page", async () => {
    html = fixtureHtml([OTHER_ID, THIRD_ID]);
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      expect(locateRowByReviewId(key, CONTEXT, parsed.candidates)).toEqual({
        matched: false,
        reason: "ZERO_MATCH",
        matchCount: 0,
      });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("FAILS CLOSED on a secondary mismatch even though the id matched", async () => {
    html = fixtureHtml([TARGET_ID, OTHER_ID]);
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      // The fixture renders "평점 1점"; asserting 5 must fail the whole locate.
      const outcome = locateRowByReviewId(key, CONTEXT, parsed.candidates, { rating: 5 });
      expect(outcome).toMatchObject({ matched: false, reason: "SECONDARY_MISMATCH", matchCount: 1 });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("returns digests only — no page text, id, or canary ever crosses back", async () => {
    html = fixtureHtml([TARGET_ID, OTHER_ID, THIRD_ID]);
    const page = await freshPage();
    try {
      const raw = await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF));
      const serialized = JSON.stringify(raw);
      for (const canary of CANARIES) {
        expect(serialized).not.toContain(canary);
      }
      for (const id of [TARGET_ID, OTHER_ID, THIRD_ID]) {
        expect(serialized).not.toContain(id);
      }
      expect(serialized).not.toContain("배송");
      expect(serialized).not.toContain("reviewNo");
      expect(serialized).not.toContain("data-review-no");
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.runIf(RUN)("the outline is the only page mutation, and it is reversible", () => {
  it("outlines the matched row, and the teardown removes every trace", async () => {
    html = fixtureHtml([TARGET_ID, OTHER_ID, THIRD_ID]);
    const page = await freshPage();
    try {
      const before = await page.content();
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      const outcome = locateRowByReviewId(key, CONTEXT, parsed.candidates);
      expect(outcome.matched).toBe(true);

      const outlined = await evalOn<string>(
        page,
        inPageOutlineRowAt(outcome.matched ? outcome.rowIndex : 0, TARGET_FP),
      );
      expect(outlined).toBe("outlined");
      expect(await page.locator(`[${ID_MATCH_MARKER_ATTRIBUTE}]`).count()).toBe(1);

      const removed = await evalOn<number>(page, IN_PAGE_ID_OUTLINE_TEARDOWN);
      expect(removed).toBe(1);
      expect(await page.locator(`[${ID_MATCH_MARKER_ATTRIBUTE}]`).count()).toBe(0);
      // No checkbox was checked, no navigation happened, and the DOM is back where it started.
      expect(page.url()).toBe(baseUrl);
      expect(await page.locator("input[type=checkbox]:checked").count()).toBe(0);
      expect(await page.content()).toBe(before);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("outlining an out-of-range row reports 'absent' instead of guessing", async () => {
    html = fixtureHtml([TARGET_ID]);
    const page = await freshPage();
    try {
      expect(await evalOn<string>(page, inPageOutlineRowAt(99, TARGET_FP))).toBe("absent");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("REFUSES to outline when the row at that index is no longer the matched one", async () => {
    // The live shape: the list re-renders (lazy load, polling refresh) between the scan and the highlight,
    // so index n is now a different review. Outlining it would get the operator to confirm the wrong row.
    html = fixtureHtml([TARGET_ID, OTHER_ID, THIRD_ID]);
    const page = await freshPage();
    try {
      const outcome = await evalOn<string>(page, inPageOutlineRowAt(1, TARGET_FP)); // row 1 holds OTHER_ID
      expect(outcome).toBe("row-changed");
      expect(await page.locator(`[${ID_MATCH_MARKER_ATTRIBUTE}]`).count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.runIf(RUN)("the ladder survives hostile page content", () => {
  it("a malformed percent-escape in an href does not abort the scan", async () => {
    // A bare `%` (or a truncated escape) makes decodeURIComponent throw. Unguarded, that single href would
    // reject the whole ladder — and the honest-stop evidence would never be produced.
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>f</title></head><body><ul>
      <li class="rv"><a href="/search?q=100%">깨진 링크</a>
        <div>${CANARIES[0]} 배송이 너무 느리고 포장이 엉망이었습니다. 다시는 구매하지 않겠습니다. 실망.</div></li>
      <li class="rv"><a href="/review/detail?reviewNo=${TARGET_ID}">리뷰</a>
        <div data-review-no="${TARGET_ID}"><span aria-label="평점 1점">1점</span>
        <p>${CANARIES[0]} 배송이 너무 느리고 포장이 엉망이었습니다. 다시는 구매하지 않겠습니다. 실망.</p></div></li>
      </ul></body></html>`;
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      expect(parsed.candidates.length).toBe(2);
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      expect(locateRowByReviewId(key, CONTEXT, parsed.candidates)).toMatchObject({ matched: true, rowIndex: 1 });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("the rating control's aria-label wins over a '1점' mention inside the review body", async () => {
    // The row is scanned WHOLE here, so a naive text read would find the body's "1점" and manufacture a
    // secondary conflict against a correct identity match. The rating control's own label is authoritative.
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>f</title></head><body><ul>
      <li class="rv"><div data-review-no="${TARGET_ID}"><span aria-label="평점 5점">5점</span>
        <p>별점 1점 주고 싶네요. 배송이 너무 느리고 포장이 엉망이었습니다. 다시는 구매하지 않겠습니다.</p>
      </div></li></ul></body></html>`;
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      expect(parsed.candidates[0]!.secondary?.rating).toBe(5);
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      expect(locateRowByReviewId(key, CONTEXT, parsed.candidates, { rating: 5 }).matched).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("with NO aria-label and two conflicting text readings, the rating is unavailable — never guessed", async () => {
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>f</title></head><body><ul>
      <li class="rv"><div data-review-no="${TARGET_ID}"><span>5점</span>
        <p>별점 1점 주고 싶네요. 배송이 너무 느리고 포장이 엉망이었습니다. 다시는 구매하지 않겠습니다.</p>
      </div></li></ul></body></html>`;
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      expect(parsed.candidates[0]!.secondary?.rating).toBeNull();
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      // Unavailable is skipped, so a correct identity match survives instead of failing on a bad guess.
      const outcome = locateRowByReviewId(key, CONTEXT, parsed.candidates, { rating: 5 });
      expect(outcome.matched).toBe(true);
      expect(outcome.matched ? outcome.secondary.unavailable : []).toContain("rating");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("an unambiguous rating IS asserted", async () => {
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>f</title></head><body><ul>
      <li class="rv"><div data-review-no="${TARGET_ID}"><span aria-label="평점 5점">별점</span>
        <p>배송이 너무 느리고 포장이 엉망이었습니다. 다시는 구매하지 않겠습니다. 정말 실망했습니다.</p>
      </div></li></ul></body></html>`;
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      expect(parsed.candidates[0]!.secondary?.rating).toBe(5);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("finds an id carried ONLY on the outer row wrapper the innermost rule drops", async () => {
    // The live shape this exists for: the kept innermost container is the <article>, while the review number
    // lives on the <li> that wraps it. Without the exclusive-ancestor scope that id is invisible to the scan.
    const li = (id: string, i: number) =>
      `<li class="rv" data-review-no="${id}"><article>
         <span aria-label="평점 1점">별점</span>
         <p>CANARY_REVIEW_BODY-${i} 배송이 너무 느리고 포장이 엉망이었습니다. 다시는 구매하지 않겠습니다.</p>
       </article></li>`;
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>f</title></head><body><ul>
      ${li(TARGET_ID, 0)}${li(OTHER_ID, 1)}${li(THIRD_ID, 2)}</ul></body></html>`;
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      expect(parsed.scopeExpandedRows).toBeGreaterThan(0);
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      const outcome = locateRowByReviewId(key, CONTEXT, parsed.candidates);
      // Exactly one — widening to an EXCLUSIVE ancestor cannot create a second claimant.
      expect(outcome).toMatchObject({ matched: true, matchCount: 1, rowIndex: 0, source: "data-attribute" });
      // And the outline must widen identically, or it would reject its own match as 'row-changed'.
      expect(await evalOn<string>(page, inPageOutlineRowAt(0, TARGET_FP))).toBe("outlined");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("widening never creates a second claimant when a shared ancestor holds the id", async () => {
    // A container wrapping SEVERAL candidate rows is NOT exclusive, so its id is attributed to none of them.
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>f</title></head><body>
      <div data-review-no="${TARGET_ID}"><ul>
        <li class="rv"><article><p>CANARY_REVIEW_BODY-0 배송이 너무 느리고 포장이 엉망이었습니다. 실망.</p></article></li>
        <li class="rv"><article><p>CANARY_REVIEW_BODY-1 배송이 너무 느리고 포장이 엉망이었습니다. 실망.</p></article></li>
      </ul></div></body></html>`;
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      const key = buildReviewIdLocatorKey(CONTEXT.channel, CONTEXT.sellerAccountId, TARGET_ID)!;
      expect(locateRowByReviewId(key, CONTEXT, parsed.candidates)).toEqual({
        matched: false,
        reason: "ZERO_MATCH",
        matchCount: 0,
      });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("a clean small page reports the scan as NOT truncated", async () => {
    html = fixtureHtml([TARGET_ID, OTHER_ID]);
    const page = await freshPage();
    try {
      const parsed = parseLadderResult(await evalOn<unknown>(page, inPageReviewIdLadder(AS_OF)));
      expect(parsed.rowsTruncated).toBe(false);
      expect(parsed.tokensTruncated).toBe(false);
    } finally {
      await page.close();
    }
  }, 60_000);
});
