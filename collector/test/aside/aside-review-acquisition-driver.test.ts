/**
 * **The Aside acquisition driver** — the whole of what changes when a deterministic executor carries the
 * Coupang WING read, and therefore the whole of what has to fail closed.
 *
 * The assertions are about REFUSAL. A run that reaches rows has proven its store; every other path returns an
 * unreadable page, and the engine is told WHY in a word whose repair is real (`LOGIN_REQUIRED` /
 * `STORE_MISMATCH` / `STORE_UNRESOLVED` / `EXECUTOR_UNAVAILABLE`) rather than the seller-driven default
 * ("bring the list up and press again"), which nobody is standing at that browser to do.
 *
 * The mismatch case is the load-bearing one: the executor answers with identity AND rows in the same reply,
 * so the rows are IN HAND when the store turns out to be someone else's — and they are dropped unread.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AsideReviewAcquisitionDriver } from "../../src/aside/aside-review-acquisition-driver";
import type { ReviewExecutionResult } from "../../src/aside/coupang-review-executor";
import { wingStoreFingerprint } from "../../src/action-window/coupang-review/wing-store-identity";
import { clearLogSink, getLogSink } from "../../src/log";

const CODE = "A00123456";
const OTHER = "A00999999";
const EXPECTED = wingStoreFingerprint(CODE)!;
const WORKFLOW = { id: "coupang-wing-review-read", version: 1 };
const OBSERVED = { startedAt: "2026-09-12T00:00:00.000Z", durationMs: 1200, llmCalls: 0 };

const BUYER = "김서연";
const BODY = "배송이 빨라서 좋았습니다";

/** A page reading exactly as the repository's own reader returns it — buyer column located, never read. */
function rows(): unknown {
  return {
    reason: "OK",
    tablesScanned: 1,
    headerWidth: 7,
    excludedColumns: 1,
    unmappedColumns: 0,
    duplicateRoles: 0,
    rolesResolved: ["date", "rating", "product", "body"],
    widthMismatchRows: 0,
    rows: [{ rowIndex: 0, dateText: "2026-09-01", ratingText: "5", ratingAria: null, bodyText: BODY, bodyTruncated: false, bodyExpandable: false, productText: "15411270785 (81234567890)", productNameText: null, mediaCount: 0 }],
    pager: { found: true, resolved: true, currentPage: 1, pageNumbers: [1, 2], hasNext: true, nextEnabled: true },
  };
}

function driverOver(result: ReviewExecutionResult, expected: string | null = EXPECTED): AsideReviewAcquisitionDriver {
  return new AsideReviewAcquisitionDriver({
    executor: { execute: async () => result, workflowRef: () => WORKFLOW },
    expectedStoreFingerprint: () => expected,
  });
}

beforeEach(() => clearLogSink());

describe("Aside acquisition driver — the store gate decides whether a page is read at all", () => {
  it("MATCH: the reading reaches the walk, buyer column located and its text nowhere in the output", async () => {
    const d = driverOver({ ok: true, workflow: WORKFLOW, identity: { labelHits: 2, distinct: 1, values: [CODE] }, rows: rows(), observed: OBSERVED });
    const reading = await d.readCurrentPage();
    expect(reading.reason).toBe("OK");
    expect(reading.rows).toHaveLength(1);
    expect(reading.excludedColumns).toBe(1);
    expect(d.storeVerdict()).toBe("MATCH");
    expect(d.lastBlocker()).toBeNull();
    expect(JSON.stringify(getLogSink())).not.toContain(BUYER);
    expect(JSON.stringify(getLogSink())).not.toContain(BODY);
  });

  it("the read line carries the body evidence in counts, and a hidden body would be visible in it", async () => {
    const withBody = rows() as { rows: Record<string, unknown>[] };
    withBody.rows.push({ rowIndex: 1, dateText: "2026-09-02", ratingText: "5", ratingAria: null, bodyText: "", bodyTruncated: false, bodyExpandable: true, productText: "15411270785 (81234567890)", productNameText: null, mediaCount: 0 });
    const d = driverOver({ ok: true, workflow: WORKFLOW, identity: { labelHits: 2, distinct: 1, values: [CODE] }, rows: withBody, observed: OBSERVED });
    await d.readCurrentPage();
    const line = getLogSink().find((e) => e.event === "aw_coupang_review_aside_read")!;
    expect(line.meta).toMatchObject({ rows: 2, textless: 1, bodyExpandable: 1, textlessExpandable: 1 });
    expect(line.meta).toMatchObject({ pagerPages: 2, pagerHasNext: true });
    expect(JSON.stringify(getLogSink())).not.toContain(BODY);
  });

  it("MISMATCH: the rows are in hand and are dropped unread", async () => {
    const d = driverOver({ ok: true, workflow: WORKFLOW, identity: { labelHits: 2, distinct: 1, values: [OTHER] }, rows: rows(), observed: OBSERVED });
    const reading = await d.readCurrentPage();
    expect(reading.rows).toEqual([]);
    expect(reading.reason).toBe("UNREADABLE");
    expect(d.lastBlocker()).toBe("STORE_MISMATCH");
    expect(JSON.stringify(getLogSink())).not.toContain(BODY);
  });

  it("two disagreeing codes, and no expectation at all, are both UNRESOLVED — never MATCH", async () => {
    const ambiguous = driverOver({ ok: true, workflow: WORKFLOW, identity: { labelHits: 2, distinct: 2, values: [CODE, OTHER] }, rows: rows(), observed: OBSERVED });
    await ambiguous.readCurrentPage();
    expect(ambiguous.lastBlocker()).toBe("STORE_UNRESOLVED");

    const unbound = driverOver({ ok: true, workflow: WORKFLOW, identity: { labelHits: 2, distinct: 1, values: [CODE] }, rows: rows(), observed: OBSERVED }, null);
    const reading = await unbound.readCurrentPage();
    expect(reading.rows).toEqual([]);
    expect(unbound.lastBlocker()).toBe("STORE_UNRESOLVED");
  });

  it("never logs the vendor code or the expected digest", async () => {
    const d = driverOver({ ok: true, workflow: WORKFLOW, identity: { labelHits: 2, distinct: 1, values: [OTHER] }, rows: rows(), observed: OBSERVED });
    await d.readCurrentPage();
    const text = JSON.stringify(getLogSink());
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(OTHER);
    expect(text).not.toContain(EXPECTED);
  });
});

describe("Aside acquisition driver — executor failures keep their own words", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["AUTH_REQUIRED", "LOGIN_REQUIRED"],
    ["PROVIDER_UNAVAILABLE", "EXECUTOR_UNAVAILABLE"],
    ["PROVIDER_TIMEOUT", "EXECUTOR_UNAVAILABLE"],
    ["UNSUPPORTED_STATE", "UNSUPPORTED_STATE"],
    ["RUNTIME_FAULT", "RUNTIME_FAULT"],
  ];
  it.each(cases)("%s → %s, with no rows", async (code, blocker) => {
    const d = driverOver({ ok: false, workflow: WORKFLOW, failure: { code: code as never, stage: "EXECUTOR", recoverable: true }, observed: OBSERVED });
    const reading = await d.readCurrentPage();
    expect(reading.rows).toEqual([]);
    expect(d.lastBlocker()).toBe(blocker);
  });

  it("a blocker does not survive into the next read", async () => {
    const d = driverOver({ ok: false, workflow: WORKFLOW, failure: { code: "AUTH_REQUIRED", stage: "AUTH", recoverable: true }, observed: OBSERVED });
    await d.readCurrentPage();
    expect(d.lastBlocker()).toBe("LOGIN_REQUIRED");
    await d.cleanup();
    expect(d.lastBlocker()).toBeNull();
  });
});
