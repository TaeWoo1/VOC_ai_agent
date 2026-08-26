// @vitest-environment jsdom
/**
 * Organization Answer Style v1, from the seller's side.
 *
 * One behaviour is new on this screen, and it is a distinction the product cannot afford to blur:
 * a draft can now exist while the answer basis is still missing — the company's own pre-approved
 * sentence for 「확인 후 안내드리겠습니다」. That is a deferral, not an answer, so the sentence saying
 * what is missing and the way to supply it must both stay on screen beside it.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InquiryResponsePanel } from "./InquiryResponsePanel";

const getInquiryDetailStrict = vi.fn();
const getInquiryPublishCapability = vi.fn();
const generateInquiryProposal = vi.fn();
const generateInquiryDraft = vi.fn();
const confirmInquiryPublish = vi.fn();
const getProductKnowledgeStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInquiryDetailStrict: (id: string) => getInquiryDetailStrict(id),
    getInquiryPublishCapability: () => getInquiryPublishCapability(),
    saveInquiryReplyDraft: vi.fn(),
    confirmInquiryPublish: (...a: unknown[]) => confirmInquiryPublish(...a),
    verifyInquiryPublish: vi.fn(),
    resumeInquiryPublish: vi.fn(),
    generateInquiryProposal: (id: string) => generateInquiryProposal(id),
    generateInquiryDraft: (id: string) => generateInquiryDraft(id),
    createProductKnowledgeSource: vi.fn(),
    getProductKnowledgeStrict: (p: string) => getProductKnowledgeStrict(p),
  },
  getToken: () => null,
}));

const FALLBACK = "정확한 확인이 필요한 내용입니다. 확인 후 다시 안내드리겠습니다.";

function detail() {
  return {
    workItemId: "w1",
    inquiryId: "i1",
    sellerAccountId: "s1",
    channelId: "c1",
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    isSecret: false,
    phase: "OPEN",
    status: "UNANSWERED",
    informStatus: null,
    title: "포장은 어떻게 되나요?",
    details: "포장 상태가 궁금합니다.",
    receivedAt: "2026-08-22T00:00:00Z",
    proposal: null,
    draft: null,
    productId: "p1",
    productName: "선바로 일체형 전선몰딩",
    sourceSubtype: null,
    answerStateProven: true,
    answerStateNote: null,
    draftEvidence: [],
  };
}

const WITH_FALLBACK = {
  draft: {
    version: 1,
    answerStatus: 2,
    title: "[답변] 포장은 어떻게 되나요?",
    comments: FALLBACK,
    contentFingerprint: "a".repeat(64),
    fingerprintAlgorithm: "SHA-256",
    createdAt: "2026-08-27T00:00:00Z",
    authorKind: "SELLER_APPROVED_FALLBACK",
    modelVersion: "style/v1",
    knowledgeState: "NO_MATCH",
    knowledgeNote: "이 질문에 해당하는 내용이 없습니다.",
  },
  authorKind: "SELLER_APPROVED_FALLBACK",
  knowledgeState: "NO_MATCH",
  knowledgeNote: "상품 지식·운영 정책·과거 답변 어디에도 이 질문에 해당하는 내용이 없습니다.",
  answerBasis: "NO_ANSWER_BASIS",
  answerBasisNote: "답변 기준이 필요합니다.",
  answerBasisAction: "등록된 상품 지식·운영 정책에 「포장」 관련 내용이 없습니다.",
  productId: "p1",
  evidence: [],
  unavailableMessage: null,
};

beforeEach(() => {
  getInquiryDetailStrict.mockResolvedValue(detail());
  getInquiryPublishCapability.mockResolvedValue({
    executionEnabled: false,
    replyAdapterChannelCodes: [],
  });
  generateInquiryProposal.mockResolvedValue({
    workItemId: "w1",
    phase: "PROPOSED",
    proposal: {
      summaryCategory: "general_reply",
      providerKind: "RULE_BASED",
      providerName: "rule-proposer",
      providerVersion: "rules-v1",
    },
  });
  getProductKnowledgeStrict.mockResolvedValue({ variants: [] });
});

afterEach(() => vi.clearAllMocks());

describe("InquiryResponsePanel — the seller-approved fallback", () => {
  it("shows the approved sentence AND keeps saying what is missing", async () => {
    generateInquiryDraft.mockResolvedValue(WITH_FALLBACK);
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText(FALLBACK)).toBeInTheDocument();
    // A deferral must not read as an answer: the gap sentence and its way out stay on the screen.
    expect(screen.getByText("답변 기준이 필요합니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "답변 기준 추가" })).toBeInTheDocument();
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
  });

  it("a grounded draft says nothing about a missing basis", async () => {
    generateInquiryDraft.mockResolvedValue({
      ...WITH_FALLBACK,
      draft: { ...WITH_FALLBACK.draft, comments: "몰딩 뒷면 테이프를 벗기고 붙이시면 됩니다.", authorKind: "MODEL" },
      authorKind: "MODEL",
      knowledgeState: "GROUNDED",
      answerBasis: "GROUNDED",
      answerBasisNote: "등록된 근거로 답변할 수 있습니다.",
      answerBasisAction: null,
    });
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText(/테이프를 벗기고/)).toBeInTheDocument();
    expect(screen.queryByText("답변 기준이 필요합니다.")).not.toBeInTheDocument();
  });

  it("a banned phrase refuses the draft, and the reason is operational — not a missing basis", async () => {
    generateInquiryDraft.mockResolvedValue({
      ...WITH_FALLBACK,
      draft: null,
      authorKind: null,
      unavailableMessage:
        "사용하지 않기로 한 표현이 들어가 초안을 저장하지 않았습니다. 다시 생성해 보시거나, 설정에서 그 표현을 확인해 주세요.",
    });
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText(/사용하지 않기로 한 표현/)).toBeInTheDocument();
    expect(screen.queryByText("답변 기준이 필요합니다.")).not.toBeInTheDocument();
  });
});
