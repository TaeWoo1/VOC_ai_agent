import { describe, expect, it } from "vitest";
import type { AttentionSignal } from "./types";
import {
  isSpikeSignal,
  severityStyle,
  signalActionLabel,
  sortBySeverity,
  spikeComparisonText,
} from "./attention";

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

describe("isSpikeSignal", () => {
  it("is true for the recent review/inquiry spike candidate types", () => {
    expect(isSpikeSignal("RECENT_REVIEW_SPIKE_CANDIDATE")).toBe(true);
    expect(isSpikeSignal("RECENT_INQUIRY_SPIKE_CANDIDATE")).toBe(true);
  });

  it("is false for routine signal types and unknowns", () => {
    for (const type of [
      "NEW_REVIEW",
      "NEW_INQUIRY",
      "UNANSWERED_INQUIRY",
      "LOW_RATING_REVIEW",
      "UNKNOWN_REPLY_STATUS",
      "",
    ]) {
      expect(isSpikeSignal(type)).toBe(false);
    }
  });
});

describe("signalActionLabel", () => {
  it("gives spike candidates a source-specific call to action", () => {
    expect(signalActionLabel("RECENT_INQUIRY_SPIKE_CANDIDATE")).toBe("어떤 문의인지 확인");
    expect(signalActionLabel("RECENT_REVIEW_SPIKE_CANDIDATE")).toBe("어떤 리뷰인지 확인");
  });

  it("falls back to the generic label for routine signals", () => {
    for (const type of ["NEW_REVIEW", "NEW_INQUIRY", "UNANSWERED_INQUIRY", "LOW_RATING_REVIEW", ""]) {
      expect(signalActionLabel(type)).toBe("보기");
    }
  });
});

describe("spikeComparisonText", () => {
  it("renders delta and ratio from the structured fields (rounded to one decimal)", () => {
    expect(spikeComparisonText({ previousCount: 3, deltaCount: 5, ratio: 8 / 3 })).toBe(
      "직전 동일 기간 대비 +5건 · 2.7배",
    );
  });

  it("drops a trailing .0 on a whole-number ratio", () => {
    expect(spikeComparisonText({ previousCount: 3, deltaCount: 3, ratio: 2 })).toBe(
      "직전 동일 기간 대비 +3건 · 2배",
    );
  });
});
