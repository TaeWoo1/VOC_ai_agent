/**
 * Working Context v1 §1 — what the bar above the box may claim.
 *
 * The point of these is what it must NOT say: a title it did not see drawn, a customer's sentence, a
 * token, or a task word for a step that is not running.
 */
import { describe, it, expect } from "vitest";
import { currentContext } from "./currentContext";
import type { TurnView, WorkingSetView } from "./types";

function turnWithList(): TurnView {
  return {
    turnId: "t1", conversationId: "c", role: "AGENT", message: "",
    artifacts: [
      {
        artifactId: "a1", type: "INQUIRY_LIST", title: "먼저 볼 문의", totalCount: 12,
        groups: [
          {
            key: "UNANSWERED", label: "답변 필요",
            items: [
              {
                workItemId: "w-1", inquiryId: "i-1", channelCode: "NAVER", channelNameKo: "네이버 스마트스토어",
                receivedAt: "2026-07-22T00:00:00Z", phase: "OPEN", status: "UNANSWERED",
                title: "현금영수증 발행 부탁드립니다", snippet: "주문할 때 현금영수증 신청을 못 했는데…",
                productId: "p-1", productName: "실리콘 몰딩 2호", answerBasis: null, to: "/inquiries/i-1",
              },
            ],
          },
        ],
      },
    ],
    suggestedActions: [],
    continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
    status: "DONE", createdAt: "2026-08-31T00:00:00Z",
  };
}

const anchored: WorkingSetView = {
  kind: "INQUIRIES", label: "먼저 볼 문의", count: 3, ids: ["i-1"], filters: { inquiryIntent: "ROWS" },
  productIds: ["p-1"], workItemIds: ["w-1"],
  selectedInquiry: { inquiryId: "i-1", workItemId: "w-1", productId: "p-1", channelCode: "NAVER" },
  turnId: "t1",
};

describe("currentContext", () => {
  it("names the anchored inquiry from what the thread already drew — its subject line, never its body", () => {
    const ctx = currentContext(anchored, "INSPECT", [turnWithList()]);
    expect(ctx).toEqual({
      kind: "ANCHOR",
      label: "현금영수증 발행 부탁드립니다",
      meta: "네이버 스마트스토어 · 실리콘 몰딩 2호",
      // INSPECT gets NO word: the bar showing the object IS the inspection.
      task: null,
      to: "/inquiries/i-1",
      clearable: true,
    });
    // The words the bar RENDERS carry no id, no phase and no token. (`to` is a route, and every row
    // link in this product already carries the inquiry id in exactly that shape.)
    const rendered = [ctx?.label, ctx?.meta, ctx?.task].filter(Boolean).join(" ");
    expect(rendered).not.toContain("주문할 때");
    expect(rendered).not.toMatch(/i-1|w-1|INSPECT|UNANSWERED|OPEN/);
  });

  it("a step in flight is said in seller words; an unknown task says nothing", () => {
    expect(currentContext(anchored, "PREPARE_REPLY", [turnWithList()])?.task).toBe("답변 준비 중");
    expect(currentContext(anchored, "CAPTURE_KNOWLEDGE", [turnWithList()])?.task).toBe("답변 기준 확인 중");
    expect(currentContext(anchored, null, [turnWithList()])?.task).toBeNull();
  });

  it("an anchor the transcript cannot name says the honest generic thing, and offers no link", () => {
    const ctx = currentContext(anchored, null, []);
    expect(ctx?.label).toBe("선택한 문의");
    expect(ctx?.to).toBeNull();
    expect(ctx?.clearable).toBe(true);
  });

  it("with no selection it describes the SET in the seller's own words — and cannot be released", () => {
    const set: WorkingSetView = {
      ...anchored, selectedInquiry: null, count: 3,
      filters: { inquiryIntent: "ROWS", term: "현금영수증", channelCode: "NAVER", status: "UNANSWERED" },
    };
    expect(currentContext(set, null, [])).toEqual({
      kind: "SET",
      label: "화면에 있는 문의",
      meta: "'현금영수증' 관련 · 네이버 · 답변 필요 · 3건",
      task: null,
      to: null,
      clearable: false,
    });
  });

  it("holds nothing when there is no set, and nothing when the set is empty", () => {
    expect(currentContext(null, null, [])).toBeNull();
    expect(currentContext({ ...anchored, selectedInquiry: null, count: 0, ids: [] }, null, [])).toBeNull();
  });
});
