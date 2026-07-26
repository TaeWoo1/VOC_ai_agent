// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ReviewImportPlanDetail } from "./ReviewImportPlanDetail";
import { api } from "../../lib/apiClient";
import type {
  ReviewImportHealthView,
  ReviewImportPlanDetailView,
  ReviewImportSegmentView,
} from "../../lib/types";

function seg(over: Partial<ReviewImportSegmentView>): ReviewImportSegmentView {
  return {
    id: `s-${Math.random()}`,
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

const detail: ReviewImportPlanDetailView = {
  plan: {
    id: "p1",
    sellerAccountId: "a1",
    channelId: "c1",
    requestedStart: "2025-11-01",
    requestedEnd: "2026-03-31",
    status: "ACTIVE",
    createdAt: "2026-07-25T00:00:00Z",
  },
  segments: [
    seg({ segmentStart: "2025-11-01", segmentEnd: "2025-11-30", executionState: "COMPLETED", coverageState: "MISSING" }),
    seg({ segmentStart: "2025-12-01", segmentEnd: "2025-12-31", executionState: "COMPLETED", coverageState: "COVERED", coveredRows: 12 }),
    seg({ segmentStart: "2026-01-01", segmentEnd: "2026-01-31", executionState: "COMPLETED", coverageState: "COVERED", coveredRows: 0 }),
    seg({ segmentStart: "2026-02-01", segmentEnd: "2026-02-28", executionState: "FAILED", coverageState: "UNVERIFIED" }),
    seg({ segmentStart: "2026-03-01", segmentEnd: "2026-03-31", executionState: "PENDING", coverageState: "UNVERIFIED" }),
  ],
  nextSegmentId: null,
  coverage: {
    covered: [{ start: "2025-12-01", end: "2026-01-31" }],
    missing: [{ start: "2025-11-01", end: "2025-11-30" }],
    remaining: [{ start: "2026-02-01", end: "2026-03-31" }],
    lastCoveredDate: "2026-01-31",
    coveredRows: 12,
    coveredSegments: 2,
    remainingSegments: 2,
    missingSegments: 1,
  },
};

const health: ReviewImportHealthView = {
  lastCoveredDate: "2026-01-31",
  missingRanges: [{ start: "2025-11-01", end: "2025-11-30" }],
  newCount: 12,
  duplicateCount: 0,
  failedCount: 0,
  nextRecommendedImport: "2026-02-01",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewImportPlanDetail — resumable, honest state matrix", () => {
  it("renders every segment state with its seller-facing label, and highlights remaining work", async () => {
    vi.spyOn(api, "getReviewImportPlan").mockResolvedValue(detail);
    vi.spyOn(api, "getReviewImportHealth").mockResolvedValue(health);
    render(<ReviewImportPlanDetail planId="p1" accountId="a1" />);

    await waitFor(() => expect(screen.getByText(/과거 리뷰 가져오기 ·/)).toBeInTheDocument());

    // the five states resolve to their labels (some strings also appear as coverage-line labels)
    expect(screen.getAllByText("가져올 수 없는 기간").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("가져오기 완료").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("다시 시도 필요")).toBeInTheDocument();
    expect(screen.getByText("가져오기 전")).toBeInTheDocument();

    // a valid empty covered segment is honest, not an error
    expect(screen.getByText("리뷰 없음 (정상적으로 커버됨)")).toBeInTheDocument();

    // remaining work is surfaced after (re)load — the resume signal
    expect(screen.getByTestId("remaining-banner")).toBeInTheDocument();

    // health tallies distinguish new vs duplicate vs failed
    expect(screen.getByText("새로 추가")).toBeInTheDocument();
    expect(screen.getByText("다음 권장 가져오기")).toBeInTheDocument();
  });

  it("never claims a completeness percentage", async () => {
    vi.spyOn(api, "getReviewImportPlan").mockResolvedValue(detail);
    vi.spyOn(api, "getReviewImportHealth").mockResolvedValue(health);
    const { container } = render(<ReviewImportPlanDetail planId="p1" accountId="a1" />);
    await waitFor(() => expect(screen.getByText(/과거 리뷰 가져오기 ·/)).toBeInTheDocument());
    expect(container.textContent).not.toContain("100%");
  });

  it("fails closed when the plan read errors (never a calm empty)", async () => {
    vi.spyOn(api, "getReviewImportPlan").mockRejectedValue(new Error("down"));
    vi.spyOn(api, "getReviewImportHealth").mockRejectedValue(new Error("down"));
    render(<ReviewImportPlanDetail planId="p1" accountId="a1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/불러오지 못했어요/)).toBeInTheDocument();
  });

  it("shows a loading state while the read is in flight", () => {
    vi.spyOn(api, "getReviewImportPlan").mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, "getReviewImportHealth").mockReturnValue(new Promise(() => {}));
    render(<ReviewImportPlanDetail planId="p1" accountId="a1" />);
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
  });
});
