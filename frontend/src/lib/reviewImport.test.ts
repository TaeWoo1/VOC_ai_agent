import { describe, expect, it } from "vitest";
import {
  canImport,
  canMarkMissing,
  canSplit,
  coverageSummary,
  coveredRowsText,
  healthSummary,
  isUnattempted,
  planStatusLabel,
  segmentUiState,
} from "./reviewImport";
import type {
  ReviewImportCoverageView,
  ReviewImportHealthView,
  ReviewImportSegmentView,
} from "./types";

function seg(over: Partial<ReviewImportSegmentView> = {}): ReviewImportSegmentView {
  return {
    id: "s1",
    ordinal: 0,
    segmentStart: "2026-01-01",
    segmentEnd: "2026-01-31",
    executionState: "PENDING",
    coverageState: "UNVERIFIED",
    coveredRows: null,
    rowsReconciled: false,
    superseded: false,
    parentSegmentId: null,
    ...over,
  };
}

describe("segmentUiState — the five operator-defined states", () => {
  it("PENDING + UNVERIFIED → 가져오기 전 (remaining)", () => {
    const s = segmentUiState("PENDING", "UNVERIFIED");
    expect(s.label).toBe("가져오기 전");
    expect(s.remaining).toBe(true);
  });
  it("ACTIVE → 가져오는 중 (remaining)", () => {
    expect(segmentUiState("ACTIVE", "UNVERIFIED").label).toBe("가져오는 중");
    expect(segmentUiState("ACTIVE", "UNVERIFIED").remaining).toBe(true);
  });
  it("COMPLETED + COVERED → 가져오기 완료 (not remaining)", () => {
    const s = segmentUiState("COMPLETED", "COVERED");
    expect(s.label).toBe("가져오기 완료");
    expect(s.remaining).toBe(false);
  });
  it("FAILED + UNVERIFIED → 다시 시도 필요 (remaining)", () => {
    const s = segmentUiState("FAILED", "UNVERIFIED");
    expect(s.label).toBe("다시 시도 필요");
    expect(s.remaining).toBe(true);
  });
  it("COMPLETED + MISSING → 가져올 수 없는 기간 (not remaining)", () => {
    const s = segmentUiState("COMPLETED", "MISSING");
    expect(s.label).toBe("가져올 수 없는 기간");
    expect(s.remaining).toBe(false);
  });
});

describe("action guards protect attempt history", () => {
  it("only an unattempted (PENDING+UNVERIFIED, not superseded) segment may be split/merged", () => {
    expect(isUnattempted(seg())).toBe(true);
    expect(isUnattempted(seg({ executionState: "COMPLETED", coverageState: "COVERED" }))).toBe(false);
    expect(isUnattempted(seg({ executionState: "FAILED" }))).toBe(false);
    expect(isUnattempted(seg({ superseded: true }))).toBe(false);
  });
  it("import is allowed unless superseded or currently active", () => {
    expect(canImport(seg())).toBe(true);
    expect(canImport(seg({ executionState: "FAILED" }))).toBe(true); // retry
    expect(canImport(seg({ executionState: "ACTIVE" }))).toBe(false);
    expect(canImport(seg({ superseded: true }))).toBe(false);
  });
  it("split/missing are allowed on remaining (PENDING/FAILED) segments only, never on covered/missing/active", () => {
    expect(canSplit(seg())).toBe(true);
    expect(canSplit(seg({ executionState: "FAILED" }))).toBe(true);
    expect(canSplit(seg({ executionState: "ACTIVE" }))).toBe(false);
    expect(canSplit(seg({ executionState: "COMPLETED", coverageState: "COVERED" }))).toBe(false);
    expect(canSplit(seg({ superseded: true }))).toBe(false);
    expect(canMarkMissing(seg())).toBe(true);
    expect(canMarkMissing(seg({ executionState: "COMPLETED", coverageState: "MISSING" }))).toBe(false);
  });
});

describe("honest coverage / health copy — never claims 100%", () => {
  const coverage: ReviewImportCoverageView = {
    covered: [{ start: "2026-01-01", end: "2026-02-28" }],
    missing: [{ start: "2025-11-01", end: "2025-11-30" }],
    remaining: [{ start: "2026-03-01", end: "2026-03-31" }],
    lastCoveredDate: "2026-02-28",
    coveredRows: 1234,
    coveredSegments: 2,
    remainingSegments: 1,
    missingSegments: 1,
  };

  it("summarises ranges + counts without any completeness percentage", () => {
    const lines = coverageSummary(coverage);
    const blob = JSON.stringify(lines);
    expect(blob).not.toContain("100%");
    expect(blob).not.toContain("전체");
    expect(lines.find((l) => l.label === "마지막 커버 날짜")?.value).toBe("2026-02-28");
    expect(lines.find((l) => l.label === "가져온 리뷰 수")?.value).toBe("1,234건");
  });

  it("a valid empty covered segment reads as covered-with-no-reviews, not an error", () => {
    const text = coveredRowsText(seg({ coverageState: "COVERED", coveredRows: 0 }));
    expect(text).toBe("리뷰 없음 (정상적으로 커버됨)");
  });

  it("a covered segment flags that total completeness is not yet reconciled", () => {
    const text = coveredRowsText(seg({ coverageState: "COVERED", coveredRows: 40, rowsReconciled: false }));
    expect(text).toContain("40건 커버됨");
    expect(text).toContain("대사 전");
  });

  it("health shows duplicate vs new vs failed distinctly and a next recommendation", () => {
    const health: ReviewImportHealthView = {
      lastCoveredDate: "2026-02-28",
      missingRanges: [],
      newCount: 10,
      duplicateCount: 3,
      failedCount: 1,
      nextRecommendedImport: "2026-03-01",
    };
    const lines = healthSummary(health);
    expect(lines.find((l) => l.label === "새로 추가")?.value).toBe("10건");
    expect(lines.find((l) => l.label === "이미 있던 리뷰")?.value).toBe("3건");
    expect(lines.find((l) => l.label === "실패")?.value).toBe("1건");
    expect(lines.find((l) => l.label === "다음 권장 가져오기")?.value).toBe("2026-03-01부터");
  });
});

describe("planStatusLabel", () => {
  it("maps each plan status", () => {
    expect(planStatusLabel("DRAFT")).toBe("가져오기 준비됨");
    expect(planStatusLabel("ACTIVE")).toBe("가져오는 중");
    expect(planStatusLabel("COMPLETED")).toBe("가져오기 완료");
    expect(planStatusLabel("ABANDONED")).toBe("중단됨");
  });
});
