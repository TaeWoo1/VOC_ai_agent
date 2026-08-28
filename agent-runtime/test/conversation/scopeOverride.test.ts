/** R7 / R8 — scope decided by plan fields and the set's own shape, never by a keyword. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOKEN, artifact, freshReviews, harness, negativeReviews, say, staleCoupangCoverage, CAFE24_ACCOUNT } from "./support";
import { clearLogSink, getLogSink } from "../../src/log";
import { MOLDING } from "../support/operatorFixtures";

async function fresh(seed?: Parameters<typeof harness>[0], seeds?: Parameters<typeof harness>[1]) {
  const h = harness(seed, seeds);
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}

describe("R7 — WORKING_SET is overridden to ORG when the set cannot carry the follow-up", () => {
  beforeEach(() => { getLogSink(); });
  afterEach(() => clearLogSink());

  it("a new period token over a 0-row TODAY set reads the org for that period", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = { ...freshReviews(staleCoupangCoverage()), items: [], total: 0 };
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(first.turn.status).toBe("WAITING_HUMAN");
    h.recentReviews["false:ALL"] = freshReviews();
    const { turn } = await say(h, id, "지난 7일 것도 보여줘");
    expect(turn.status).toBe("DONE");
    expect(artifact(turn, "REVIEW_LIST").items).toHaveLength(3);
    expect(turn.message).toContain("최근 7일 확인 가능한 리뷰가 3건입니다.");
    expect(turn.message).not.toContain("방금 본");
    expect(h.operator.recentReviewParams.at(-1)).toMatchObject({ from: "2026-08-21", to: "2026-08-27" });
    const override = getLogSink().filter((r) => r.event === "operator_scope_override");
    expect(override.map((r) => r.meta)).toEqual([{ from: "WORKING_SET", to: "ORG", reason: "NEW_PERIOD" }]);
  });

  it("a filter over an empty set reads the org (EMPTY_SET)", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = { ...freshReviews(), items: [], total: 0 };
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    h.recentReviews["true:ALL"] = negativeReviews();
    const { turn } = await say(h, id, "안 좋은 것만 봐줘");
    expect(artifact(turn, "REVIEW_LIST").items).toHaveLength(2);
    expect(turn.message).not.toContain("방금 본");
    expect(getLogSink().find((r) => r.event === "operator_scope_override")?.meta.reason).toBe("EMPTY_SET");
  });

  it("the same period over a non-empty set is still a follow-up", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "안 좋은 것만 봐줘");
    expect(turn.message).toContain("방금 본 3건 중");
    expect(getLogSink().some((r) => r.event === "operator_scope_override")).toBe(false);
  });
});

describe("R8 — only a PRODUCTS set of one becomes the product hint", () => {
  it("an INQUIRIES set with one product-bound row does not scope 「배송 얘기부터」 to that product", async () => {
    const { h, id } = await fresh(undefined, [
      { workItemId: "w-1", inquiryId: "i-1", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24", channelCode: "CAFE24",
        channelNameKo: "카페24", title: "배송 언제 오나요", details: "택배", receivedAt: "2026-08-26T01:00:00Z", productId: MOLDING.id, productName: MOLDING.name },
      { workItemId: "w-2", inquiryId: "i-2", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24", channelCode: "CAFE24",
        channelNameKo: "카페24", title: "배송비 문의", details: "배송비", receivedAt: "2026-08-26T02:00:00Z" },
      { workItemId: "w-3", inquiryId: "i-3", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24", channelCode: "CAFE24",
        channelNameKo: "카페24", title: "색상 문의", details: "색", receivedAt: "2026-08-26T03:00:00Z" },
    ]);
    const first = await say(h, id, "오늘 내가 답해야 할 문의 정리해줘");
    expect(first.turn.continuation.workingSet).toMatchObject({ kind: "INQUIRIES", productIds: [MOLDING.id] });
    const { turn } = await say(h, id, "배송 얘기부터 처리하자");
    expect(h.operator.calls.signals).toBe(0);
    expect(artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items.map((i) => i.workItemId))).toEqual(["w-1", "w-2"]);
    expect(h.operator.planPriorContexts.at(-1)).not.toContain("대상 확정");
  });
});
