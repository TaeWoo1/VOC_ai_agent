import { describe, expect, it } from "vitest";
import { parseGoal, UnrecognizedGoalError } from "../../src/goal/parseGoal";

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
});
