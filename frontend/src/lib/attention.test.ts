import { describe, expect, it } from "vitest";
import type { AttentionSignal } from "./types";
import {
  isSpikeSignal,
  reviewsNeedingAttention,
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

describe("reviewsNeedingAttention", () => {
  function reviewSignal(type: string, severity: string, count: number): AttentionSignal {
    return { type, severity, count, label: type, description: "", sourceType: "REVIEW", channel: null };
  }
  function inquirySignal(type: string, severity: string, count: number): AttentionSignal {
    return { type, severity, count, label: type, description: "", sourceType: "INQUIRY", channel: null };
  }

  it("sums the HIGH/MEDIUM review signals — the shape the ingested-review source produces", () => {
    // Ratings 1·2·3·4·5·5 → LOW_RATING HIGH 2 (1★,2★) + MEDIUM 1 (3★), NEW_REVIEW LOW 6.
    // The answer is 3: the reviews needing a look, not the six that merely arrived.
    expect(
      reviewsNeedingAttention([
        reviewSignal("LOW_RATING_REVIEW", "HIGH", 2),
        reviewSignal("LOW_RATING_REVIEW", "MEDIUM", 1),
        reviewSignal("NEW_REVIEW", "LOW", 6),
      ]),
    ).toBe(3);
  });

  it("excludes inquiries — this is the REVIEW number, not a combined workload", () => {
    expect(
      reviewsNeedingAttention([
        reviewSignal("LOW_RATING_REVIEW", "HIGH", 2),
        inquirySignal("UNANSWERED_INQUIRY", "HIGH", 9),
      ]),
    ).toBe(2);
  });

  it("excludes the spike candidate, which re-counts rows a rating signal already counted", () => {
    expect(
      reviewsNeedingAttention([
        reviewSignal("LOW_RATING_REVIEW", "HIGH", 2),
        reviewSignal("RECENT_REVIEW_SPIKE_CANDIDATE", "HIGH", 12),
      ]),
    ).toBe(2);
  });

  it("is 0 for an empty window and for arrivals alone", () => {
    expect(reviewsNeedingAttention([])).toBe(0);
    expect(reviewsNeedingAttention([reviewSignal("NEW_REVIEW", "LOW", 40)])).toBe(0);
  });

  it("ignores a non-finite count rather than rendering NaN건", () => {
    expect(
      reviewsNeedingAttention([
        reviewSignal("LOW_RATING_REVIEW", "HIGH", Number.NaN),
        reviewSignal("LOW_RATING_REVIEW", "MEDIUM", 1),
      ]),
    ).toBe(1);
  });
});
