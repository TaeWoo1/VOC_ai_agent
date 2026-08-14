/**
 * **The one function in this package that puts review bodies on a socket.**
 *
 * So the tests are about the boundary rather than the happy path: what crosses, what a failure is allowed to
 * carry back, and what the log line is allowed to hold while the bodies are in scope.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  postCoupangReviewHandoff,
  ReviewHandoffTransportError,
} from "../../src/action-window/coupang-review/review-handoff-client";
import { clearLogSink, getLogSink } from "../../src/log";
import type { CoupangAcquiredReview } from "../../src/action-window/coupang-review/review-rows";

const BODY = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";

const REVIEW: CoupangAcquiredReview = {
  writtenOn: "2026-08-11",
  rating: 5,
  body: BODY,
  textless: false,
  bodyTruncated: false,
  bodyExpandable: false,
  productId: "15411270785",
  vendorItemId: "81234567890",
  productName: "무선 이어폰",
  mediaCount: 2,
  bodyFingerprint: "a".repeat(64),
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const REQUEST = {
  accountSlot: "0123456789abcdef01234567",
  channelCode: "COUPANG",
  complete: true,
  stopReason: "FINAL_PAGE_REACHED",
  reviews: [REVIEW],
};

beforeEach(() => {
  clearLogSink();
});

describe("what crosses the wire", () => {
  it("posts to the agent review route with the operator's bearer token", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ received: 1, stored: 1, skipped: 0, failed: 0 }));

    await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/api/agent/review-handoff");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("sends the review fields the backend stores, and nothing beside them", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ received: 1, stored: 1, skipped: 0, failed: 0 }));

    await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { reviews: Record<string, unknown>[] };
    expect(Object.keys(sent.reviews[0]!).sort()).toEqual([
      "body",
      "bodyTruncated",
      "mediaCount",
      "productId",
      "productName",
      "rating",
      "textless",
      "vendorItemId",
      "writtenOn",
    ]);
  });

  it("does not send the fingerprint the agent computed", async () => {
    // The backend recomputes it from the body it stored. A fingerprint the agent asserted would be a second
    // source of truth for the locate target, and the two could disagree about the same review.
    const fetchImpl = vi.fn(async () => okResponse({ received: 1, stored: 1, skipped: 0, failed: 0 }));

    await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body as string).not.toContain("bodyFingerprint");
  });

  it("carries the walk's coverage claim rather than letting the backend infer one", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ received: 1, stored: 1, skipped: 0, failed: 0 }));

    await postCoupangReviewHandoff(
      "http://localhost:8080",
      "tok",
      { ...REQUEST, complete: false, stopReason: "PAGER_UNRESOLVED" },
      fetchImpl as never,
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { complete: boolean; stopReason: string };
    expect(sent.complete).toBe(false);
    expect(sent.stopReason).toBe("PAGER_UNRESOLVED");
  });
});

describe("a textless review crosses as a state, never as the channel's placeholder", () => {
  it("sends an empty body and the flag, so the backend keys it on the option id", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ received: 1, stored: 1, skipped: 0, failed: 0 }));
    const textless: CoupangAcquiredReview = { ...REVIEW, body: "", textless: true };

    await postCoupangReviewHandoff("http://localhost:8080", "tok", { ...REQUEST, reviews: [textless] }, fetchImpl as never);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { reviews: Record<string, unknown>[] };
    expect(sent.reviews[0]).toMatchObject({ body: "", textless: true, vendorItemId: "81234567890" });
    // Coupang's own UI sentence is not what a customer wrote, and it never travels as one.
    expect(init.body as string).not.toContain("등록된 내용이 없습니다");
  });
});

describe("what a failure is allowed to carry back", () => {
  it("returns a status-only result on a refusal, without reading the response body", async () => {
    const json = vi.fn(async () => ({ message: BODY }));
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, json }) as unknown as Response);

    const res = await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    expect(res).toMatchObject({ ok: false, stored: 0, reason: "HTTP_400" });
    expect(json).not.toHaveBeenCalled();
  });

  it("throws a transport error that carries nothing when there is no response at all", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED while sending ${BODY}`);
    });

    await expect(
      postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never),
    ).rejects.toBeInstanceOf(ReviewHandoffTransportError);
  });

  it("does not quote the failed request in the transport error's message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED while sending ${BODY}`);
    });

    let message = "";
    try {
      await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(BODY);
  });

  it("fails closed on a 200 that is not JSON, rather than reporting a successful store", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError(`Unexpected token < in ${BODY}`);
          },
        }) as unknown as Response,
    );

    const res = await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    expect(res).toMatchObject({ ok: false, stored: 0, reason: "MALFORMED_RESPONSE" });
  });

  it("treats a missing or nonsense count as zero rather than trusting it", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ stored: "lots", skipped: -3 }));

    const res = await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    expect(res).toMatchObject({ ok: true, received: 0, stored: 0, skipped: 0, failed: 0 });
  });
});

describe("the log line, while a page of reviews is in scope", () => {
  it("holds counts and a status, and no review text", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ received: 1, stored: 1, skipped: 0, failed: 0 }));

    await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    const serialized = JSON.stringify(getLogSink());
    expect(serialized).toContain("aw_coupang_review_handoff");
    expect(serialized).not.toContain(BODY);
    expect(serialized).not.toContain("무선 이어폰");
    expect(serialized).not.toContain("15411270785");
  });

  it("holds no review text on a refusal either", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response);

    await postCoupangReviewHandoff("http://localhost:8080", "tok", REQUEST, fetchImpl as never);

    expect(JSON.stringify(getLogSink())).not.toContain(BODY);
  });
});
