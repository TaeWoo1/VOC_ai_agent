import { afterEach, describe, expect, it } from "vitest";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { getLogSink, clearLogSink } from "../../src/log";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { twoReviews, PHONE_TOKEN, EMAIL_TOKEN } from "../support/reviewFixtures";

afterEach(() => clearLogSink());

describe("review runtime log sanitization (no-leak sweep)", () => {
  it("never logs the review body, the suggestion/draft text, or PII across a full approve run", async () => {
    const sink = getLogSink();
    const fake = new FakeReviewSpringClient(twoReviews());
    const runtime = new ReviewAgentRuntime({ client: fake });

    await runtime.start("t-log", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    await runtime.resume("t-log", { approved: true, approvedBy: "op-1" });

    expect(sink.length).toBeGreaterThan(0);
    const dump = JSON.stringify(sink);
    // No PII tokens from the seeded review bodies.
    expect(dump).not.toContain(PHONE_TOKEN);
    expect(dump).not.toContain(EMAIL_TOKEN);
    // No review body / suggestion / reply-draft text.
    expect(dump).not.toContain("죄송"); // apology draft body
    expect(dump).not.toContain("감사"); // appreciation draft body
    expect(dump).not.toContain("하자"); // review body phrase

    // Every record's meta carries only sanitized scalar fields (no content-ish keys survived).
    for (const rec of sink) {
      for (const key of Object.keys(rec.meta)) {
        expect(key).not.toMatch(/body|comment|title|draft|content|suggestion|token/i);
      }
    }
  });
});
