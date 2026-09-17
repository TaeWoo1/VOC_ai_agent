/**
 * **The NAVER Seller Center review recipe can only open the one review route, can only read, and can only report
 * what it read and the backend accepted.**
 *
 * Symmetric with `fixture-observe-guard.test.ts` and `coupang-observe-guard.test.ts`. Three properties:
 *
 *  1. **the target is closed** — exactly `https://sell.smartstore.naver.com/#/review/search`, parsed, nothing else;
 *  2. **the program only reads** — run over the REAL program text in an empty VM whose tab has no verb but
 *     `evaluate`, it opens one tab, evaluates only the plan's scripts, and closes the tab;
 *  3. **«확인하지 못함» never becomes «0건»** — sign-in wall, unsettled grid, stale period, a row outside it, an
 *     undelivered reading, and an unproven store all report a failure token with no count.
 */
import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  NAVER_REVIEW_LIST_URL,
  NAVER_REVIEW_READ_WORKFLOW,
  screenNaverReviewUrl,
  validateNaverReviewWorkflow,
} from "../../src/aside/naver-review-workflow";
import {
  buildNaverReviewRuntimePlan,
  buildNaverReviewRuntimeProgram,
  parseNaverReviewRuntimeResult,
} from "../../src/aside/naver-review-executor";
import {
  digestOfReviewIds,
  NAVER_REVIEW_OBSERVE_RECIPE_ID,
  runNaverReviewObservation,
  sanitizeNaverReading,
  type NaverDeliveryRequest,
  type NaverDeliveryResponse,
} from "../../src/aside/naver-review-observe-runner";
import {
  buildNaverReviewAuthScript,
  buildNaverReviewListReadScript,
} from "../../src/naver/review-list-observe-inpage";

const NOW = new Date("2026-09-17T03:00:00.000Z"); // 12:00 KST

function row(over: Record<string, unknown> = {}) {
  return {
    reviewId: "5066448224",
    createdAt: "2026-09-16T10:00:00.000+09:00",
    rating: 5,
    body: "잘 받았습니다",
    productNo: "1234567890",
    productName: "상품",
    answered: false,
    attachCount: 1,
    ...over,
  };
}

function reading(rows: unknown[]) {
  return { reason: "OK", modelType: "infinite", rowCount: rows.length, loaded: rows.length, rows };
}

const CURRENT_WEEK = { dateInputCount: 2, valuesParsed: 2, startDaysBefore: 6, endDaysBefore: 0, pagerNumberCount: 0, highestPagerNumber: 0 };

function executorOf(result: unknown) {
  return {
    execute: vi.fn(async () => ({ kind: "RESULT" as const, result: result as never, llmCalls: 0 as const })),
    asOf: () => NOW,
  };
}

function deliverWith(response: NaverDeliveryResponse | null) {
  return vi.fn(async (_request: NaverDeliveryRequest) => response);
}

const MATCH: NaverDeliveryResponse = { identityVerdict: "MATCH", received: 1, inserted: 1, changed: 0, skipped: 0, failed: 0 };

describe("the NAVER review recipe — the target is closed", () => {
  it("publishes exactly one route, and it passes its own screen", () => {
    expect(NAVER_REVIEW_OBSERVE_RECIPE_ID).toBe("NAVER_REVIEW_OBSERVE_V1");
    expect(NAVER_REVIEW_LIST_URL).toBe("https://sell.smartstore.naver.com/#/review/search");
    expect(validateNaverReviewWorkflow(NAVER_REVIEW_READ_WORKFLOW)).toEqual([]);
  });

  it.each([
    "http://sell.smartstore.naver.com/#/review/search",
    "https://sell.smartstore.naver.com/#/review/search?x=1",
    "https://sell.smartstore.naver.com/?q=1#/review/search",
    "https://sell.smartstore.naver.com:8443/#/review/search",
    "https://user@sell.smartstore.naver.com/#/review/search",
    "https://sell.smartstore.naver.com.evil.example/#/review/search",
    "https://evil.example/#/review/search",
    "https://sell.smartstore.naver.com/#/review/reply",
    "https://sell.smartstore.naver.com/#/home/dashboard",
    "https://wing.coupang.com/tenants/cs/product/review",
    "http://127.0.0.1:47615/fixture/customer-operations",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (url) => {
    expect(screenNaverReviewUrl(url)).toBe(false);
    expect(validateNaverReviewWorkflow({ ...NAVER_REVIEW_READ_WORKFLOW, entryUrl: url })).toContain("ENTRY_NOT_REVIEW_ROUTE");
  });
});

describe("the NAVER review recipe — the page scripts never read the buyer", () => {
  it("names no buyer or order field", () => {
    const scripts = buildNaverReviewAuthScript() + buildNaverReviewListReadScript();
    for (const field of ["maskedWriterId", "writerIdNo", "writerId", "productOrderNo", "Object.keys", "..."]) {
      expect(scripts, field).not.toContain(field);
    }
  });

  it("performs no action on the page", () => {
    const scripts = buildNaverReviewAuthScript() + buildNaverReviewListReadScript();
    for (const token of [".click(", ".focus(", ".submit(", "dispatchEvent", "scrollTo", "scrollTop =", ".value =", "location.href =", "fetch(", "XMLHttpRequest"]) {
      expect(scripts, token).not.toContain(token);
    }
  });
});

describe("the NAVER review recipe — the serialized program only reads", () => {
  function run(tab: Record<string, unknown>) {
    const plan = buildNaverReviewRuntimePlan({ ...NAVER_REVIEW_READ_WORKFLOW, settleTimeoutMs: 2_000 }, NOW);
    const program = buildNaverReviewRuntimeProgram({ ...plan, pollMs: 1 });
    const body = program.replace(/console\.log\("ASIDE_RESULT " \+ JSON\.stringify\(__result\)\);$/, "return __result;");
    const calls: string[] = [];
    const sandbox = {
      openTab: async (url: string) => { calls.push(`open:${url}`); return tab; },
      closeTab: async () => void calls.push("close"),
      setTimeout,
      Date,
      JSON,
      Promise,
    };
    return { calls, plan, result: runInNewContext(`(async () => { ${body} })()`, sandbox) as Promise<unknown> };
  }

  it("a signed-out browser: one tab, no row read, tab closed, AUTH_REQUIRED", async () => {
    const evaluated: string[] = [];
    const { calls, plan, result } = run({
      evaluate: async (script: string) => { evaluated.push(script); return { signedIn: false }; },
    });
    const parsed = parseNaverReviewRuntimeResult(await result);
    expect(parsed).toMatchObject({ ok: false, code: "AUTH_REQUIRED", stage: "AUTH" });
    expect(calls).toEqual([`open:${NAVER_REVIEW_LIST_URL}`, "close"]);
    expect(evaluated.every((s) => s === plan.authScript)).toBe(true);
  });

  it("a signed-in page: waits for two agreeing readings, reads the period, evaluates only plan scripts", async () => {
    const evaluated: string[] = [];
    const { calls, plan, result } = run({
      evaluate: async (script: string) => {
        evaluated.push(script);
        if (script === plan.authScript) return { signedIn: true };
        if (script === plan.rangeScript) return CURRENT_WEEK;
        return reading([row()]);
      },
    });
    const parsed = parseNaverReviewRuntimeResult(await result);
    expect(parsed).toMatchObject({ ok: true });
    expect(calls).toEqual([`open:${NAVER_REVIEW_LIST_URL}`, "close"]);
    expect(evaluated.filter((s) => s === plan.readerScript)).toHaveLength(2);
    expect(evaluated.every((s) => s === plan.authScript || s === plan.readerScript || s === plan.rangeScript)).toBe(true);
  });

  it("a page whose meaning moved stops at once — it is not waited out", async () => {
    const { plan, result } = run({
      evaluate: async (script: string) =>
        script === plan.authScript ? { signedIn: true } : { reason: "ID_LINK_MISMATCH", rows: [] },
    });
    expect(parseNaverReviewRuntimeResult(await result)).toMatchObject({ ok: false, code: "UNSUPPORTED_STATE", reason: "ID_LINK_MISMATCH" });
  });
});

describe("the NAVER review recipe — nothing read is never nothing there", () => {
  it("sign-in wall → AUTH_REQUIRED, no count, nothing delivered", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverReviewObservation({
      deliver,
      executor: executorOf({ ok: false, code: "AUTH_REQUIRED", stage: "AUTH", reason: null, elapsedMs: 1 }),
    });
    expect(r).toEqual({ outcome: "AUTH_REQUIRED", observedCount: null, contentDigest: null });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("an unsettled grid is unreadable, not empty", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverReviewObservation({
      deliver,
      executor: executorOf({ ok: false, code: "READ_UNSETTLED", stage: "READ", reason: "GRID_NOT_FOUND", elapsedMs: 1 }),
    });
    expect(r).toEqual({ outcome: "SURFACE_UNREADABLE", observedCount: null, contentDigest: null });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("a period that does not end today states no coverage, so nothing is delivered", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverReviewObservation({
      deliver,
      executor: executorOf({ ok: true, reading: reading([row()]), range: { ...CURRENT_WEEK, endDaysBefore: 3 }, elapsedMs: 1 }),
    });
    expect(r.outcome).toBe("SURFACE_UNREADABLE");
    expect(r.observedCount).toBeNull();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("a row outside the period means the grid and the period disagree", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverReviewObservation({
      deliver,
      executor: executorOf({ ok: true, reading: reading([row({ createdAt: "2026-08-01T10:00:00.000+09:00" })]), range: CURRENT_WEEK, elapsedMs: 1 }),
    });
    expect(r.outcome).toBe("SURFACE_UNREADABLE");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("a reading that did not land carries no count", async () => {
    const r = await runNaverReviewObservation({
      deliver: deliverWith(null),
      executor: executorOf({ ok: true, reading: reading([row()]), range: CURRENT_WEEK, elapsedMs: 1 }),
    });
    expect(r).toEqual({ outcome: "EXECUTOR_UNAVAILABLE", observedCount: null, contentDigest: null });
  });

  it("a store the backend could not prove stores nothing and reports no count", async () => {
    const r = await runNaverReviewObservation({
      deliver: deliverWith({ ...MATCH, identityVerdict: "UNRESOLVED", inserted: 0 }),
      executor: executorOf({ ok: true, reading: reading([row()]), range: CURRENT_WEEK, elapsedMs: 1 }),
    });
    expect(r).toEqual({ outcome: "STORE_UNRESOLVED", observedCount: null, contentDigest: null });
  });

  it("a proved read reports what it read, with an id digest, and delivers only the eight named fields", async () => {
    const deliver = deliverWith(MATCH);
    const pageRow = { ...row(), maskedWriterId: "abc***", writerIdNo: "12345", productOrderNo: "2026091700000001" };
    const r = await runNaverReviewObservation({
      deliver,
      executor: executorOf({ ok: true, reading: reading([pageRow]), range: CURRENT_WEEK, elapsedMs: 1 }),
    });
    expect(r.outcome).toBe("OBSERVED");
    expect(r.observedCount).toBe(1);
    expect(r.contentDigest).toBe(digestOfReviewIds([row() as never]));
    const sent = deliver.mock.calls[0]![0];
    expect(sent.windowDays).toBe(7);
    expect(Object.keys(sent.reviews[0]!).sort()).toEqual(
      ["answered", "attachCount", "body", "createdAt", "productName", "productNo", "rating", "reviewId"],
    );
    expect(JSON.stringify(sent)).not.toMatch(/abc\*\*\*|12345"|2026091700000001/);
  });

  it("refuses every row shape it does not fully understand", () => {
    for (const bad of [
      row({ reviewId: "123" }),
      row({ reviewId: 5066448224 }),
      row({ rating: 0 }),
      row({ rating: 4.5 }),
      row({ createdAt: "yesterday" }),
      row({ productNo: "abc" }),
      row({ answered: "N" }),
      row({ attachCount: -1 }),
    ]) {
      expect(sanitizeNaverReading(reading([bad])).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(sanitizeNaverReading(reading([row(), row()])).ok).toBe(false); // duplicate id
    expect(sanitizeNaverReading({ ...reading([row()]), rowCount: 2 }).ok).toBe(false);
    expect(sanitizeNaverReading({ reason: "ROWS_NOT_LOADED", rows: [] }).ok).toBe(false);
  });
});
