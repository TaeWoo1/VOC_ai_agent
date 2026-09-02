// @vitest-environment jsdom
/**
 * **The transcript is a conversation, not an accumulating table.**
 * — Chat-first Operating Experience v3, measured on the real Demo Org, 2026-09-02.
 *
 * Four turns of ordinary use left 144 rows and 82 controls on one screen. Nothing was wrong with any single
 * turn: each printed the list it was answering with, and no turn ever put its list away. The answer to the
 * question the seller is asking now arrived underneath three lists they had already read.
 *
 * Two rules, and both keep every fact reachable:
 *
 *  1. a list answers with a HEAD and offers the rest (`headRows.ts`);
 *  2. a turn that is no longer the latest folds its list to one line that still states the count.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConversationTimeline, domainsAsked, precedingUserText, secondaryCollections } from "./ConversationTimeline";
import { agentTurn } from "../../test/conversationFixtures";

vi.mock("../../lib/apiClient", () => ({ api: {}, getToken: () => null }));

function reviews(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    reviewId: `r-${i}`,
    accountId: "acc-nv",
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    writtenOn: "2026-08-31",
    rating: 5,
    negative: false,
    preview: `리뷰 본문 ${i}`,
    productId: "p-1",
    productName: "선바로 전선몰딩",
    to: "/reviews",
  }));
}

const reviewList = (id: string, n: number) => ({
  artifactId: id,
  type: "REVIEW_LIST" as const,
  title: "최근 리뷰",
  items: reviews(n),
  freshness: [],
  scope: { period: null, channelCode: "NAVER", rating: "ALL" as const },
  totalCount: n,
});

describe("transcript density", () => {
  it("a list answers with four rows and offers the rest", async () => {
    const turn = agentTurn({ message: "최근 리뷰입니다.", artifacts: [reviewList("a", 24)] });
    render(<MemoryRouter><ConversationTimeline turns={[turn]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={() => undefined} onResume={() => undefined} /></MemoryRouter>);

    expect(screen.getAllByText(/리뷰 본문/)).toHaveLength(4);
    const more = screen.getByRole("button", { name: "리뷰 20건 더 보기" });
    await userEvent.click(more);
    expect(screen.getAllByText(/리뷰 본문/)).toHaveLength(24);
  });

  it("an OLDER turn folds its list to one line, and the count is still stated", async () => {
    const older = agentTurn({ turnId: "t1", message: "최근 리뷰입니다.", artifacts: [reviewList("a", 24)] });
    const latest = agentTurn({ turnId: "t2", message: "이 상품이 반복해서 문제입니다." });
    render(<MemoryRouter><ConversationTimeline turns={[older, latest]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={() => undefined} onResume={() => undefined} /></MemoryRouter>);

    // The older turn's answer is still there; its rows are not.
    expect(screen.getByText("최근 리뷰입니다.")).toBeInTheDocument();
    expect(screen.queryByText(/리뷰 본문/)).toBeNull();
    const fold = screen.getByRole("button", { name: "리뷰 24건 다시 보기" });
    await userEvent.click(fold);
    // Nothing was lost — it was put away.
    expect(screen.getAllByText(/리뷰 본문/).length).toBeGreaterThan(0);
  });

  it("leaves a short list alone — folding three rows into 'three rows' saves nothing", () => {
    const older = agentTurn({ turnId: "t1", message: "최근 리뷰입니다.", artifacts: [reviewList("a", 3)] });
    const latest = agentTurn({ turnId: "t2", message: "다음 질문에 답합니다." });
    render(<MemoryRouter><ConversationTimeline turns={[older, latest]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={() => undefined} onResume={() => undefined} /></MemoryRouter>);

    expect(screen.getAllByText(/리뷰 본문/)).toHaveLength(3);
  });
});

describe("§4 — one primary object collection per turn", () => {
  it("folds every collection after the first when the seller asked one question", () => {
    const two = [{ type: "REVIEW_LIST" }, { type: "EVIDENCE" }, { type: "INQUIRY_LIST" }];
    expect([...secondaryCollections(two, domainsAsked("최근 리뷰 보여줘"))]).toEqual([2]);
    // A sentence that named two domains asked for two; nothing folds.
    expect([...secondaryCollections(two, domainsAsked("리뷰랑 문의 둘 다 보여줘"))]).toEqual([]);
    // One collection is never secondary, whatever else the turn drew.
    expect([...secondaryCollections([{ type: "SUMMARY" }, { type: "REVIEW_LIST" }, { type: "DRAFT" }], 1)]).toEqual([]);
  });

  it("counts the domains a sentence NAMES, never the ones an answer happened to draw", () => {
    expect(domainsAsked("오늘 리뷰 있어?")).toBe(1);
    expect(domainsAsked("리뷰랑 문의 정리해줘")).toBe(2);
    expect(domainsAsked("뭐부터 봐야 해?")).toBe(0);
  });

  it("reads the sentence a turn is answering backwards, so a resumed turn keeps the original ask", () => {
    const turns = [
      { turnId: "u1", role: "USER", text: "오늘 리뷰 있어?" },
      { turnId: "a1", role: "AGENT", text: null },
      { turnId: "a2", role: "AGENT", text: null },
    ] as never;
    expect(precedingUserText(turns, 2)).toBe("오늘 리뷰 있어?");
    expect(precedingUserText(turns, 0)).toBe("");
  });
});
