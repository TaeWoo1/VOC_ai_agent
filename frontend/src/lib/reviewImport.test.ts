import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IMPORT_STAGE_COPY,
  RANGE_CHOICE_COPY,
  RECHECK_FALLBACK_LABEL,
  agentAvailabilityCopy,
  agentAvailabilityFromBridgePhase,
  buildImportGuidancePack,
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
  monthOptions,
  nextRemainingSegment,
  rangeChoiceSummary,
  recheckLabel,
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
  /**
   * The MOST RECENT month first (product-owner decision, 2026-07-26), reversing the original oldest-first order.
   *
   * A plan can be 37 exports the seller performs by hand and they may stop part-way: the recent months hold the
   * reviews that still need answering, so whoever abandons a plan half-done keeps the half that matters. Must
   * match the backend's own `nextRemainingSegment`, or this card names one month while the ticket authorizes
   * another.
   */
  it("picks the most recent segment still needing work", () => {
    const later = seg({ segmentStart: "2026-04-01", segmentEnd: "2026-04-30" });
    const earlier = seg({ segmentStart: "2026-03-01", segmentEnd: "2026-03-31" });
    expect(nextRemainingSegment([later, earlier])?.segmentStart).toBe("2026-04-01");
    expect(nextRemainingSegment([earlier, later])?.segmentStart).toBe("2026-04-01");
  });

  /** A covered newest month must not stall the plan: the next remaining one is still offered. */
  it("walks backwards past months that are already covered", () => {
    const covered = seg({ segmentStart: "2026-04-01", segmentEnd: "2026-04-30", executionState: "COMPLETED", coverageState: "COVERED" });
    const remaining = seg({ segmentStart: "2026-03-01", segmentEnd: "2026-03-31" });
    expect(nextRemainingSegment([remaining, covered])?.segmentStart).toBe("2026-03-01");
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

  /**
   * Drift guard across the stack boundary.
   *
   * The Runtime sends dotted semantic keys and the FE owns every word (contract §6), which means a key added
   * to a runtime step plan with no entry here does not break anything visibly — it silently degrades the
   * seller's guidance to "다음 안내를 따라 주세요" at the exact step that needed instructions. Read from the
   * runtime's own source so adding a step cannot pass this file by.
   */
  it("has copy for every step key the runtime's plans publish", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = ["../../../collector/src/naver/import-guidance-plan.ts"].map((rel) =>
      readFileSync(resolve(here, rel), "utf8"),
    );
    const keys = new Set(
      sources.flatMap((source) => [...source.matchAll(/"(actionWindow\.import[A-Za-z]*\.[A-Za-z]+)"/g)].map((m) => m[1]!)),
    );
    expect(keys.size).toBeGreaterThan(5);
    for (const key of keys) {
      expect(Object.keys(IMPORT_STAGE_COPY), key).toContain(key);
    }
  });

  /**
   * The `importDiscovery.*` keys are gone, and their absence is the fix for finding 16 rather than a rewording.
   *
   * They described a run that asked the seller to find the earliest date NAVER's calendar allowed — a limit the
   * 2026-07-25 live run established does not exist. If one of those keys ever reappears here, the concept has
   * come back with it.
   */
  it("has no copy for the retired range-discovery run", () => {
    const discoveryKeys = Object.keys(IMPORT_STAGE_COPY).filter((k) => k.startsWith("actionWindow.importDiscovery."));
    expect(discoveryKeys).toEqual([]);
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

/* ─────────────────── "다시 확인" is not one sentence ─────────────────── */

describe("recheckLabel", () => {
  /**
   * On the 2026-07-25 live run the operator was told to press a button labelled 확인 완료 and could not match it
   * to anything they had just done. The command means "I did the thing — look again", so the label has to name
   * the thing.
   */
  it("names what the seller just did, per step", () => {
    expect(recheckLabel({ copyKey: "actionWindow.import.setStartDate" })).toBe("시작일 입력했어요");
    expect(recheckLabel({ copyKey: "actionWindow.import.export" })).toBe("엑셀 다운로드 눌렀어요");
    expect(recheckLabel({ copyKey: "actionWindow.import.consent" })).toBe("확인 눌렀어요");
  });

  /**
   * A stop at the scope gate is nominally still "the end date step", but what the seller has to do is fix the
   * dates — so the blocker wins over the step.
   */
  it("describes the repair when the run is blocked, not the step it is sitting at", () => {
    expect(recheckLabel({ copyKey: "actionWindow.import.setEndDate", blockerCode: "SCOPE_MISMATCH" })).toBe(
      "날짜 다시 확인",
    );
  });

  it("falls back to a label that is true of every barrier", () => {
    expect(recheckLabel({})).toBe(RECHECK_FALLBACK_LABEL);
    expect(recheckLabel({ copyKey: "actionWindow.import.ingest" })).toBe(RECHECK_FALLBACK_LABEL);
    // Never claims the step is done — the runtime alone decides that, by observing.
    expect(RECHECK_FALLBACK_LABEL).not.toMatch(/완료/);
  });
});

/* ─────────────────── the words the marketplace-side panel renders ─────────────────── */

describe("buildImportGuidancePack", () => {
  /**
   * Guidance moved into the seller's SmartStore window, so these sentences are read there. Copy ownership did
   * NOT move: this function is where the words live, and the runtime does lookup and substitution only.
   */
  it("carries a sentence for every step the segment runtime publishes", () => {
    const pack = buildImportGuidancePack();
    for (const key of Object.keys(IMPORT_STAGE_COPY)) {
      expect(pack.steps[key], key).toBe(IMPORT_STAGE_COPY[key]);
    }
  });

  it("names the product, so a panel on someone else's site says whose it is", () => {
    expect(buildImportGuidancePack().chrome.product).toContain("SellerOps");
  });

  /** The templates the runtime substitutes ITS facts into: neither side can produce these lines alone. */
  it("leaves the runtime's own numbers and dates as placeholders", () => {
    const pack = buildImportGuidancePack();
    expect(pack.chrome.stepCounter).toContain("{step}");
    expect(pack.chrome.stepCounter).toContain("{total}");
    expect(pack.chrome.requiredRange).toContain("{start}");
    expect(pack.chrome.requiredRange).toContain("{end}");
  });

  /** A stopped run owes the seller two things: what is wrong, and the one action that clears it. */
  it("states both the cause and the repair for a scope mismatch", () => {
    const blocker = buildImportGuidancePack().blockers.SCOPE_MISMATCH!;
    expect(blocker.title).toContain("기간");
    expect(blocker.fix).toMatch(/날짜/);
  });

  it("offers only the two controls a seller has decisions about", () => {
    const pack = buildImportGuidancePack();
    expect(Object.keys(pack.commands).sort()).toEqual(["CANCEL_RUN", "REQUEST_STEP_RECHECK"]);
  });

  it("carries the situation-specific recheck wording the panel resolves against", () => {
    const pack = buildImportGuidancePack();
    expect(pack.recheck.byBlocker.SCOPE_MISMATCH).toBe("날짜 다시 확인");
    expect(pack.recheck.byStep["actionWindow.import.export"]).toBe("엑셀 다운로드 눌렀어요");
    expect(pack.recheck.fallback).toBe(RECHECK_FALLBACK_LABEL);
  });

  /** Nothing in the pack may carry an identifier, a path, or markup into someone else's page. */
  it("contains no dotted copy key, selector, or markup as VALUES", () => {
    const values = JSON.stringify(buildImportGuidancePack());
    expect(values).not.toMatch(/<[a-z]/i);
    expect(values).not.toMatch(/https?:\/\//);
  });
});

/* ─────────────────── the seller's own range choice ─────────────────── */

describe("monthOptions", () => {
  it("lists months newest first, starting from the given month", () => {
    const options = monthOptions("2026-07", 3);
    expect(options.map((o) => o.value)).toEqual(["2026-07", "2026-06", "2026-05", "2026-04"]);
    expect(options[0]!.label).toBe("2026년 7월");
  });

  it("rolls back across a year boundary", () => {
    expect(monthOptions("2026-02", 3).map((o) => o.value)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });

  it("stops at the earliest selectable year rather than listing forever", () => {
    const options = monthOptions("2010-03", 60);
    expect(options[options.length - 1]!.value).toBe("2010-01");
  });

  it("returns nothing for an unusable month rather than guessing one", () => {
    expect(monthOptions("nonsense")).toEqual([]);
    expect(monthOptions("2026-13")).toEqual([]);
  });
});

describe("rangeChoiceSummary", () => {
  /**
   * The period AND its cost, always together: three years reads like one click and is 37 exports the seller
   * performs by hand. Agreeing to a period without seeing that is agreeing to work nobody mentioned.
   */
  it("states the period and how many monthly exports it becomes", () => {
    expect(rangeChoiceSummary({ start: "2023-07-01", end: "2026-07-26", segmentCount: 37 })).toBe(
      "2023-07-01 ~ 2026-07-26 · 37개 구간",
    );
  });

  /** Nothing on this screen claims the marketplace limits anything — that was the concept finding 16 removed. */
  it("asks about depth, never about what the marketplace allows", () => {
    const words = `${RANGE_CHOICE_COPY.title} ${RANGE_CHOICE_COPY.body} ${RANGE_CHOICE_COPY.monthLabel}`;
    expect(words).not.toMatch(/가져올 수 있는|선택할 수 있는|가능한 기간|최대/);
    expect(RANGE_CHOICE_COPY.body).toMatch(/오늘까지/);
  });
});
