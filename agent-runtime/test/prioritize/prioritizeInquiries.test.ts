import { describe, expect, it } from "vitest";
import { prioritizeInquiries, selectTop } from "../../src/prioritize/prioritizeInquiries";
import type { InquiryQueueItem } from "../../src/spring/types";

function item(workItemId: string, receivedAt: string): InquiryQueueItem {
  return {
    workItemId,
    inquiryId: `inq-${workItemId}`,
    sellerAccountId: "acct",
    channelId: "chan",
    phase: "OPEN",
    status: "UNANSWERED",
    title: "t",
    receivedAt,
  };
}

describe("prioritizeInquiries", () => {
  it("ranks oldest-waiting first", () => {
    const ranked = prioritizeInquiries([
      item("b", "2026-07-20T00:00:00Z"),
      item("a", "2026-07-18T00:00:00Z"),
      item("c", "2026-07-22T00:00:00Z"),
    ]);
    expect(ranked.map((r) => r.item.workItemId)).toEqual(["a", "b", "c"]);
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[0]!.priorityBucket).toBe("top");
  });

  it("breaks ties by workItemId for a stable order", () => {
    const ranked = prioritizeInquiries([
      item("y", "2026-07-18T00:00:00Z"),
      item("x", "2026-07-18T00:00:00Z"),
    ]);
    expect(ranked.map((r) => r.item.workItemId)).toEqual(["x", "y"]);
  });

  it("does not mutate its input", () => {
    const input = [item("b", "2026-07-20T00:00:00Z"), item("a", "2026-07-18T00:00:00Z")];
    const snapshot = input.map((i) => i.workItemId);
    prioritizeInquiries(input);
    expect(input.map((i) => i.workItemId)).toEqual(snapshot);
  });

  it("selectTop returns the rank-1 row, or null when empty", () => {
    expect(selectTop(prioritizeInquiries([]))).toBeNull();
    const top = selectTop(prioritizeInquiries([item("a", "2026-07-18T00:00:00Z")]));
    expect(top?.item.workItemId).toBe("a");
  });
});
