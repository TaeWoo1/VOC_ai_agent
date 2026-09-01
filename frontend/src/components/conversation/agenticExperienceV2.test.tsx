// @vitest-environment jsdom
/**
 * Agentic Experience + UI/UX v2 — the screen half.
 *
 * §2 the run's limits are rendered APART from its answer · §5 a ranked list opens the row it judged
 * first · §3 a review row is an object that opens in place · §6 a card whose title the sentence
 * already said draws no header, and a word every row shares is said once.
 *
 * Every assertion is about what the seller READS. Nothing here asserts a sentence a model wrote —
 * none of these sentences is written by one.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConversationTimeline } from "./ConversationTimeline";
import { ReviewListArtifact } from "./artifacts/ReviewListArtifact";
import type { DisplayTurn } from "../../lib/conversation/ConversationProvider";
import type { InquiryListArtifact, ReviewListArtifact as ReviewList } from "../../lib/conversation/types";

vi.mock("../../lib/apiClient", () => ({
  api: { getInquiryDetailStrict: vi.fn().mockResolvedValue({ details: "고객이 쓴 문장입니다.", draft: null }) },
}));
// A row is a focusable object only inside a conversation; outside one it is a plain link and there is
// nothing to expand. These tests are about the expansion, so the surrounding conversation is present.
vi.mock("../../lib/conversation/ConversationProvider", () => ({
  useConversation: () => ({ workingSet: null, selectEntity: vi.fn(async () => undefined) }),
}));

function shell(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

function turn(over: Partial<DisplayTurn> = {}): DisplayTurn {
  return {
    turnId: "t-1", conversationId: "c-1", role: "AGENT", message: "확인했습니다.", artifacts: [],
    suggestedActions: [], status: "DONE", createdAt: "2026-09-01T00:00:00Z",
    continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
    ...over,
  } as DisplayTurn;
}

function timeline(t: DisplayTurn) {
  return shell(
    <ConversationTimeline turns={[t]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={() => {}} onResume={() => {}} />,
  );
}

function rankedList(): InquiryListArtifact {
  return {
    artifactId: "a-1", type: "INQUIRY_LIST", title: "먼저 볼 문의", totalCount: 2,
    scope: { period: null, channelCode: null, status: "UNANSWERED", order: "OLDEST", limit: 2, rank: "URGENCY" },
    groups: [{
      key: "UNANSWERED", label: "답변 필요",
      items: [
        { workItemId: "w-1", inquiryId: "i-1", channelCode: "CAFE24", channelNameKo: "카페24", receivedAt: "2026-07-23T00:00:00Z",
          phase: "OPEN", status: "UNANSWERED", title: "현금영수증 발행 부탁드립니다", snippet: "지금이라도 발행 가능할까요?",
          productId: null, productName: null, answerBasis: null, waitingDays: 40, to: "/inquiries/i-1" },
        { workItemId: "w-2", inquiryId: "i-2", channelCode: "CAFE24", channelNameKo: "카페24", receivedAt: "2026-08-20T00:00:00Z",
          phase: "OPEN", status: "UNANSWERED", title: "배송이 늦습니다", snippet: null,
          productId: null, productName: null, answerBasis: null, waitingDays: 12, to: "/inquiries/i-2" },
      ],
    }],
  };
}

describe("§2 — the answer and its limits are read apart", () => {
  it("notes render as their own quiet lines, never inside the answer's paragraph", () => {
    timeline(turn({
      message: "지금까지 확인한 낮은 평점 리뷰는 8건입니다.",
      notes: ["카페24 리뷰를 최신 상태로 갱신하지 못했습니다.", "네이버 리뷰는 아직 확인한 적이 없어요."],
    }));
    const answer = screen.getByText("지금까지 확인한 낮은 평점 리뷰는 8건입니다.");
    expect(answer).toBeInTheDocument();
    // The limits are elsewhere on the page — not inside the sentence that answered the question.
    expect(answer.textContent).not.toContain("갱신하지 못했습니다");
    const limits = screen.getByLabelText("확인하지 못한 것");
    expect(within(limits).getAllByRole("listitem")).toHaveLength(2);
  });

  it("a turn with nothing to qualify renders no limits region at all", () => {
    timeline(turn({ message: "문의는 15건입니다." }));
    expect(screen.queryByLabelText("확인하지 못한 것")).toBeNull();
  });
});

describe("§5 — a ranking opens the row it judged first", () => {
  it("the top row of a RANKED list is expanded on arrival; the rest are not", async () => {
    timeline(turn({ message: "먼저 보실 것은 「현금영수증 발행 부탁드립니다」입니다 — 40일째 대기 중입니다.", artifacts: [rankedList()] }));
    const rows = await screen.findAllByTestId("inquiry-row-select");
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    expect(rows[1]).toHaveAttribute("aria-expanded", "false");
    // …and the judgement's reason is on the row, not only in the sentence.
    expect(screen.getByText("40일째 대기")).toBeInTheDocument();
  });

  it("an unranked list opens nothing — a plain list makes no judgement to stand on", () => {
    const plain = { ...rankedList(), scope: { ...rankedList().scope!, rank: null } };
    timeline(turn({ message: "답변 안 한 문의는 2건입니다.", artifacts: [plain] }));
    for (const row of screen.getAllByTestId("inquiry-row-select")) {
      expect(row).toHaveAttribute("aria-expanded", "false");
    }
  });
});

describe("§6 — one fact, one rendering", () => {
  it("a card whose title the sentence already said draws no header", () => {
    timeline(turn({ message: "먼저 볼 문의 2건입니다.", artifacts: [rankedList()] }));
    // The section keeps its accessible name; what is dropped is the second RENDERING of the words.
    const card = screen.getByLabelText("먼저 볼 문의");
    expect(within(card).queryByRole("heading", { name: "먼저 볼 문의" })).toBeNull();
  });

  it("a card whose title the sentence did NOT say keeps its header", () => {
    timeline(turn({ message: "확인했습니다.", artifacts: [rankedList()] }));
    expect(within(screen.getByLabelText("먼저 볼 문의")).getByRole("heading", { name: "먼저 볼 문의" })).toBeInTheDocument();
  });
});

function reviews(over: Partial<ReviewList["items"][number]>[] = []): ReviewList {
  const base = {
    reviewId: "r-1", accountId: "acc-1", channelCode: "CAFE24", channelNameKo: "카페24", rating: 1, negative: true,
    preview: "배송이 열흘 걸렸습니다. 너무 느려요.", productId: "p-1", productName: "논슬립 매트",
    writtenOn: "2026-08-29", executableIdentity: "NONE" as const, to: "/reviews?review=r-1",
  };
  return {
    artifactId: "a-r", type: "REVIEW_LIST", title: "낮은 평점 리뷰",
    items: over.length > 0 ? over.map((o, i) => ({ ...base, reviewId: `r-${i}`, ...o })) : [base],
    totalCount: over.length > 0 ? over.length : 1,
    freshness: [], scope: { period: null, rating: "LOW", channelCode: null },
  } as unknown as ReviewList;
}

describe("§6 — a block that only repeats the sentence above it is not drawn", () => {
  const summary = {
    artifactId: "a-s", type: "SUMMARY" as const, title: "채널을 알려주세요",
    lines: ["어느 채널에 대한 질문인지 알려주세요 (네이버 · 쿠팡 · 카페24)."],
  };
  it("an exact restatement of the answer renders nothing", () => {
    timeline(turn({ message: "어느 채널에 대한 질문인지 알려주세요 (네이버 · 쿠팡 · 카페24).", artifacts: [summary] }));
    expect(screen.queryByLabelText("채널을 알려주세요")).toBeNull();
  });
  it("a block with anything of its own is drawn in full", () => {
    timeline(turn({ message: "확인했습니다.", artifacts: [summary] }));
    expect(screen.getByLabelText("채널을 알려주세요")).toBeInTheDocument();
  });
});

describe("§3 — a review row is an object that opens in place", () => {
  it("pressing a row reveals its actions without leaving the conversation", async () => {
    shell(<ReviewListArtifact artifact={reviews()} />);
    expect(screen.queryByTestId("review-row-detail")).toBeNull();
    await userEvent.click(screen.getByTestId("review-row-select"));
    const detail = screen.getByTestId("review-row-detail");
    expect(within(detail).getByRole("link", { name: "리뷰 화면에서 열기" })).toHaveAttribute("href", "/reviews?review=r-1");
    expect(within(detail).getByRole("link", { name: "상품 보기" })).toHaveAttribute("href", "/products/p-1");
  });

  it("a word every row shares is said once; a list that MIXES keeps it on the row", () => {
    const { unmount } = shell(<ReviewListArtifact artifact={reviews([{ negative: true }, { negative: true }])} />);
    expect(screen.queryAllByText("부정")).toHaveLength(0);
    expect(screen.getByText(/모두 부정 리뷰입니다/)).toBeInTheDocument();
    unmount();
    shell(<ReviewListArtifact artifact={reviews([{ negative: true }, { negative: false, rating: 5 }])} />);
    expect(screen.getAllByText("부정")).toHaveLength(1);
  });

  it("a channel this turn already raised as a step is not restated in the footer", () => {
    const artifact = {
      ...reviews(),
      freshness: [{
        channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_CONNECTED",
        verdict: "NOT_CONNECTED", lastSuccessfulSyncAt: null, newestObservedAt: null,
      }],
    } as unknown as ReviewList;
    const { unmount } = shell(<ReviewListArtifact artifact={artifact} />);
    expect(screen.getByLabelText("채널별 확인 기준")).toBeInTheDocument();
    unmount();
    // The step card above says it, and carries the control that fixes it.
    shell(<ReviewListArtifact artifact={artifact} stepped={["NAVER"]} />);
    expect(screen.queryByLabelText("채널별 확인 기준")).toBeNull();
  });
});
