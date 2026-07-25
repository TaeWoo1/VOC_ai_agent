import { describe, expect, it } from "vitest";
import {
  IMPORT_STAGE_COPY,
  agentAvailabilityCopy,
  agentAvailabilityFromBridgePhase,
  canImport,
  canMarkMissing,
  canSplit,
  completionSummaryText,
  coverageSummary,
  coveredRowsText,
  healthSummary,
  importProgress,
  importStageText,
  isUnattempted,
  nextRemainingSegment,
  planStatusLabel,
  primaryActionLabel,
  scopeEvidenceLabel,
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

/* ─────────── The corrected guided flow (과거 리뷰 전체 연동하기) ─────────── */

describe("importProgress", () => {
  it("reads N개 구간 중 M개 완료", () => {
    const p = importProgress([
      seg({ executionState: "COMPLETED", coverageState: "COVERED" }),
      seg(),
      seg(),
    ]);
    expect(p).toEqual({ done: 1, total: 3, text: "3개 구간 중 1개 완료" });
  });

  // A concluded-unreachable month needs no more work; leaving it "remaining" would mean an import that can
  // never finish.
  it("counts a concluded MISSING segment as done", () => {
    expect(importProgress([seg({ executionState: "COMPLETED", coverageState: "MISSING" })]).done).toBe(1);
  });

  // A split parent was replaced by its children; counting it inflates both numbers and makes a finished
  // import look unfinished.
  it("excludes superseded split parents from both numbers", () => {
    const p = importProgress([
      seg({ superseded: true, executionState: "COMPLETED", coverageState: "COVERED" }),
      seg({ segmentStart: "2026-03-01", segmentEnd: "2026-03-15" }),
      seg({ segmentStart: "2026-03-16", segmentEnd: "2026-03-31" }),
    ]);
    expect(p).toEqual({ done: 0, total: 2, text: "2개 구간 중 0개 완료" });
  });

  it("handles an empty plan without dividing by anything", () => {
    expect(importProgress([])).toEqual({ done: 0, total: 0, text: "0개 구간 중 0개 완료" });
  });
});

describe("nextRemainingSegment", () => {
  it("picks the earliest segment still needing work", () => {
    const later = seg({ segmentStart: "2026-04-01", segmentEnd: "2026-04-30" });
    const earlier = seg({ segmentStart: "2026-03-01", segmentEnd: "2026-03-31" });
    expect(nextRemainingSegment([later, earlier])?.segmentStart).toBe("2026-03-01");
  });

  it("offers a FAILED segment again (retry is the normal recovery)", () => {
    expect(nextRemainingSegment([seg({ executionState: "FAILED" })])).not.toBeNull();
  });

  it("skips covered, missing, superseded, and in-flight segments", () => {
    expect(
      nextRemainingSegment([
        seg({ executionState: "COMPLETED", coverageState: "COVERED" }),
        seg({ executionState: "COMPLETED", coverageState: "MISSING" }),
        seg({ superseded: true }),
        seg({ executionState: "ACTIVE" }),
      ]),
    ).toBeNull();
  });
});

describe("primaryActionLabel", () => {
  it("offers the full import first, then resuming", () => {
    expect(primaryActionLabel(false)).toBe("과거 리뷰 전체 연동하기");
    expect(primaryActionLabel(true)).toBe("계속 가져오기");
  });
});

describe("agentAvailabilityCopy", () => {
  it("allows guiding only when the agent is actually ready", () => {
    expect(agentAvailabilityCopy("ready").canGuide).toBe(true);
    for (const s of ["not_running", "unpaired", "wrong_carrier", "incompatible"] as const) {
      expect(agentAvailabilityCopy(s).canGuide).toBe(false);
    }
  });

  // "the agent isn't running" and "you never connected it" need different fixes; collapsing them into
  // "offline" is what leaves a seller staring at a button that does nothing.
  it("gives each unavailable state its own explanation and offers the fallback", () => {
    const states = ["not_running", "unpaired", "wrong_carrier", "incompatible"] as const;
    const messages = states.map((s) => agentAvailabilityCopy(s).message);
    expect(new Set(messages).size).toBe(states.length);
    for (const m of messages) expect(m).not.toBe("");
    for (const s of states) expect(agentAvailabilityCopy(s).offerFallback).toBe(true);
  });

  it("does not push the fallback when guiding works", () => {
    expect(agentAvailabilityCopy("ready").offerFallback).toBe(false);
  });
});

describe("importStageText", () => {
  it("maps every guided stage key to Korean copy", () => {
    for (const key of Object.keys(IMPORT_STAGE_COPY)) {
      expect(importStageText(key)).toMatch(/[가-힣]/);
    }
  });

  it("degrades an unknown key to a neutral line, never a raw dotted key", () => {
    const text = importStageText("actionWindow.import.somethingNew");
    expect(text).not.toContain("actionWindow");
    expect(text).toMatch(/[가-힣]/);
  });

  it("asks the seller to press every marketplace control themselves", () => {
    for (const key of ["actionWindow.import.export", "actionWindow.import.consent"]) {
      expect(importStageText(key)).toMatch(/눌러 주세요/);
    }
  });
});

describe("scopeEvidenceLabel", () => {
  // The whole point: a seller's confirmation is described as theirs. Calling it verification would claim
  // SellerOps checked something it could not read.
  it("never describes an operator confirmation as a SellerOps check", () => {
    expect(scopeEvidenceLabel("OPERATOR_CONFIRMED")).not.toContain("SellerOps");
    expect(scopeEvidenceLabel("MACHINE_MATCHED")).toContain("SellerOps");
  });

  it("says nothing was recorded when evidence is absent", () => {
    expect(scopeEvidenceLabel(null)).toBe("확인 방법 기록 없음");
  });
});

describe("completionSummaryText", () => {
  it("claims only the selectable periods — never every review NAVER holds", () => {
    const text = completionSummaryText({ done: 3, total: 3, text: "3개 구간 중 3개 완료" });
    expect(text).toBe("NAVER에서 현재 선택 가능한 기간의 리뷰 파일을 가져왔습니다.");
    expect(text).not.toMatch(/100%|모든 리뷰|전체 리뷰/);
  });

  it("says work remains rather than implying completion", () => {
    expect(completionSummaryText({ done: 1, total: 3, text: "3개 구간 중 1개 완료" })).toContain("남은 구간");
  });

  it("handles a plan with no segments honestly", () => {
    expect(completionSummaryText({ done: 0, total: 0, text: "0개 구간 중 0개 완료" })).toBe("가져올 구간이 없어요.");
  });
});

describe("agentAvailabilityFromBridgePhase", () => {
  it("only a paired agent can host a guided run", () => {
    expect(agentAvailabilityFromBridgePhase("paired")).toBe("ready");
  });

  it("groups every pairing-side phase as needing connection", () => {
    for (const p of ["unpaired", "pairing_pending", "pairing_denied", "revoked"]) {
      expect(agentAvailabilityFromBridgePhase(p)).toBe("unpaired");
    }
  });

  it("reports a version mismatch as its own problem, not as 'not running'", () => {
    expect(agentAvailabilityFromBridgePhase("incompatible_version")).toBe("incompatible");
  });

  // While we do not yet know, withholding the CTA is honest; it resolves within a poll.
  it("withholds the guided CTA while still connecting, and for any unknown phase", () => {
    for (const p of ["connecting", "connecting_ws", "unreachable", "disconnected", "something_new"]) {
      expect(agentAvailabilityFromBridgePhase(p)).toBe("not_running");
      expect(agentAvailabilityCopy(agentAvailabilityFromBridgePhase(p)).canGuide).toBe(false);
    }
  });
});
