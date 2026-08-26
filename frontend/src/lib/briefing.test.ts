import { describe, expect, it } from "vitest";
import { briefingHeadline, briefingInsights, briefingSubline, preparedTitle } from "./briefing";
import type { OperationsInsight } from "./types";

function insight(key: string, severity: OperationsInsight["severity"]): OperationsInsight {
  return { key, severity, title: key, detail: null, to: "/", actionLabel: "열기", agentGoal: null };
}

describe("briefing — the sentence the Agent opens with", () => {
  it("counts what is rendered, and says so in the seller's words", () => {
    expect(briefingHeadline(3)).toBe("오늘 먼저 확인하면 좋은 일이 3개 있습니다.");
    // Not a log line. The words 'case', 'proactive', 'detected' are ours, not the seller's.
    expect(briefingHeadline(3)).not.toMatch(/case|proactive|탐지|건수|detected/i);
  });

  it("a quiet morning gets a sentence, not a zero", () => {
    expect(briefingHeadline(0)).toBe("지금 먼저 확인할 일은 없습니다.");
    expect(briefingHeadline(0)).not.toContain("0개");
    expect(briefingSubline(0)).not.toBeNull();
    expect(briefingSubline(2)).toBeNull();
  });

  it("context is not work — INFO rows stay out of the briefing", () => {
    const rows = [insight("A", "ATTENTION"), insight("W", "WATCH"), insight("I", "INFO")];
    expect(briefingInsights(rows).map((i) => i.key)).toEqual(["A", "W"]);
  });

  it("prepared work is named by what is waiting for the seller", () => {
    expect(preparedTitle(2)).toBe("답변 초안을 준비해 둔 문의 2건");
    expect(preparedTitle(2)).not.toMatch(/DRAFT|PROPOSED|생성/);
  });
});
