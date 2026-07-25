// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewIssueSection } from "./ReviewIssueSection";
import { api } from "../../lib/apiClient";
import type { IssueChangeView, ReviewIssueView } from "../../lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function change(partial: Partial<IssueChangeView> = {}): IssueChangeView {
  return {
    kinds: [],
    labelsKo: [],
    highSurge: false,
    surgeWindowCount: 0,
    surgeBaselineWeekly: 0,
    ...partial,
  };
}

function issue(partial: Partial<ReviewIssueView> = {}): ReviewIssueView {
  return {
    id: "issue-1",
    title: "배송 지연",
    aspect: "배송",
    problem: "지연",
    severity: "NORMAL",
    lifecycleState: "OBSERVING",
    lifecycleLabelKo: "관찰 중",
    evidenceCount: 4,
    firstEvidenceOn: "2026-07-01",
    lastEvidenceOn: "2026-07-25",
    dominantProductId: null,
    dominantProductName: null,
    dismissed: false,
    extractorKind: "RULE_BASED",
    change: change(),
    ...partial,
  };
}

/** Answers the working list with `working` and the dismissed list with `archived`. */
function stubList(working: ReviewIssueView[], archived: ReviewIssueView[] = []) {
  return vi
    .spyOn(api, "getReviewIssuesStrict")
    .mockImplementation(async (options = {}) =>
      options.dismissed ? archived : working,
    );
}

describe("ReviewIssueSection", () => {
  it("shows the header counts and the honest provenance line", async () => {
    stubList([
      issue({ id: "a", lifecycleState: "NEEDS_REVIEW", change: change({ kinds: ["SURGING"], labelsKo: ["증가 중"] }) }),
      issue({ id: "b" }),
    ]);
    render(<ReviewIssueSection />);

    await waitFor(() =>
      expect(screen.getByText(/반복 이슈 2건/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/확인 필요 1건/)).toBeInTheDocument();
    expect(screen.getByText(/변화 있음 1건/)).toBeInTheDocument();
    // Never "AI" — the extractor is rule-based and its accuracy is unmeasured.
    expect(screen.getByText(/규칙 기반/)).toBeInTheDocument();
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
  });

  /**
   * This section answers "has something changed in what customers are telling you". A seeded
   * placeholder would be a fabricated answer the operator could not distinguish from a real one.
   */
  it("fails closed on a backend error rather than rendering anything reassuring", async () => {
    vi.spyOn(api, "getReviewIssuesStrict").mockRejectedValue(new Error("boom"));
    render(<ReviewIssueSection />);

    await waitFor(() =>
      expect(screen.getByText(/불러오지 못했습니다/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/변화는 확인되지 않았습니다/)).not.toBeInTheDocument();
  });

  it("says reviews are still needed rather than implying nothing is wrong", async () => {
    stubList([]);
    render(<ReviewIssueSection />);

    await waitFor(() =>
      expect(screen.getByText(/아직 반복되는 고객 문제가 모이지 않았습니다/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/리뷰가 더 모이면/)).toBeInTheDocument();
  });

  it("separates improvements from things to look at", async () => {
    stubList([
      issue({ id: "a", title: "배송 지연", change: change({ kinds: ["SURGING"], labelsKo: ["증가 중"] }) }),
      issue({ id: "b", title: "색상 불일치", change: change({ kinds: ["IMPROVED"], labelsKo: ["개선됨"] }) }),
      issue({ id: "c", title: "포장 파손" }),
    ]);
    render(<ReviewIssueSection />);

    await waitFor(() => expect(screen.getByText("개선된 문제")).toBeInTheDocument());
    expect(screen.getByText("지금 확인할 변화")).toBeInTheDocument();
    expect(screen.getByText("관리 중인 이슈")).toBeInTheDocument();
    // An improvement is not counted as something to look at.
    expect(screen.getByText(/변화 있음 1건/)).toBeInTheDocument();
  });

  it("refetches after a lifecycle move instead of patching state locally", async () => {
    const list = stubList([
      issue({ id: "a", lifecycleState: "NEEDS_REVIEW", lifecycleLabelKo: "확인 필요" }),
    ]);
    const start = vi.spyOn(api, "startReviewIssueAction").mockResolvedValue(issue());
    render(<ReviewIssueSection />);

    await waitFor(() => expect(screen.getByRole("button", { name: "조치 시작" })).toBeInTheDocument());
    const callsBefore = list.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "조치 시작" }));

    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(start).toHaveBeenCalledWith("a");
  });

  /** A card that showed 조치 중 after a failed write would misreport what SellerOps recorded. */
  it("reports a failed write and does not move the card", async () => {
    stubList([issue({ id: "a", lifecycleState: "NEEDS_REVIEW", lifecycleLabelKo: "확인 필요" })]);
    vi.spyOn(api, "startReviewIssueAction").mockRejectedValue(new Error("nope"));
    render(<ReviewIssueSection />);

    await waitFor(() => expect(screen.getByRole("button", { name: "조치 시작" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "조치 시작" }));

    await waitFor(() =>
      expect(screen.getByText(/상태를 변경하지 못했습니다/)).toBeInTheDocument(),
    );
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
  });

  /**
   * Dismissal has to be undoable. The row survives on purpose so the next extraction does not
   * recreate it and announce it as new — which means without this list the operator could never
   * reach it again.
   */
  it("lists dismissed issues separately and can restore one", async () => {
    stubList([issue({ id: "a" })], [issue({ id: "z", title: "가격 부족", dismissed: true })]);
    const restore = vi.spyOn(api, "restoreReviewIssue").mockResolvedValue(issue());
    render(<ReviewIssueSection />);

    await waitFor(() =>
      expect(screen.getByText(/중요하지 않음으로 표시한 이슈 1건/)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(restore).toHaveBeenCalledWith("z");
  });

  it("does not offer 되돌리기 on the working list", async () => {
    stubList([issue({ id: "a" })]);
    render(<ReviewIssueSection />);

    await waitFor(() => expect(screen.getByText("배송 지연")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "되돌리기" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "중요하지 않음" })).toBeInTheDocument();
  });

  /** An archive that fails to load must not take down the working list. */
  it("still renders the working list when the dismissed list fails", async () => {
    vi.spyOn(api, "getReviewIssuesStrict").mockImplementation(async (options = {}) => {
      if (options.dismissed) {
        throw new Error("archive down");
      }
      return [issue({ id: "a" })];
    });
    render(<ReviewIssueSection />);

    await waitFor(() => expect(screen.getByText("배송 지연")).toBeInTheDocument());
    expect(screen.queryByText(/중요하지 않음으로 표시한 이슈/)).not.toBeInTheDocument();
  });

  it("loads evidence only when asked", async () => {
    stubList([issue({ id: "a" })]);
    const detail = vi.spyOn(api, "getReviewIssueDetailStrict").mockResolvedValue({
      issue: issue({ id: "a" }),
      evidence: [
        {
          reviewId: "r1",
          unitOrdinal: 1,
          occurredOn: "2026-07-25",
          productId: null,
          productName: null,
          rating: 5,
          quote: "배송이 늦었어요",
        },
        {
          reviewId: "r2",
          unitOrdinal: 0,
          occurredOn: "2026-07-20",
          productId: null,
          productName: null,
          rating: 5,
          quote: null,
        },
      ],
      history: [],
    });
    render(<ReviewIssueSection />);

    await waitFor(() => expect(screen.getByText("배송 지연")).toBeInTheDocument());
    expect(detail).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "근거 리뷰 보기" }));

    await waitFor(() => expect(screen.getByText("“배송이 늦었어요”")).toBeInTheDocument());
    // The suppressed row is counted, never rendered as an empty quote.
    expect(screen.getByText(/1건은 개인정보 보호를 위해 표시하지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByText(/근거 리뷰 2건/)).toBeInTheDocument();
  });
});
