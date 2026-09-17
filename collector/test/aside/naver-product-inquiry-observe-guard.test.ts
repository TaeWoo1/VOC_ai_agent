/**
 * **The NAVER Seller Center 상품 문의 recipe can only open the one inquiry route, can only read, and can only report what
 * it read and the backend accepted.**
 *
 * Symmetric with `naver-review-observe-guard.test.ts`. Four properties:
 *
 *  1. **the target is closed** — exactly `https://sell.smartstore.naver.com/#/comment/`, parsed, nothing else;
 *  2. **the reader reads the controller, checks it against what is drawn, and never reads the buyer** — run over the
 *     REAL page script in a VM whose page object carries the buyer's masked id, member number and audit IP;
 *  3. **the program only reads** — the SAME frozen runtime as the review recipe, fed this recipe's plan, opens one tab,
 *     evaluates only plan scripts, closes the tab;
 *  4. **«확인하지 못함» never becomes «0건»** — sign-in wall, unsettled list, stale period, undelivered reading and
 *     unproven store all report a failure token with no count.
 */
import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  NAVER_PRODUCT_INQUIRY_LIST_URL,
  NAVER_PRODUCT_INQUIRY_READ_WORKFLOW,
  screenNaverProductInquiryUrl,
  validateNaverProductInquiryWorkflow,
} from "../../src/aside/naver-product-inquiry-workflow";
import { buildNaverProductInquiryRuntimePlan } from "../../src/aside/naver-product-inquiry-executor";
import { buildNaverReviewRuntimeProgram, parseNaverReviewRuntimeResult } from "../../src/aside/naver-review-executor";
import {
  digestOfQuestionIds,
  NAVER_PRODUCT_INQUIRY_OBSERVE_RECIPE_ID,
  runNaverProductInquiryObservation,
  sanitizeNaverInquiryReading,
  type NaverInquiryDeliveryRequest,
  type NaverInquiryDeliveryResponse,
} from "../../src/aside/naver-product-inquiry-observe-runner";
import {
  buildNaverProductInquiryListReadScript,
  buildNaverProductInquiryWindowScript,
} from "../../src/naver/product-inquiry-list-observe-inpage";
import { runFixtureObserveCycle } from "../../src/aside/fixture-observe-runner";

const NOW = new Date("2026-09-17T03:00:00.000Z"); // 12:00 KST

function row(over: Record<string, unknown> = {}) {
  return {
    questionId: "689162087",
    createdAt: "2026-09-17T01:52:31.332+00:00",
    body: "몇 가닥까지 들어가나요?",
    answered: false,
    secret: true,
    channelProductNo: "13250364547",
    ...over,
  };
}

function reading(rows: unknown[], over: Record<string, unknown> = {}) {
  return {
    reason: "OK", rowCount: rows.length, loaded: rows.length, pageIndex: 0, pageSize: 8, totalCount: rows.length,
    windowStart: "2026-06-18", windowEnd: "2026-09-17", linkChecked: rows.length, rows, ...over,
  };
}

const WINDOW = { windowStart: "2026-06-18", windowEnd: "2026-09-17" };

function executorOf(result: unknown) {
  return {
    execute: vi.fn(async () => ({ kind: "RESULT" as const, result: result as never, llmCalls: 0 as const })),
    asOf: () => NOW,
  };
}

function deliverWith(response: NaverInquiryDeliveryResponse | null) {
  return vi.fn(async (_request: NaverInquiryDeliveryRequest) => response);
}

const MATCH: NaverInquiryDeliveryResponse = {
  identityVerdict: "MATCH", coverage: "BOUNDED", received: 1, inserted: 1, changed: 0, skipped: 0, failed: 0,
};

describe("the NAVER product inquiry recipe — the target is closed", () => {
  it("publishes exactly one route, and it passes its own screen", () => {
    expect(NAVER_PRODUCT_INQUIRY_OBSERVE_RECIPE_ID).toBe("NAVER_PRODUCT_INQUIRY_OBSERVE_V1");
    expect(NAVER_PRODUCT_INQUIRY_LIST_URL).toBe("https://sell.smartstore.naver.com/#/comment/");
    expect(validateNaverProductInquiryWorkflow(NAVER_PRODUCT_INQUIRY_READ_WORKFLOW)).toEqual([]);
  });

  it.each([
    "http://sell.smartstore.naver.com/#/comment/",
    "https://sell.smartstore.naver.com/#/comment/?x=1",
    "https://sell.smartstore.naver.com/#/comment",
    "https://sell.smartstore.naver.com/?q=1#/comment/",
    "https://sell.smartstore.naver.com:8443/#/comment/",
    "https://user@sell.smartstore.naver.com/#/comment/",
    "https://sell.smartstore.naver.com.evil.example/#/comment/",
    "https://sell.smartstore.naver.com/#/naverpay/qnas",
    "https://sell.smartstore.naver.com/#/review/search",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (url) => {
    expect(screenNaverProductInquiryUrl(url)).toBe(false);
    expect(validateNaverProductInquiryWorkflow({ ...NAVER_PRODUCT_INQUIRY_READ_WORKFLOW, entryUrl: url }))
      .toContain("ENTRY_NOT_INQUIRY_ROUTE");
  });
});

/** A page object as the discovery measured it — including the fields the reader must never read out. */
function pageComment(over: Record<string, unknown> = {}) {
  return {
    id: 689162087,
    regDate: "2026-09-17T01:52:31.332+00:00",
    modDate: "2026-09-17T01:52:31.332+00:00",
    commentContent: "몇 가닥까지 들어가나요?",
    sellerAnswer: false,
    secret: true,
    channelProductNo: 13250364547,
    productNo: 13196612345,
    commentType: "PRODUCT_INQUIRY",
    contentsStatusType: "NORMAL",
    maskedWriterId: "abc***",
    writerIdNo: "98765",
    regAuditInfo: { ip: "203.0.113.7", memberType: "BUYER" },
    ...over,
  };
}

function runReader(opts: {
  hash?: string;
  list?: Record<string, unknown>[];
  hrefs?: string[][];
  loading?: boolean;
  total?: number;
  angular?: boolean;
}) {
  const list = opts.list ?? [pageComment()];
  const hrefs = opts.hrefs ?? list.map((c) => [`https://smartstore.naver.com/main/products/${c["channelProductNo"]}`]);
  const vm = {
    isLoading: opts.loading ?? false,
    commentList: list,
    pageInfo: { page: 0, size: 8, range: 5, totalCount: opts.total ?? list.length },
    searchFormData: { startDate: "2026-06-18T00:00:00.000+09:00", endDate: "2026-09-17T23:59:59.999+09:00" },
  };
  const anchor = { anchor: true };
  const rendered = hrefs.map((hs) => ({
    querySelectorAll: () => hs.map((h) => ({ getAttribute: () => h })),
  }));
  const document = {
    querySelector: (sel: string) => (sel.includes("searchFormData.commentType") ? anchor : null),
    querySelectorAll: (sel: string) => (sel.includes("vm.commentList") ? rendered : []),
  };
  const window = opts.angular === false ? {} : { angular: { element: () => ({ controller: () => vm }) } };
  const sandbox = { location: { host: "sell.smartstore.naver.com", hash: opts.hash ?? "#/comment/" }, document, window };
  return runInNewContext(buildNaverProductInquiryListReadScript(), sandbox) as Record<string, unknown>;
}

describe("the NAVER product inquiry recipe — the page script", () => {
  it("reads six named fields from the controller and never the buyer", () => {
    const r = runReader({});
    expect(r["reason"]).toBe("OK");
    expect(r).toMatchObject({ rowCount: 1, loaded: 1, pageIndex: 0, pageSize: 8, totalCount: 1, windowStart: "2026-06-18", windowEnd: "2026-09-17", linkChecked: 1 });
    const rows = r["rows"] as Record<string, unknown>[];
    expect(Object.keys(rows[0]!).sort()).toEqual(["answered", "body", "channelProductNo", "createdAt", "questionId", "secret"]);
    expect(rows[0]).toMatchObject({ questionId: "689162087", channelProductNo: "13250364547" });
    expect(JSON.stringify(r)).not.toMatch(/abc\*\*\*|98765|203\.0\.113\.7|13196612345/);
    const script = buildNaverProductInquiryListReadScript() + buildNaverProductInquiryWindowScript();
    for (const field of ["maskedWriterId", "writerIdNo", "regAuditInfo", "storeName", "sellerNo", "Object.keys", "..."]) {
      expect(script, field).not.toContain(field);
    }
  });

  it("performs no action on the page and never pages", () => {
    const script = buildNaverProductInquiryListReadScript() + buildNaverProductInquiryWindowScript();
    for (const token of [".click(", ".focus(", ".submit(", "dispatchEvent", "scrollTo", "scrollTop =", ".value =",
      "location.href =", "fetch(", "XMLHttpRequest", "queryPage", "replyShow", "confirmOrder", "report("]) {
      expect(script, token).not.toContain(token);
    }
  });

  it("fails closed when the page is not the one measured", () => {
    expect(runReader({ hash: "#/review/search" })["reason"]).toBe("ROUTE_MISMATCH");
    expect(runReader({ angular: false })["reason"]).toBe("GRID_NOT_FOUND");
    expect(runReader({ loading: true })["reason"]).toBe("MODEL_UNREADABLE");
    expect(runReader({ hrefs: [] })["reason"]).toBe("ROWS_NOT_LOADED");
    expect(runReader({ hrefs: [["https://smartstore.naver.com/main/products/999"]] })["reason"]).toBe("ID_LINK_MISMATCH");
    expect(runReader({ hrefs: [["https://smartstore.naver.com/"]] })["reason"]).toBe("ID_LINK_MISMATCH");
    expect(runReader({ list: [pageComment({ commentType: "OTHER" })] })["reason"]).toBe("MODEL_SHAPE_CHANGED");
    expect(runReader({ list: [pageComment({ contentsStatusType: "BLIND" })] })["reason"]).toBe("MODEL_SHAPE_CHANGED");
    expect(runReader({ list: [pageComment({ sellerAnswer: "N" })] })["reason"]).toBe("MODEL_SHAPE_CHANGED");
    const empty = runReader({ list: [], hrefs: [] });
    expect(empty).toMatchObject({ reason: "OK", rowCount: 0, loaded: 0, totalCount: 0 });
  });
});

describe("the NAVER product inquiry recipe — the serialized program only reads", () => {
  function run(tab: Record<string, unknown>) {
    const plan = buildNaverProductInquiryRuntimePlan({ ...NAVER_PRODUCT_INQUIRY_READ_WORKFLOW, settleTimeoutMs: 2_000 });
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
    expect(parseNaverReviewRuntimeResult(await result)).toMatchObject({ ok: false, code: "AUTH_REQUIRED", stage: "AUTH" });
    expect(calls).toEqual([`open:${NAVER_PRODUCT_INQUIRY_LIST_URL}`, "close"]);
    expect(evaluated.every((s) => s === plan.authScript)).toBe(true);
  });

  it("a signed-in page: two agreeing readings, the period, only plan scripts, one tab", async () => {
    const evaluated: string[] = [];
    const { calls, plan, result } = run({
      evaluate: async (script: string) => {
        evaluated.push(script);
        if (script === plan.authScript) return { signedIn: true };
        if (script === plan.rangeScript) return WINDOW;
        return reading([row()]);
      },
    });
    expect(parseNaverReviewRuntimeResult(await result)).toMatchObject({ ok: true });
    expect(calls).toEqual([`open:${NAVER_PRODUCT_INQUIRY_LIST_URL}`, "close"]);
    expect(evaluated.filter((s) => s === plan.readerScript)).toHaveLength(2);
    expect(evaluated.every((s) => s === plan.authScript || s === plan.readerScript || s === plan.rangeScript)).toBe(true);
  });

  it("a list whose rows no longer line up with the model stops at once", async () => {
    const { plan, result } = run({
      evaluate: async (script: string) =>
        script === plan.authScript ? { signedIn: true } : { reason: "ID_LINK_MISMATCH", rows: [] },
    });
    expect(parseNaverReviewRuntimeResult(await result)).toMatchObject({ ok: false, code: "UNSUPPORTED_STATE", reason: "ID_LINK_MISMATCH" });
  });
});

describe("the NAVER product inquiry recipe — nothing read is never nothing there", () => {
  it("sign-in wall → AUTH_REQUIRED, no count, nothing delivered", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverProductInquiryObservation({
      deliver,
      executor: executorOf({ ok: false, code: "AUTH_REQUIRED", stage: "AUTH", reason: null, elapsedMs: 1 }),
    });
    expect(r).toEqual({ outcome: "AUTH_REQUIRED", observedCount: null, contentDigest: null });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("an unsettled list is unreadable, not empty", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverProductInquiryObservation({
      deliver,
      executor: executorOf({ ok: false, code: "READ_UNSETTLED", stage: "READ", reason: "MODEL_UNREADABLE", elapsedMs: 1 }),
    });
    expect(r).toEqual({ outcome: "SURFACE_UNREADABLE", observedCount: null, contentDigest: null });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("a period that does not end today, or moved between readings, states no coverage", async () => {
    for (const range of [{ ...WINDOW, windowEnd: "2026-09-16" }, { windowStart: "2026-06-19", windowEnd: "2026-09-17" }, null]) {
      const deliver = deliverWith(MATCH);
      const stale = range && range.windowEnd === "2026-09-16";
      const r = await runNaverProductInquiryObservation({
        deliver,
        executor: executorOf({ ok: true, reading: reading([row()], stale ? { windowEnd: "2026-09-16" } : {}), range, elapsedMs: 1 }),
      });
      expect(r.outcome, JSON.stringify(range)).toBe("SURFACE_UNREADABLE");
      expect(deliver).not.toHaveBeenCalled();
    }
  });

  it("a row outside the period means the list and the period disagree", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverProductInquiryObservation({
      deliver,
      executor: executorOf({ ok: true, reading: reading([row({ createdAt: "2026-05-01T01:00:00.000+00:00" })]), range: WINDOW, elapsedMs: 1 }),
    });
    expect(r.outcome).toBe("SURFACE_UNREADABLE");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("a reading that did not land, or a store not proved, carries no count", async () => {
    expect(await runNaverProductInquiryObservation({
      deliver: deliverWith(null),
      executor: executorOf({ ok: true, reading: reading([row()]), range: WINDOW, elapsedMs: 1 }),
    })).toEqual({ outcome: "EXECUTOR_UNAVAILABLE", observedCount: null, contentDigest: null });
    expect(await runNaverProductInquiryObservation({
      deliver: deliverWith({ ...MATCH, identityVerdict: "UNRESOLVED", coverage: null, inserted: 0 }),
      executor: executorOf({ ok: true, reading: reading([row()]), range: WINDOW, elapsedMs: 1 }),
    })).toEqual({ outcome: "STORE_UNRESOLVED", observedCount: null, contentDigest: null });
  });

  it("a proved read reports what it read with an id digest, and delivers only the page facts and six named fields", async () => {
    const deliver = deliverWith(MATCH);
    const r = await runNaverProductInquiryObservation({
      deliver,
      executor: executorOf({ ok: true, reading: reading([{ ...row(), maskedWriterId: "abc***" }], { totalCount: 11, pageSize: 1 }), range: WINDOW, elapsedMs: 1 }),
    });
    expect(r.outcome).toBe("OBSERVED");
    expect(r.observedCount).toBe(1);
    expect(r.contentDigest).toBe(digestOfQuestionIds([row() as never]));
    const sent = deliver.mock.calls[0]![0];
    expect(Object.keys(sent).sort()).toEqual(["inquiries", "pageSize", "totalCount", "windowEnd", "windowStart"]);
    expect(sent.totalCount).toBe(11);
    expect(Object.keys(sent.inquiries[0]!).sort()).toEqual(["answered", "body", "channelProductNo", "createdAt", "questionId", "secret"]);
    expect(JSON.stringify(sent)).not.toContain("abc***");
  });

  it("refuses every reading it does not fully understand", () => {
    for (const bad of [
      row({ questionId: "0123" }),
      row({ questionId: 689162087 }),
      row({ createdAt: "yesterday" }),
      row({ channelProductNo: "abc" }),
      row({ answered: "N" }),
      row({ secret: null }),
    ]) {
      expect(sanitizeNaverInquiryReading(reading([bad])).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(sanitizeNaverInquiryReading(reading([row(), row()])).ok).toBe(false); // duplicate id
    expect(sanitizeNaverInquiryReading(reading([row({ questionId: "1", createdAt: "2026-09-01T00:00:00Z" }), row()])).ok).toBe(false); // not newest-first
    expect(sanitizeNaverInquiryReading(reading([row()], { pageIndex: 1 })).ok).toBe(false);
    expect(sanitizeNaverInquiryReading(reading([row()], { totalCount: 11 })).ok).toBe(false); // short first page of a longer period
    expect(sanitizeNaverInquiryReading(reading([row()], { linkChecked: 0 })).ok).toBe(false);
    expect(sanitizeNaverInquiryReading({ reason: "ROWS_NOT_LOADED", rows: [] }).ok).toBe(false);
  });
});

describe("the NAVER product inquiry recipe — the helper's own no", () => {
  it("a helper without the lane refuses the recipe without opening anything", async () => {
    const posts: string[] = [];
    const run = vi.fn();
    const fetchImpl = (async (url: string) => {
      posts.push(String(url));
      if (String(url).endsWith("/claim")) {
        return new Response(JSON.stringify({ jobId: "j1", recipe: "NAVER_PRODUCT_INQUIRY_OBSERVE_V1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await runFixtureObserveCycle({
      baseUrl: "http://127.0.0.1:1", token: "t", bridgePort: 1, fetchImpl, runNaverProductInquiry: run,
    });
    expect(r).toEqual({ kind: "REPORTED", outcome: "REFUSED", observedCount: null });
    expect(run).not.toHaveBeenCalled();
    expect(posts.some((p) => p.includes("naver-product-inquiries"))).toBe(false);
  });

  it("a helper with the lane routes the job to the inquiry runner and delivers to this job only", async () => {
    const posts: string[] = [];
    const fetchImpl = (async (url: string) => {
      posts.push(String(url));
      if (String(url).endsWith("/claim")) {
        return new Response(JSON.stringify({ jobId: "j1", recipe: "NAVER_PRODUCT_INQUIRY_OBSERVE_V1" }), { status: 200 });
      }
      if (String(url).endsWith("/naver-product-inquiries")) return new Response(JSON.stringify(MATCH), { status: 200 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const run = vi.fn(async (deps: { deliver: (r: NaverInquiryDeliveryRequest) => Promise<NaverInquiryDeliveryResponse | null> }) => {
      const d = await deps.deliver({ inquiries: [row()], pageSize: 8, totalCount: 1, ...WINDOW });
      expect(d?.coverage).toBe("BOUNDED");
      return { outcome: "OBSERVED" as const, observedCount: 1, contentDigest: "c".repeat(64) };
    });
    const r = await runFixtureObserveCycle({
      baseUrl: "http://127.0.0.1:1", token: "t", bridgePort: 1, fetchImpl, naverProductInquiryLane: true,
      runNaverProductInquiry: run as never,
    });
    expect(r).toEqual({ kind: "REPORTED", outcome: "OBSERVED", observedCount: 1 });
    expect(posts).toContain("http://127.0.0.1:1/api/helper-devices/jobs/j1/naver-product-inquiries");
  });
});
