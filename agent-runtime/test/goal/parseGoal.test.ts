/**
 * Intent validation — the DASHBOARD lane's contract.
 *
 * <b>The free-text cases are gone, deliberately.</b> They used to pin a keyword table that mapped a
 * typed sentence onto one of the four subgraph intents; Operator Graph v2 deleted that table, because a
 * deterministic reading of a seller's own words is exactly what invariant I2 forbids — including "for
 * tests". What is left is what a BUTTON sends: a closed enum, validated, with an unknown value refused.
 *
 * A sentence now resolves to `OPERATOR_GOAL` here and is interpreted by the LLM planner, or not at all.
 */
import { describe, expect, it } from "vitest";
import { parseGoal, routeIntent, UnrecognizedGoalError } from "../../src/goal/parseGoal";

describe("parseGoal — explicit intents (the Dashboard lane)", () => {
  it("accepts an explicit supported intent and carries paging", () => {
    const g = parseGoal({ intent: "HANDLE_UNANSWERED_INQUIRIES", page: 1, size: 50 });
    expect(g.intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
    expect(g.page).toBe(1);
    expect(g.size).toBe(50);
  });

  it("rejects an unknown explicit intent (fail closed)", () => {
    // A client naming an intent asserts it knows the catalogue; a silent reroute would hide its bug.
    expect(() => parseGoal({ intent: "DELETE_EVERYTHING" })).toThrow(UnrecognizedGoalError);
  });

  it("rejects an empty request", () => {
    expect(() => parseGoal({})).toThrow(UnrecognizedGoalError);
  });

  it("each subgraph intent still routes to its own domain", () => {
    expect(routeIntent("HANDLE_UNANSWERED_INQUIRIES")).toBe("INQUIRY");
    expect(routeIntent("PREPARE_INQUIRY_DRAFT")).toBe("INQUIRY_DRAFT");
    expect(routeIntent("HANDLE_REVIEW_REPLIES")).toBe("REVIEW");
    expect(routeIntent("HANDLE_OPERATIONS_ISSUES")).toBe("ISSUE");
    expect(routeIntent("OPERATOR_GOAL")).toBe("OPERATOR");
  });
});

describe("parseGoal — free text is not interpreted here", () => {
  it("any sentence resolves to the Operator, whatever it says", () => {
    // Not a fallback for "text the table refused" — there is no table. Interpreting a sentence is the
    // planner's job and nothing in this process is allowed to pre-empt it.
    for (const text of [
      "미답변 문의 좀 처리해줘",
      "리뷰 답변 초안 만들어줘",
      "what's the weather",
      "폭이 몇 mm인가요?",
    ]) {
      expect(parseGoal({ text }).intent).toBe("OPERATOR_GOAL");
    }
  });

  it("an explicit intent still wins over accompanying text", () => {
    // A button that also sent a label must not be re-read as a sentence.
    expect(parseGoal({ intent: "HANDLE_REVIEW_REPLIES", text: "미답변 문의" }).intent)
      .toBe("HANDLE_REVIEW_REPLIES");
  });

  it("blank text is not a goal", () => {
    expect(() => parseGoal({ text: "   " })).toThrow(UnrecognizedGoalError);
  });
});
