/**
 * **Acceptance Closure §2/§3 real-DOM proof (RUN_INTEGRATION=1; headless, fully automated).** The resident
 * run's `NaverLadderReplyDriver` over a REAL Chromium page shaped like a review-management list: two review
 * rows, each with its own review number, rating and a NON-SUBMIT 「답글 작성」 control that reveals the row's own
 * composer; a 「등록」 control that must never be pressed. The page is 100% synthetic (no marketplace markup,
 * no seller data) and nothing touches the network.
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/reply-submission/ladder-open-composer-browser.test.ts
 *
 * What it proves: the runtime locates the row by the backend's review-id fingerprint (not by position), presses
 * that row's open control ITSELF, finds exactly one composer inside that row's scope, fills the approved draft,
 * and stops — `window.__submitClicks` stays 0, the OTHER row's composer stays empty, and an ambiguous id (two
 * rows carrying it) opens nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import http from "node:http";
import { chromium, type Browser, type Page } from "playwright";
import { NaverLadderReplyDriver } from "../../../src/action-window/reply-submission/naver-ladder-reply-driver";
import type { LadderReplyPage } from "../../../src/action-window/reply-submission/naver-ladder-reply-driver";
import { ReplyEngine, makeReplyClock } from "../../../src/action-window/reply-submission/reply-engine";

const RUN = process.env.RUN_INTEGRATION === "1";
const TARGET_ID = "7788990011";
const OTHER_ID = "6655443322";
const DRAFT = "안녕하세요. 불편을 드려 죄송합니다. 확인 후 안내드리겠습니다.";

function fingerprintOf(id: string): string {
  return createHash("sha256").update(`review-id-fingerprint/v1\n${id}`).digest("hex");
}

function fixture(opts: { duplicateId?: boolean } = {}): string {
  const row = (id: string, rating: number, body: string) => `
    <article class="row">
      <span class="no">리뷰번호 ${id}</span>
      <span class="star" aria-label="${rating}점"></span>
      <p class="body">${body}</p>
      <div class="actions"><button type="button" class="open">답글 작성</button></div>
      <div class="composer"></div>
    </article>`;
  return `<!doctype html><html><body data-page="review-manage">
    <h1>리뷰 관리 (합성 fixture)</h1>
    ${row(TARGET_ID, 2, "포장이 찢어져서 왔어요. 다음엔 조심해 주세요 정말로요.")}
    ${row(opts.duplicateId ? TARGET_ID : OTHER_ID, 5, "빠른 배송 감사합니다. 잘 쓰고 있어요 만족합니다 정말.")}
    <script>
      window.__submitClicks = 0;
      document.querySelectorAll('article .open').forEach(function (b) {
        b.addEventListener('click', function () {
          var art = b.closest('article');
          var c = art.querySelector('.composer');
          if (c.children.length) return;
          var ta = document.createElement('textarea'); ta.setAttribute('aria-label', '답글 내용');
          var submit = document.createElement('button'); submit.type = 'button'; submit.textContent = '등록';
          submit.addEventListener('click', function () { window.__submitClicks += 1; });
          c.appendChild(ta); c.appendChild(submit);
        });
      });
    </script></body></html>`;
}

/** The page is served over loopback HTTP: `crypto.subtle` (the in-page fingerprint) exists only in a secure context. */
let html = "";
const server = http.createServer((_req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(html); });
let origin = "";
async function open(browser: Browser, body: string): Promise<Page> {
  html = body;
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: "load" });
  return page;
}

describe.skipIf(!RUN)("ladder reply driver — real DOM: the runtime opens the exact row's composer and fills it; submit stays the seller's", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
  });
  afterAll(async () => { await browser?.close(); server.close(); });

  it("locate by id → runtime press on 「답글 작성」 → one composer in that row → filled → 0 submit clicks", async () => {
    const page = await open(browser, fixture());
    const driver = new NaverLadderReplyDriver(page as unknown as LadderReplyPage, {
      hint: { rating: 2, recencyBucket: "TODAY", bodyFingerprint: "b".repeat(64) },
      asOfDate: "2026-08-28", reviewIdFingerprint: fingerprintOf(TARGET_ID), draftBody: DRAFT,
    });
    const engine = new ReplyEngine({ runId: "run_ladder_browser", channelCode: "naver",
      targetHint: { rating: 2, recencyBucket: "TODAY", bodyFingerprint: "b".repeat(64) }, composerFill: true, agentOpensComposer: true },
      { clock: makeReplyClock() });
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    expect(engine.onSurfaceReady(await driver.prepareSurface())).toBe("LOCATE_ROW");
    expect(engine.onRowLocated(await driver.locateReviewRow())).toBe("HIGHLIGHT_ROW");
    expect(engine.onRowHighlighted(await driver.highlightRow())).toBe("OPEN_COMPOSER");
    expect(driver.reviewIdVerdict()).toEqual({ kind: "MATCHED", rowIndex: 0 });

    // Before the runtime presses anything: no composer anywhere.
    expect(await page.locator("textarea").count()).toBe(0);
    expect(engine.onComposerOpened(await driver.openComposer())).toBe("LOCATE");
    // The press opened THIS row's composer and no other.
    expect(await page.locator("article:nth-of-type(1) textarea").count()).toBe(1);
    expect(await page.locator("article:nth-of-type(2) textarea").count()).toBe(0);

    expect(engine.onLocated(await driver.locateComposer())).toBe("HIGHLIGHT");
    await driver.highlight();
    expect(engine.onHighlighted()).toBe("FILL");
    expect(engine.onComposerFilled(await driver.fillComposer())).toBe("OBSERVE");
    expect(await page.locator("article:nth-of-type(1) textarea").inputValue()).toBe(DRAFT);
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN");
    expect(engine.view().currentStep?.stepNumber).toBe(3);
    expect(engine.events().some((e) => e.type === "COMPOSER_FILLED")).toBe(true);
    // The one thing the runtime never does.
    expect(await page.evaluate("window.__submitClicks")).toBe(0);

    await driver.cleanup();
    expect(await page.locator("[data-aw-reply-open-target]").count()).toBe(0);
    expect(await page.locator("[data-aw-reply-target]").count()).toBe(0);
    await page.close();
  });

  it("two rows carrying the target id: nothing is highlighted, opened or filled", async () => {
    const page = await open(browser, fixture({ duplicateId: true }));
    const driver = new NaverLadderReplyDriver(page as unknown as LadderReplyPage, {
      hint: { rating: 2, recencyBucket: "TODAY", bodyFingerprint: "b".repeat(64) },
      asOfDate: "2026-08-28", reviewIdFingerprint: fingerprintOf(TARGET_ID), draftBody: DRAFT,
    });
    // Row 2 has rating 5 and contradicts the hint → not a candidate; row 1 alone matches → exactly one.
    expect((await driver.locateReviewRow()).count).toBe(1);
    // Same id on both rows AND the same rating: ambiguity.
    html = fixture({ duplicateId: true }).replace('aria-label="5점"', 'aria-label="2점"');
    await page.goto(origin, { waitUntil: "load" });
    const twice = new NaverLadderReplyDriver(page as unknown as LadderReplyPage, {
      hint: { rating: 2, recencyBucket: "TODAY", bodyFingerprint: "b".repeat(64) },
      asOfDate: "2026-08-28", reviewIdFingerprint: fingerprintOf(TARGET_ID), draftBody: DRAFT,
    });
    expect((await twice.locateReviewRow()).count).toBe(2);
    expect(await twice.openComposer()).toEqual({ opened: false, reason: "NOT_FOUND" });
    expect(await page.locator("textarea").count()).toBe(0);
    expect(await page.evaluate("window.__submitClicks")).toBe(0);
    await page.close();
  });
});
