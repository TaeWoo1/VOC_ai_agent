import { describe, expect, it } from "vitest";
import { prioritizeReviews, selectTopReview } from "../../src/prioritize/prioritizeReviews";
import type { ReviewWorkItem } from "../../src/spring/types";

function item(actionRef: string, sourceCreatedDate: string | null): ReviewWorkItem {
  return {
    actionRef,
    channelCode: "cafe24",
    channelNameKo: "카페24",
    sourceType: "REVIEW",
    productName: null,
    rating: 3,
    replyStatus: "PENDING",
    sourceCreatedDate,
    triageDisposition: "RESPONSE_NEEDED",
    hasReplyPreparation: false,
  };
}

describe("prioritizeReviews", () => {
  it("ranks oldest sourceCreatedDate first", () => {
    const ranked = prioritizeReviews([
      item("review:b", "2026-07-20"),
      item("review:a", "2026-07-18"),
    ]);
    expect(ranked.map((r) => r.item.actionRef)).toEqual(["review:a", "review:b"]);
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[0]!.priorityBucket).toBe("top");
  });

  it("sorts undated rows LAST and breaks ties by actionRef", () => {
    const ranked = prioritizeReviews([
      item("review:z", null),
      item("review:m", "2026-07-19"),
      item("review:n", "2026-07-19"),
    ]);
    expect(ranked.map((r) => r.item.actionRef)).toEqual(["review:m", "review:n", "review:z"]);
  });

  it("does not mutate the input", () => {
    const input = [item("review:b", "2026-07-20"), item("review:a", "2026-07-18")];
    const before = input.map((i) => i.actionRef);
    prioritizeReviews(input);
    expect(input.map((i) => i.actionRef)).toEqual(before);
  });

  it("selectTopReview returns null on an empty worklist", () => {
    expect(selectTopReview(prioritizeReviews([]))).toBeNull();
  });
});
