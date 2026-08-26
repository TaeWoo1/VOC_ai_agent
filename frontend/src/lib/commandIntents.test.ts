import { describe, expect, it } from "vitest";
import { COMMAND_INTENTS, matchCommandIntent } from "./commandIntents";

describe("command palette — what it answers and what it hands over", () => {
  it("every chip matches the intent it advertises", () => {
    for (const intent of COMMAND_INTENTS) {
      expect(matchCommandIntent(intent.label)).toBe(intent.key);
    }
  });

  it("recognises the sentences the product promises", () => {
    expect(matchCommandIntent("미답변 문의 보여줘")).toBe("UNANSWERED_INQUIRIES");
    expect(matchCommandIntent("문의 목록")).toBe("UNANSWERED_INQUIRIES");
    expect(matchCommandIntent("리뷰 문제 보여주세요")).toBe("REVIEW_ISSUES");
    expect(matchCommandIntent("오늘 할 일 알려줘")).toBe("TODAY");
  });

  it("a question is not a request for a list — it goes to the Agent", () => {
    // The whole reason this file is a palette and not a planner: it must not answer what it only
    // half understood. Null means "hand it over", which is a different thing from "cannot be done".
    expect(matchCommandIntent("3호 몰딩 문의가 몇 건이야")).toBeNull();
    expect(matchCommandIntent("이번 달 매출이 왜 줄었어")).toBeNull();
    expect(matchCommandIntent("리뷰 답변 초안 써 줘")).toBeNull();
    expect(matchCommandIntent("")).toBeNull();
    expect(matchCommandIntent("   ")).toBeNull();
  });

  it("punctuation and spacing are not part of the sentence", () => {
    expect(matchCommandIntent("  미답변   문의   보여줘?  ")).toBe("UNANSWERED_INQUIRIES");
  });
});
