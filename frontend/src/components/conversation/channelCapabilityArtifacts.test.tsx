// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConversationTimeline } from "./ConversationTimeline";
import { ProgressView } from "./ProgressView";
import { agentTurn } from "../../test/conversationFixtures";

vi.mock("../../lib/apiClient", () => ({ api: {}, getToken: () => null }));

describe("channel-capability artifacts (D5)", () => {
  it("NOT_SUPPORTED renders as a SUMMARY sentence plus the next-action chips — no draft, no CTA", async () => {
    const onPrompt = vi.fn();
    const turn = agentTurn({
      message: "쿠팡에서는 판매자가 리뷰에 직접 답글을 남기는 기능을 지원하지 않습니다.",
      artifacts: [
        { artifactId: "s-1", type: "SUMMARY", title: "쿠팡 리뷰 답변", lines: ["쿠팡에서는 판매자가 리뷰에 직접 답글을 남기는 기능을 지원하지 않습니다."] },
      ],
      suggestedActions: [
        { label: "비슷한 리뷰 더 찾기", kind: "PROMPT", prompt: "비슷한 리뷰 더 찾아줘" },
        { label: "관련 문의 확인", kind: "PROMPT", prompt: "관련 문의 확인해줘" },
        { label: "상품 문제 조사", kind: "PROMPT", prompt: "상품 문제 조사해줘" },
        { label: "상세페이지 개선 검토", kind: "PROMPT", prompt: "상세페이지 개선 검토해줘" },
      ],
    });
    render(<MemoryRouter><ConversationTimeline turns={[turn]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={onPrompt} onResume={() => undefined} /></MemoryRouter>);
    expect(screen.getAllByText(/직접 답글을 남기는 기능을 지원하지 않습니다/).length).toBeGreaterThan(0);
    for (const name of ["비슷한 리뷰 더 찾기", "관련 문의 확인", "상품 문제 조사", "상세페이지 개선 검토"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // No draft, no CTA. (The transcript's own 「복사」 on the agent sentence is a chat control, not an action.)
    expect(screen.queryByRole("button", { name: /보내기|답변하기|초안 복사/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "관련 문의 확인" }));
    expect(onPrompt).toHaveBeenCalledWith("관련 문의 확인해줘");
  });

  it("the REFRESHING stage renders the runtime's own label, as reached", () => {
    render(
      <ProgressView
        stages={[
          { type: "stage", stage: "PLANNED", label: "요청을 이해했습니다", at: "x" },
          { type: "stage", stage: "REFRESHING", label: "카페24 리뷰를 새로 가져오고 있습니다", at: "x" },
        ]}
        elapsed={4}
      />,
    );
    expect(screen.getByText("카페24 리뷰를 새로 가져오고 있습니다")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("4초");
  });

  /**
   * <b>One step card per turn</b> — Chat-first Operating Experience v3.
   *
   * The runtime still raises a step per stale channel, and every one of them is true. Stacking them under a
   * single answer is what turned a reply into a status board: measured on the real Demo Org, 2026-09-02, an
   * ordinary NAVER follow-up arrived with a Cafe24 freshness footer and a COUPANG card beside it — three
   * marketplaces in a conversation about one. The transcript keeps the one the thread is about; the channel
   * screen still holds them all.
   */
  it("renders ONE step card for the thread's channel, and keeps the chip", () => {
    const base = { type: "HUMAN_ACTION_REQUIRED" as const, actionType: "REVIEW_IMPORT" as const, reason: "FRESHNESS_UNPROVEN" as const, dataType: "REVIEW" as const, requestedAt: "x", resumable: true, to: null };
    const turn = agentTurn({
      artifacts: [
        { ...base, artifactId: "h-nv", title: "네이버", path: "EXPORT_ACTION_WINDOW", channelCode: "NAVER", channelNameKo: "네이버", accountId: "acc-nv", requiresLocalAgent: true, fallback: { path: "FILE_UPLOAD", to: "/connect/upload", label: "파일로 올리기" } },
        { ...base, artifactId: "h-cp", title: "쿠팡", path: "WING_READ_ACTION_WINDOW", channelCode: "COUPANG", channelNameKo: "쿠팡", accountId: "acc-cp", requiresLocalAgent: true },
      ],
      suggestedActions: [{ label: "일단 확인된 리뷰 보기", kind: "PROMPT", prompt: "지금까지 확인된 리뷰 보여줘" }],
      status: "WAITING_HUMAN",
    });
    render(<MemoryRouter><ConversationTimeline turns={[turn]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={() => undefined} onResume={() => undefined} /></MemoryRouter>);
    const cards = screen.getAllByTestId("human-action-artifact");
    expect(cards).toHaveLength(1);
    // With no earlier object naming a channel, the turn keeps the first card it raised.
    expect(cards[0]!.textContent).toContain("네이버");
    expect(screen.getByRole("button", { name: "일단 확인된 리뷰 보기" })).toBeInTheDocument();
  });
});
