/**
 * **The marketplace recipe can only ever be pointed at WING, and can only ever report what it actually read.**
 *
 * The sibling `fixture-observe-guard.test.ts` states this for the loopback recipe. This file states it for the
 * one recipe that reads a real store, and the two halves are deliberately symmetric: each name resolves to its
 * own bound route, each route is screened by its own screen, and neither screen admits the other's target.
 *
 * Two properties are asserted here and nowhere else:
 *
 *  1. **the target is closed** — the bound route passes the product's WING classifier, and every non-WING host
 *     (including this helper's OWN loopback surface) is refused before a tab opens;
 *  2. **«확인하지 못함» never becomes «0건»** — a signed-out browser, an unproven store, a shape we could not
 *     parse and a reading that could not be delivered all report a failure token with a null count. The ONLY
 *     zero this lane can produce is a list the reader read and found empty.
 */
import { describe, expect, it, vi } from "vitest";
import {
  COUPANG_REVIEW_READ_WORKFLOW,
  COUPANG_WING_REVIEW_LIST_URL,
  validateCoupangReviewWorkflow,
} from "../../src/aside/coupang-review-workflow";
import {
  COUPANG_REVIEW_OBSERVE_RECIPE_ID,
  runCoupangReviewObservation,
} from "../../src/aside/coupang-observe-runner";
import { wingStoreFingerprint } from "../../src/action-window/coupang-review/wing-store-identity";
import type {
  ReviewHandoffRequest,
  ReviewHandoffResponse,
} from "../../src/action-window/coupang-review/review-handoff-client";

const STORE = "A00123456";
const EXPECTED = wingStoreFingerprint(STORE)!;

/** A successful executor answer. `identity`/`rows` are raw page output; the runner sanitizes both. */
function observed(rows: unknown, values: readonly string[] = [STORE]) {
  return {
    ok: true as const,
    workflow: { id: COUPANG_REVIEW_READ_WORKFLOW.id, version: 1 },
    identity: { values, labelHits: values.length },
    rows,
    observed: { startedAt: "2026-09-17T00:00:00.000Z", durationMs: 12, llmCalls: 0 },
  };
}

function failed(code: string, stage = "AUTH") {
  return {
    ok: false as const,
    workflow: { id: COUPANG_REVIEW_READ_WORKFLOW.id, version: 1 },
    failure: { code, stage, recoverable: true },
    observed: { startedAt: "2026-09-17T00:00:00.000Z", durationMs: 12, llmCalls: 0 },
  };
}

function executorOf(result: unknown) {
  return {
    execute: vi.fn(async () => result as never),
    workflowRef: () => ({ id: COUPANG_REVIEW_READ_WORKFLOW.id, version: 1 }),
  };
}

const handoffOk = () =>
  vi.fn(async (_request: ReviewHandoffRequest): Promise<ReviewHandoffResponse> => ({
    ok: true, received: 0, stored: 0, skipped: 0, failed: 0, unlinked: 0, reason: null,
  }));

describe("the marketplace recipe — the target is closed", () => {
  it("the bound route is WING, and it is the one this recipe publishes", () => {
    expect(validateCoupangReviewWorkflow(COUPANG_REVIEW_READ_WORKFLOW)).toEqual([]);
    expect(COUPANG_REVIEW_READ_WORKFLOW.entryUrl).toBe(COUPANG_WING_REVIEW_LIST_URL);
    expect(COUPANG_REVIEW_OBSERVE_RECIPE_ID).toBe("COUPANG_REVIEW_OBSERVE_V1");
  });

  it.each([
    "http://127.0.0.1:47615/fixture/customer-operations",
    "https://sell.smartstore.naver.com/#/home/dashboard",
    "https://example.cafe24.com/admin",
    "https://wing.coupang.com.evil.example/tenants/cs/product/review",
    "https://evil.example/?h=wing.coupang.com",
  ])("refuses %s", (entryUrl) => {
    expect(validateCoupangReviewWorkflow({ ...COUPANG_REVIEW_READ_WORKFLOW, entryUrl }))
      .toContain("ENTRY_NOT_WING");
  });

  it("refuses a scheme that is not the web, and bounds how long it may sit on a page", () => {
    for (const entryUrl of ["file:///etc/passwd", "data:text/html,<p>x", "javascript:alert(1)", "not a url"]) {
      expect(validateCoupangReviewWorkflow({ ...COUPANG_REVIEW_READ_WORKFLOW, entryUrl })).toContain("ENTRY_NOT_WING");
    }
    expect(validateCoupangReviewWorkflow({ ...COUPANG_REVIEW_READ_WORKFLOW, settleTimeoutMs: 0 }))
      .toContain("TIMEOUT_INVALID");
    expect(validateCoupangReviewWorkflow({ ...COUPANG_REVIEW_READ_WORKFLOW, settleTimeoutMs: 10 * 60_000 }))
      .toContain("TIMEOUT_INVALID");
  });
});

describe("the marketplace recipe — nothing read is never nothing there", () => {
  it("a signed-out browser reports absence, not a store with no reviews, and reads no rows", async () => {
    const executor = executorOf(failed("AUTH_REQUIRED"));
    const handoff = handoffOk();
    const result = await runCoupangReviewObservation({
      expectedStoreFingerprint: EXPECTED, accountSlot: "slot-1", handoff, executor,
    });
    expect(result).toEqual({ outcome: "EXECUTOR_UNAVAILABLE", observedCount: null, contentDigest: null });
    expect(handoff).not.toHaveBeenCalled();
  });

  it("a store that cannot be proved drops the rows that arrived with it, unread", async () => {
    // The rows are in the SAME answer as the identity. A wrong store must not be able to deliver them.
    const executor = executorOf(observed({ reason: "OK", rows: [{ rowIndex: 0, dateText: "2026-09-01" }] }, ["B99999999"]));
    const handoff = handoffOk();
    const result = await runCoupangReviewObservation({
      expectedStoreFingerprint: EXPECTED, accountSlot: "slot-1", handoff, executor,
    });
    expect(result).toEqual({ outcome: "SURFACE_UNREADABLE", observedCount: null, contentDigest: null });
    expect(handoff).not.toHaveBeenCalled();
  });

  it("no expectation is a stop, not a pass — the backend could not say which store this is", async () => {
    const executor = executorOf(observed({ reason: "OK", rows: [{ rowIndex: 0 }] }));
    const handoff = handoffOk();
    const result = await runCoupangReviewObservation({
      expectedStoreFingerprint: null, accountSlot: "slot-1", handoff, executor,
    });
    expect(result.outcome).toBe("SURFACE_UNREADABLE");
    expect(result.observedCount).toBeNull();
    expect(handoff).not.toHaveBeenCalled();
  });

  it("a page whose rows we could not parse is a shape we lost, not an empty store", async () => {
    // Rows printed; none survives canonicalization. A confident zero here would be the worst kind of wrong.
    const executor = executorOf(observed({ reason: "OK", rows: [{ rowIndex: 0, bodyText: "x" }] }));
    const handoff = handoffOk();
    const result = await runCoupangReviewObservation({
      expectedStoreFingerprint: EXPECTED, accountSlot: "slot-1", handoff, executor,
    });
    expect(result).toEqual({ outcome: "SURFACE_UNREADABLE", observedCount: null, contentDigest: null });
    expect(handoff).not.toHaveBeenCalled();
  });

  it("a reading that could not be delivered establishes nothing durable, so it carries no count", async () => {
    const executor = executorOf(observed({ reason: "NO_ROWS", rows: [] }));
    const handoff = vi.fn(async (_request: ReviewHandoffRequest): Promise<ReviewHandoffResponse> => ({
      ok: false, received: 0, stored: 0, skipped: 0, failed: 0, unlinked: 0, reason: "HTTP_503",
    }));
    const result = await runCoupangReviewObservation({
      expectedStoreFingerprint: EXPECTED, accountSlot: "slot-1", handoff, executor,
    });
    expect(result).toEqual({ outcome: "EXECUTOR_UNAVAILABLE", observedCount: null, contentDigest: null });
    expect(handoff).toHaveBeenCalledTimes(1);
  });

  it("with no route home it reads nothing at all — the executor is never even started", async () => {
    const executor = executorOf(observed({ reason: "NO_ROWS", rows: [] }));
    const result = await runCoupangReviewObservation({
      expectedStoreFingerprint: EXPECTED, accountSlot: null, handoff: handoffOk(), executor,
    });
    expect(result).toEqual({ outcome: "REFUSED", observedCount: null, contentDigest: null });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("an empty list IS a real observation of zero, handed off exactly once with a digest", async () => {
    const executor = executorOf(observed({ reason: "NO_ROWS", rows: [] }));
    const handoff = handoffOk();
    const result = await runCoupangReviewObservation({
      expectedStoreFingerprint: EXPECTED, accountSlot: "slot-1", handoff, executor,
    });
    expect(result.outcome).toBe("OBSERVED");
    expect(result.observedCount).toBe(0);
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(handoff).toHaveBeenCalledTimes(1);
    const request = handoff.mock.calls[0]![0];
    expect(request.channelCode).toBe("COUPANG");
    expect(request.accountSlot).toBe("slot-1");
    // One page, and the walk never claims coverage it did not observe from the list's own pager.
    expect(request.complete).toBe(false);
    expect(request.reviews).toEqual([]);
  });
});
