import { describe, expect, it } from "vitest";
import type { AttentionSignal } from "./types";
import { severityStyle, sortBySeverity } from "./attention";

function signal(type: string, severity: string): AttentionSignal {
  return { type, severity, count: 1, label: type, description: "", sourceType: "REVIEW", channel: "카페24" };
}

describe("severityStyle", () => {
  it("maps each severity to its badge + label", () => {
    expect(severityStyle("HIGH")).toEqual({ badge: "bg-bad/10 text-bad", label: "높음" });
    expect(severityStyle("MEDIUM")).toEqual({ badge: "bg-warn/10 text-warn", label: "보통" });
    expect(severityStyle("LOW")).toEqual({ badge: "bg-ink/5 text-muted", label: "낮음" });
  });

  it("falls back to the LOW style for an unknown severity", () => {
    expect(severityStyle("WHATEVER")).toEqual(severityStyle("LOW"));
  });
});

describe("sortBySeverity", () => {
  it("orders HIGH before MEDIUM before LOW", () => {
    const sorted = sortBySeverity([
      signal("NEW_REVIEW", "LOW"),
      signal("UNANSWERED_INQUIRY", "HIGH"),
      signal("NEW_INQUIRY", "MEDIUM"),
    ]);
    expect(sorted.map((s) => s.severity)).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });

  it("is stable within a severity tier and does not mutate the input", () => {
    const input = [
      signal("UNANSWERED_INQUIRY", "HIGH"),
      signal("LOW_RATING_REVIEW", "HIGH"),
      signal("NEW_REVIEW", "LOW"),
    ];
    const sorted = sortBySeverity(input);
    // Declared order of the two HIGH signals is preserved.
    expect(sorted.slice(0, 2).map((s) => s.type)).toEqual(["UNANSWERED_INQUIRY", "LOW_RATING_REVIEW"]);
    // Original array untouched.
    expect(input.map((s) => s.severity)).toEqual(["HIGH", "HIGH", "LOW"]);
  });

  it("ranks unknown severities last", () => {
    const sorted = sortBySeverity([signal("X", "MYSTERY"), signal("UNANSWERED_INQUIRY", "HIGH")]);
    expect(sorted.map((s) => s.severity)).toEqual(["HIGH", "MYSTERY"]);
  });
});
