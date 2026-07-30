import { describe, expect, it } from "vitest";
import { buildReviewToolRegistry } from "../../src/tools/ReviewToolRegistry";
import { REVIEW_TOOL } from "../../src/tools/reviewTools";
import { UnknownToolError } from "../../src/tools/ToolRegistry";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { twoReviews, OLDER_REVIEW_REF } from "../support/reviewFixtures";
import type { ReviewReplyWorkResponse } from "../../src/spring/types";

describe("review tool registry", () => {
  it("registers exactly the five review tools", () => {
    const reg = buildReviewToolRegistry(new FakeReviewSpringClient());
    expect(reg.names()).toEqual(
      [
        REVIEW_TOOL.APPROVE,
        REVIEW_TOOL.GET_PREP,
        REVIEW_TOOL.PREPARE_GUIDED_SESSION,
        REVIEW_TOOL.SAVE_DRAFT,
        REVIEW_TOOL.SEARCH_NEEDING_REPLY,
      ].sort(),
    );
    // Crucially, there is NO send/publish/dispatch tool.
    expect(reg.names().some((n) => /send|publish|dispatch/i.test(n))).toBe(false);
  });

  it("invoke() forwards to the backend client and returns the structured result", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    const reg = buildReviewToolRegistry(fake);
    const res = await reg.invoke<ReviewReplyWorkResponse>(REVIEW_TOOL.SEARCH_NEEDING_REPLY, {
      accountId: "acct",
    });
    expect(res.todo.map((t) => t.actionRef)).toContain(OLDER_REVIEW_REF);
    expect(fake.calls.list).toBe(1);
  });

  it("unknown tool fails closed", () => {
    const reg = buildReviewToolRegistry(new FakeReviewSpringClient());
    expect(() => reg.get("send_review_reply")).toThrow(UnknownToolError);
  });
});
