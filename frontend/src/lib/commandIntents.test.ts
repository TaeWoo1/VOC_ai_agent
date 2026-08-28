import { describe, expect, it } from "vitest";
import { COMMAND_INTENTS, matchCommandIntent } from "./commandIntents";

describe("palette shortcuts — exact sentences only, everything else is the Agent's", () => {
  it("every shortcut matches its own label", () => {
    for (const intent of COMMAND_INTENTS) {
      expect(matchCommandIntent(intent.label)).toBe(intent.key);
    }
  });

  it("tolerates spacing, punctuation and a polite ending", () => {
    expect(matchCommandIntent("미답변 문의 보여줘")).toBe("UNANSWERED_INQUIRIES");
    expect(matchCommandIntent("미답변 문의 보여줘요")).toBe("UNANSWERED_INQUIRIES");
    expect(matchCommandIntent("  미답변   문의   보여줘?  ")).toBe("UNANSWERED_INQUIRIES");
    expect(matchCommandIntent("오늘 할 일 알려줘.")).toBe("TODAY");
  });

  it("a different sentence about the same noun is NOT a shortcut — the planner interprets it", () => {
    expect(matchCommandIntent("오늘 새로 달린 리뷰 보여줘")).toBeNull();
    // Acceptance Closure §9: a review sentence is never a shortcut — rows or repeated problems is the planner's call.
    expect(matchCommandIntent("리뷰 문제 보여줘")).toBeNull();
    expect(matchCommandIntent("오늘 새 리뷰 보여줘")).toBeNull();
    expect(matchCommandIntent("문의 목록")).toBeNull();
    expect(matchCommandIntent("3호 몰딩 문의가 몇 건이야")).toBeNull();
    expect(matchCommandIntent("이번 달 매출이 왜 줄었어")).toBeNull();
    expect(matchCommandIntent("리뷰 답변 초안 써 줘")).toBeNull();
    expect(matchCommandIntent("")).toBeNull();
    expect(matchCommandIntent("   ")).toBeNull();
  });
});
