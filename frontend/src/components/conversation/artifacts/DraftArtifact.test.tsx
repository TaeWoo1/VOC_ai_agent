// @vitest-environment jsdom
/**
 * Seller-facing Response Hygiene v1 §5 — the draft is read in the chat: body first, one compact
 * grounding line, the next moves as conversation sentences, the screen as a secondary link. And §1:
 * nothing on the card is an internal token.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DraftArtifact } from "./DraftArtifact";
import { ConversationTimeline } from "../ConversationTimeline";
import { agentTurn } from "../../../test/conversationFixtures";
import type { DraftArtifact as Draft } from "../../../lib/conversation/types";

const getInquiryDetailStrict = vi.fn();
vi.mock("../../../lib/apiClient", () => ({ api: { getInquiryDetailStrict: (...a: unknown[]) => getInquiryDetailStrict(...a) } }));

const INTERNAL = /CUSTOMER_MEMORY|PRODUCT_KNOWLEDGE|ORG_POLICY|NO_ANSWER_BASIS|GROUNDED|PRODUCT_API|work ?item|\/api\//;

const grounded: Draft = {
  artifactId: "a-draft-w1", type: "DRAFT", objectKind: "INQUIRY", title: "답변 초안",
  workItemId: "w-1", inquiryId: "i-1", channelCode: "CAFE24", channelNameKo: "카페24",
  version: 2, contentFingerprint: "fp", comments: "안녕하세요. 주문하신 몰딩은 영업일 기준 2일 이내 출고됩니다.",
  authorKind: "MODEL", answerBasis: "GROUNDED", answerBasisNote: null, knowledgeState: "GROUNDED", evidenceCount: 2,
  evidenceSummary: [{ scopeLabel: "상품 정보", count: 1 }, { scopeLabel: "운영 정책", count: 1 }], companyContextUsed: true,
  productId: "p-1", productName: "선바로 몰딩", unavailableMessage: null, tone: null, to: "/inquiries/i-1",
};

beforeEach(() => getInquiryDetailStrict.mockReset());

describe("DraftArtifact — body first, compact grounding, next moves", () => {
  it("shows the draft text before the grounding line and offers 말투 다듬기 · 보내기 준비 as prompts", async () => {
    const onPrompt = vi.fn();
    render(<MemoryRouter><DraftArtifact artifact={grounded} onPrompt={onPrompt} /></MemoryRouter>);
    const card = screen.getByTestId("draft-artifact");
    const body = screen.getByTestId("draft-body");
    expect(body).toHaveTextContent("영업일 기준 2일 이내 출고됩니다");
    const grounding = screen.getByLabelText("초안 근거");
    expect(grounding).toHaveTextContent("근거 · 상품 정보 1 · 운영 정책 1 · 회사 정보 참고");
    // Order: the body is above the grounding line, and the screen link is last.
    expect(body.compareDocumentPosition(grounding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.textContent).not.toMatch(INTERNAL);
    expect(card.textContent).not.toContain("문의 화면에서 확인");

    await userEvent.click(screen.getByRole("button", { name: "말투 다듬기" }));
    await userEvent.click(screen.getByRole("button", { name: "보내기 준비" }));
    expect(onPrompt.mock.calls.map((c) => c[0])).toEqual(["조금 더 부드럽게 써줘", "좋아 보내자"]);
    // No write control here: the Approval artifact owns sending.
    expect(screen.queryByRole("button", { name: /보내기$|전송/ })).toBeNull();
    expect(screen.getByRole("link", { name: "문의 화면에서 직접 고치기" })).toHaveAttribute("href", "/inquiries/i-1");
    expect(card).toHaveTextContent("아직 아무 곳에도 보내지 않았습니다.");
  });

  it("a reloaded thread re-reads the same saved version's text instead of pointing at the screen", async () => {
    getInquiryDetailStrict.mockResolvedValue({ draft: { version: 2, comments: "저장된 초안 본문입니다." } });
    render(<MemoryRouter><DraftArtifact artifact={{ ...grounded, comments: null }} onPrompt={() => undefined} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("draft-body")).toHaveTextContent("저장된 초안 본문입니다."));
    expect(getInquiryDetailStrict).toHaveBeenCalledWith("w-1");
    expect(screen.getByTestId("draft-artifact").textContent).not.toContain("문의 화면에서 확인할 수 있습니다");
  });

  it("an older version on a reloaded thread says it was superseded — never 「불러오는 중」 forever", async () => {
    getInquiryDetailStrict.mockResolvedValue({ draft: { version: 5, comments: "최신 본문" } });
    render(<MemoryRouter><DraftArtifact artifact={{ ...grounded, comments: null }} onPrompt={() => undefined} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("draft-reload")).toHaveTextContent("이 초안은 이후 버전으로 바뀌었습니다."));
    expect(screen.queryByTestId("draft-body")).toBeNull();
  });

  it("NO_ANSWER_BASIS draws NOTHING: the gap is the turn's own sentence and the step is its own card", () => {
    // Conversation UX v2 §D — one representation per fact. A draft card with no draft could only
    // restate the sentence above it (what is missing) and the card beside it (what to do).
    const { container } = render(<MemoryRouter><DraftArtifact artifact={{
      ...grounded, title: "답변 기준이 필요합니다", version: null, comments: null, contentFingerprint: null, authorKind: null,
      answerBasis: "NO_ANSWER_BASIS", answerBasisNote: "'배송' 관련 내용이 없습니다.", answerBasisAction: "등록된 배송 기준이 아직 없습니다.",
      evidenceSummary: [], companyContextUsed: false,
    }} onPrompt={() => undefined} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("draft-artifact")).toBeNull();
    expect(screen.queryByTestId("draft-body")).toBeNull();
    expect(screen.queryByRole("button", { name: "보내기 준비" })).toBeNull();
    expect(getInquiryDetailStrict).not.toHaveBeenCalled();
  });
});

describe("ConversationTimeline — a failed turn reads as its sentence", () => {
  it("GOAL_UNSUPPORTED shows the runtime's closed sentence once, with no mechanism headline", () => {
    const turn = agentTurn({
      turnId: "a-f", status: "FAILED", failureCode: "GOAL_UNSUPPORTED", artifacts: [], suggestedActions: [],
      message: "어떤 문의를 확인할지 먼저 선택해 주세요.", failureReason: "어떤 문의를 확인할지 먼저 선택해 주세요.",
    });
    render(<MemoryRouter><ConversationTimeline turns={[turn]} busy={false} stages={[]} elapsed={0} error={null} onPrompt={() => undefined} onResume={() => undefined} /></MemoryRouter>);
    const article = screen.getByTestId("agent-turn");
    expect(article.textContent).not.toContain("계획을 세우지 못했습니다");
    expect(article.textContent?.split("어떤 문의를 확인할지 먼저 선택해 주세요.").length).toBe(2);
  });
});
