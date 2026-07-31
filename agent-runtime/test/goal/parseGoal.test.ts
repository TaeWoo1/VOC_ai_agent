import { describe, expect, it } from "vitest";
import { parseGoal, routeIntent, UnrecognizedGoalError } from "../../src/goal/parseGoal";

describe("parseGoal", () => {
  it("accepts an explicit supported intent and carries paging", () => {
    const g = parseGoal({ intent: "HANDLE_UNANSWERED_INQUIRIES", page: 1, size: 50 });
    expect(g.intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
    expect(g.page).toBe(1);
    expect(g.size).toBe(50);
  });

  it("maps free text to an intent via the keyword table (ko + en)", () => {
    expect(parseGoal({ text: "미답변 문의 좀 처리해줘" }).intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
    expect(parseGoal({ text: "handle the unanswered inquiries" }).intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
  });

  it("rejects an unknown explicit intent (fail closed)", () => {
    expect(() => parseGoal({ intent: "DELETE_EVERYTHING" })).toThrow(UnrecognizedGoalError);
  });

  it("rejects text with no matching intent", () => {
    expect(() => parseGoal({ text: "what's the weather" })).toThrow(UnrecognizedGoalError);
  });

  it("rejects an empty request", () => {
    expect(() => parseGoal({})).toThrow(UnrecognizedGoalError);
  });

  it("routes a draft ('초안'/draft) request to the draft-preparation intent, not the approve loop", () => {
    expect(parseGoal({ intent: "PREPARE_INQUIRY_DRAFT" }).intent).toBe("PREPARE_INQUIRY_DRAFT");
    expect(parseGoal({ text: "Cafe24 문의 답변 초안 만들어줘" }).intent).toBe("PREPARE_INQUIRY_DRAFT");
    expect(parseGoal({ text: "prepare a reply draft" }).intent).toBe("PREPARE_INQUIRY_DRAFT");
    expect(routeIntent("PREPARE_INQUIRY_DRAFT")).toBe("INQUIRY_DRAFT");
  });

  it("keeps the broad '미답변 문의 처리' on the full approve loop — a draft word is required to prepare only", () => {
    // No "초안"/draft word → the full unanswered-inquiry loop, not draft preparation.
    expect(parseGoal({ text: "미답변 문의 처리해줘" }).intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
    // A review draft still wins for review (review keyword precedes the draft row).
    expect(parseGoal({ text: "리뷰 답변 초안 만들어줘" }).intent).toBe("HANDLE_REVIEW_REPLIES");
  });
});
