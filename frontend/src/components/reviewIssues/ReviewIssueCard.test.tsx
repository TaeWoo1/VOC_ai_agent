// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewIssueCard } from "./ReviewIssueCard";
import type { IssueChangeView, ReviewIssueView } from "../../lib/types";

afterEach(cleanup);

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
    evidenceCount: 9,
    firstEvidenceOn: "2026-06-01",
    lastEvidenceOn: "2026-07-25",
    dominantProductId: null,
    dominantProductName: null,
    dismissed: false,
    extractorKind: "RULE_BASED",
    change: change(),
    ...partial,
  };
}

const noop = () => {};

describe("ReviewIssueCard", () => {
  it("shows the issue, its severity, its state and how much evidence there is", () => {
    render(<ReviewIssueCard issue={issue()} onAdvance={noop} onDismiss={noop} busy={false} />);

    expect(screen.getByText("배송 지연")).toBeInTheDocument();
    expect(screen.getByText("보통")).toBeInTheDocument();
    expect(screen.getByText("관찰 중")).toBeInTheDocument();
    expect(screen.getByText("관련 리뷰 9건")).toBeInTheDocument();
  });

  it("renders one badge per fired judgement, using the server's labels", () => {
    render(
      <ReviewIssueCard
        issue={issue({
          change: change({
            kinds: ["PERSISTENT", "CONCENTRATED"],
            labelsKo: ["계속 발생", "특정 상품 집중"],
          }),
        })}
        onAdvance={noop}
        onDismiss={noop}
        busy={false}
      />,
    );

    expect(screen.getByText("계속 발생")).toBeInTheDocument();
    expect(screen.getByText("특정 상품 집중")).toBeInTheDocument();
  });

  it("quantifies a surge with both numbers", () => {
    render(
      <ReviewIssueCard
        issue={issue({
          change: change({
            kinds: ["SURGING"],
            labelsKo: ["증가 중"],
            surgeWindowCount: 9,
            surgeBaselineWeekly: 2.1,
          }),
        })}
        onAdvance={noop}
        onDismiss={noop}
        busy={false}
      />,
    );

    expect(screen.getByText("최근 7일 9건 · 이전 8주 평균 주 2.1건")).toBeInTheDocument();
  });

  /** The card must never assert why something is happening. */
  it("suggests what to check for a concentrated issue and names no cause", () => {
    render(
      <ReviewIssueCard
        issue={issue({
          dominantProductId: "p1",
          dominantProductName: "몰딩 A",
          change: change({ kinds: ["CONCENTRATED"], labelsKo: ["특정 상품 집중"] }),
        })}
        onAdvance={noop}
        onDismiss={noop}
        busy={false}
      />,
    );

    expect(screen.getByText(/먼저 확인해 보세요/)).toBeInTheDocument();
    expect(screen.queryByText(/원인/)).not.toBeInTheDocument();
    expect(screen.queryByText(/때문/)).not.toBeInTheDocument();
  });

  it("offers no lifecycle action while there is nothing for the operator to do", () => {
    render(<ReviewIssueCard issue={issue()} onAdvance={noop} onDismiss={noop} busy={false} />);

    expect(screen.queryByRole("button", { name: "조치 시작" })).not.toBeInTheDocument();
    expect(screen.getByText(/근거가 모이지 않았/)).toBeInTheDocument();
    // 중요하지 않음 is always available: dismissing does not depend on the lifecycle.
    expect(screen.getByRole("button", { name: "중요하지 않음" })).toBeInTheDocument();
  });

  it("offers 조치 시작 from 확인 필요 and reports the click", async () => {
    const onAdvance = vi.fn();
    const needsReview = issue({ lifecycleState: "NEEDS_REVIEW", lifecycleLabelKo: "확인 필요" });
    render(
      <ReviewIssueCard issue={needsReview} onAdvance={onAdvance} onDismiss={noop} busy={false} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "조치 시작" }));
    expect(onAdvance).toHaveBeenCalledWith(needsReview);
  });

  it("offers 조치 완료로 기록 from 조치 중", () => {
    render(
      <ReviewIssueCard
        issue={issue({ lifecycleState: "ACTING", lifecycleLabelKo: "조치 중" })}
        onAdvance={noop}
        onDismiss={noop}
        busy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "조치 완료로 기록" })).toBeInTheDocument();
  });

  /**
   * The fence, at the surface. 해결됨 comes from observing quiet weeks after recorded remediation, so
   * no state may offer a button that declares it.
   */
  it("never offers a button that declares an issue resolved", () => {
    for (const state of ["OBSERVING", "NEEDS_REVIEW", "ACTING", "VERIFYING", "RESOLVED"] as const) {
      cleanup();
      render(
        <ReviewIssueCard
          issue={issue({ lifecycleState: state, lifecycleLabelKo: state })}
          onAdvance={noop}
          onDismiss={noop}
          busy={false}
        />,
      );
      for (const button of screen.getAllByRole("button")) {
        expect(button.textContent ?? "").not.toContain("해결");
      }
    }
  });

  it("describes 해결됨 as an observation rather than a disappearance", () => {
    render(
      <ReviewIssueCard
        issue={issue({ lifecycleState: "RESOLVED", lifecycleLabelKo: "해결됨" })}
        onAdvance={noop}
        onDismiss={noop}
        busy={false}
      />,
    );

    expect(screen.getByText(/확인되지 않아 현재 해결된 상태로 표시했어요/)).toBeInTheDocument();
    expect(screen.queryByText(/사라졌/)).not.toBeInTheDocument();
  });

  /**
   * Only the writes are locked. The 근거 리뷰 disclosure stays usable because it reads and changes
   * nothing — disabling it would stop an operator from checking the evidence for the very decision
   * they are in the middle of making.
   */
  it("disables the write controls while a write is in flight, but not the evidence toggle", () => {
    render(
      <ReviewIssueCard
        issue={issue({ lifecycleState: "NEEDS_REVIEW", lifecycleLabelKo: "확인 필요" })}
        onAdvance={noop}
        onDismiss={noop}
        busy
      />,
    );

    expect(screen.getByRole("button", { name: "조치 시작" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "중요하지 않음" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "근거 리뷰 보기" })).toBeEnabled();
  });

  it("offers 되돌리기 instead of 중요하지 않음 on a dismissed issue, and no lifecycle move", async () => {
    const onRestore = vi.fn();
    const target = issue({ lifecycleState: "NEEDS_REVIEW", lifecycleLabelKo: "확인 필요", dismissed: true });
    render(
      <ReviewIssueCard
        issue={target}
        onAdvance={noop}
        onDismiss={noop}
        onRestore={onRestore}
        busy={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "조치 시작" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "중요하지 않음" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(onRestore).toHaveBeenCalledWith(target);
  });

  it("keeps the evidence disclosure closed until asked", async () => {
    render(<ReviewIssueCard issue={issue()} onAdvance={noop} onDismiss={noop} busy={false} />);

    const toggle = screen.getByRole("button", { name: "근거 리뷰 보기" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "근거 리뷰 접기" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows no product line when nothing is attributable", () => {
    render(<ReviewIssueCard issue={issue()} onAdvance={noop} onDismiss={noop} busy={false} />);

    // Never "기타" or "미지정" — those read as a product the customer named.
    expect(screen.queryByText(/기타/)).not.toBeInTheDocument();
    expect(screen.queryByText(/미지정/)).not.toBeInTheDocument();
  });

  it("reports the dismissal click", async () => {
    const onDismiss = vi.fn();
    const target = issue();
    render(
      <ReviewIssueCard issue={target} onAdvance={noop} onDismiss={onDismiss} busy={false} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "중요하지 않음" }));
    expect(onDismiss).toHaveBeenCalledWith(target);
  });
});
