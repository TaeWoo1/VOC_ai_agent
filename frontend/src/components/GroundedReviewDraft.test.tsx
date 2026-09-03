// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GroundedReviewDraft, generateFailureMessage } from "./GroundedReviewDraft";
import type { GeneratedReviewDraftView } from "../lib/types";

const generateReviewReplyDraft = vi.fn();
vi.mock("../lib/apiClient", () => ({
  api: {
    generateReviewReplyDraft: (...a: unknown[]) => generateReviewReplyDraft(...a),
    getProductKnowledgeStrict: vi.fn(async () => ({ variants: [] })),
    createProductKnowledgeSource: vi.fn(async () => ({ id: "k-1" })),
  },
  getToken: () => null,
}));

const DRAFT = {
  version: 5,
  body: "안녕하세요. 부착면의 먼지를 닦고 30초 이상 눌러 고정해 주세요.",
  contentFingerprint: "f".repeat(64),
  fingerprintAlgorithm: "review-reply-v1",
  createdAt: "2026-09-03T00:00:00Z",
};

function grounded(): GeneratedReviewDraftView {
  return {
    draft: DRAFT,
    authorKind: "MODEL",
    answerBasis: "GROUNDED",
    answerBasisNote: "판매자가 등록한 근거를 사용해 썼습니다.",
    evidence: [
      {
        kind: "PRODUCT_KNOWLEDGE",
        scopeLabel: "상품 정보",
        title: "자주 묻는 질문 - 잘떨어지네요",
        locator: "product-knowledge/FAQ:데모 운영자",
        sourceId: "s-1",
        chunkId: "c-1",
        snippet: "부착면 상태를 먼저 확인해 주세요.",
      },
    ],
    knowledgeGaps: [],
    templateCategory: "positive_reply",
    templateSource: "ORG",
    unavailableMessage: null,
  };
}

function floor(): GeneratedReviewDraftView {
  return {
    draft: { ...DRAFT, version: 4, body: "저희 제품을 이용해 주셔서 감사합니다." },
    authorKind: "RULE",
    answerBasis: "NO_ANSWER_BASIS",
    answerBasisNote: "이 후기에 해당하는 근거를 찾지 못해, 저장된 문구로 안전한 기본 답글만 준비했습니다.",
    evidence: [],
    knowledgeGaps: [
      {
        scope: "PRODUCT",
        subject: "괜찮긴한데 잘떨어지네요",
        subjectKind: "REVIEW_TEXT",
        question: "'괜찮긴한데 잘떨어지네요'에 대해 고객에게 안내하는 공식 기준이 있나요? 이 상품에 저장된 지식에서 찾지 못했습니다.",
        productId: "p-1",
      },
    ],
    templateCategory: "positive_reply",
    templateSource: "ORG",
    unavailableMessage: null,
  };
}

beforeEach(() => generateReviewReplyDraft.mockReset());

function draw(storedEvidence: GeneratedReviewDraftView["evidence"] = [], onDrafted = vi.fn()) {
  render(
    <MemoryRouter>
      <GroundedReviewDraft accountId="acc-1" actionRef="review:r-1" storedEvidence={storedEvidence} onDrafted={onDrafted} />
    </MemoryRouter>,
  );
  return onDrafted;
}

describe("Grounded Review Drafting v1 — the draft first, then why, then what is missing", () => {
  it("hands the generated body to the editor and never sends anything", async () => {
    generateReviewReplyDraft.mockResolvedValue(grounded());
    const onDrafted = draw();
    await userEvent.click(screen.getByTestId("grounded-review-generate"));
    await waitFor(() => expect(generateReviewReplyDraft).toHaveBeenCalledWith("acc-1", "review:r-1"));
    expect(onDrafted).toHaveBeenCalledWith(DRAFT.body);
    expect(screen.getByText("근거 있음")).toBeInTheDocument();
    // Nothing on this card sends, approves or posts.
    expect(document.body.textContent).not.toMatch(/전송|발송|게시하기/);
  });

  it("「왜 이렇게 썼어요?」 shows the passage the drafter was actually shown, not just its title", async () => {
    generateReviewReplyDraft.mockResolvedValue(grounded());
    draw();
    await userEvent.click(screen.getByTestId("grounded-review-generate"));
    await screen.findByTestId("grounded-review-why");
    // Folded by default: the draft is what the seller came for.
    expect(screen.queryByTestId("grounded-review-evidence")).toBeNull();
    await userEvent.click(screen.getByTestId("grounded-review-why"));
    const evidence = await screen.findByTestId("grounded-review-evidence");
    expect(evidence).toHaveTextContent("상품 정보");
    expect(evidence).toHaveTextContent("자주 묻는 질문 - 잘떨어지네요");
    // The check, not the pointer.
    expect(evidence).toHaveTextContent("부착면 상태를 먼저 확인해 주세요.");
  });

  it("a floor draft asks for exactly what is missing, quoting the customer, with the way to answer it", async () => {
    generateReviewReplyDraft.mockResolvedValue(floor());
    draw();
    await userEvent.click(screen.getByTestId("grounded-review-generate"));
    const gaps = await screen.findByTestId("grounded-review-gaps");
    expect(gaps).toHaveTextContent("더 정확한 답변을 위해 정보가 필요합니다.");
    expect(gaps).toHaveTextContent("'괜찮긴한데 잘떨어지네요'에 대해");
    expect(screen.getByText("기본 문구")).toBeInTheDocument();
    // The way to answer it is right there — the same quick-add the inquiry screen uses.
    expect(screen.getByRole("button", { name: "답변 기준 추가" })).toBeInTheDocument();
  });

  it("the stored version's citations answer 「왜 이렇게 썼어요?」 after a reload, before anything is generated", () => {
    draw(grounded().evidence);
    expect(screen.getByTestId("grounded-review-why")).toHaveTextContent("근거 1");
    expect(generateReviewReplyDraft).not.toHaveBeenCalled();
  });

  it("an operational failure is said as one — never as a statement about the seller's knowledge", async () => {
    generateReviewReplyDraft.mockResolvedValue({
      ...grounded(),
      authorKind: "RULE",
      draft: { ...DRAFT, body: "저희 제품을 이용해 주셔서 감사합니다." },
      unavailableMessage: "근거에 없는 교환·환불·보상 약속이 들어가 AI 초안을 저장하지 않았습니다. 저장된 문구로 초안을 준비했습니다.",
    });
    draw();
    await userEvent.click(screen.getByTestId("grounded-review-generate"));
    expect(await screen.findByText(/근거에 없는 교환·환불·보상 약속/)).toBeInTheDocument();
  });

  it("why a generation did not happen: the review's own state, or the machine", () => {
    // Pure, and tested as such. Driving the rejection through the component in jsdom reports the
    // handled rejection as an unhandled one — the runner's behaviour, not the component's, and not
    // worth reshaping the component around. The refusal itself is proven live (409 on an approved
    // review); what this pins is which sentence each status produces.
    expect(generateFailureMessage(409)).toContain("승인된 답변이 있거나");
    expect(generateFailureMessage(500)).toContain("잠시 후 다시 시도해 주세요");
    expect(generateFailureMessage(undefined)).toContain("잠시 후 다시 시도해 주세요");
  });

});
