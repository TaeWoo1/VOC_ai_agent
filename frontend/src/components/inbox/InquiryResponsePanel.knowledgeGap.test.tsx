// @vitest-environment jsdom
/**
 * Knowledge Gap Resolution v1, from the seller's side.
 *
 * 「답변 기준이 필요합니다」 was a true sentence with nothing to do about it: the seller read it, and
 * the next identical question read it again. These cases are about the way out being on the screen
 * that named the gap — and about what saving does NOT do, which is send anything.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InquiryResponsePanel } from "./InquiryResponsePanel";

const getInquiryDetailStrict = vi.fn();
const getInquiryPublishCapability = vi.fn();
const generateInquiryProposal = vi.fn();
const generateInquiryDraft = vi.fn();
const createProductKnowledgeSource = vi.fn();
const getProductKnowledgeStrict = vi.fn();
const confirmInquiryPublish = vi.fn();

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
    createProductKnowledgeSource: (p: string, r: unknown) => createProductKnowledgeSource(p, r),
    getProductKnowledgeStrict: (p: string) => getProductKnowledgeStrict(p),
  },
  getToken: () => null,
}));

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
    title: "전선이 몇 가닥까지 들어가나요?",
    details: "몰딩 하나에 몇 가닥이나 넣을 수 있나요?",
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

const NO_BASIS = {
  draft: null,
  authorKind: null,
  knowledgeState: "NO_MATCH",
  knowledgeNote: "상품 지식·운영 정책·과거 답변 어디에도 이 질문에 해당하는 내용이 없습니다.",
  answerBasis: "NO_ANSWER_BASIS",
  answerBasisNote: "답변 기준이 필요합니다.",
  answerBasisAction:
    "등록된 상품 지식·운영 정책에 「가닥」 관련 내용이 없습니다. 규격에 따라 답이 달라진다면 규격별로 등록할 수 있습니다.",
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
      summaryCategory: "product_info_reply",
      providerKind: "RULE_BASED",
      providerName: "rule-proposer",
      providerVersion: "rules-v1",
    },
  });
  generateInquiryDraft.mockResolvedValue(NO_BASIS);
  createProductKnowledgeSource.mockResolvedValue({ id: "k1", chunks: 1 });
  getProductKnowledgeStrict.mockResolvedValue({
    variants: [
      { id: "v2", channelCode: "NAVER", externalVariantId: "o2", optionName: "2호", sku: null, price: null, sellingStatus: null, source: "NAVER", observedAt: null },
      { id: "v3", channelCode: "NAVER", externalVariantId: "o3", optionName: "3호", sku: null, price: null, sellingStatus: null, source: "NAVER", observedAt: null },
    ],
  });
});

afterEach(() => vi.clearAllMocks());

describe("InquiryResponsePanel — the missing answer basis", () => {
  it("A — NO_ANSWER_BASIS shows what is missing AND the way to supply it", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InquiryResponsePanel workItemId="w1" />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText("답변 기준이 필요합니다.")).toBeInTheDocument();
    expect(screen.getByText(/「가닥」 관련 내용이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "답변 기준 추가" })).toBeInTheDocument();
  });

  it("A — with no product bound there is nowhere to save, so no box is offered", async () => {
    generateInquiryDraft.mockResolvedValue({
      ...NO_BASIS,
      knowledgeState: "NO_PRODUCT",
      productId: null,
      answerBasisAction: "이 문의가 어떤 상품에 대한 것인지 연결하면 근거를 찾을 수 있습니다.",
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InquiryResponsePanel workItemId="w1" />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText("답변 기준이 필요합니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 기준 추가" })).not.toBeInTheDocument();
  });

  it("saves the seller's sentence against the chosen 규격 and asks for the draft again", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InquiryResponsePanel workItemId="w1" />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    await user.click(await screen.findByRole("button", { name: "답변 기준 추가" }));

    await user.type(
      screen.getByLabelText("답변 기준 내용"),
      "3호 몰딩에는 전선을 4가닥까지 넣을 수 있습니다.",
    );
    await waitFor(() => expect(screen.getByRole("option", { name: "3호" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("적용 범위"), "v3");
    await user.click(screen.getByRole("button", { name: /저장하고 다시 답변 만들기/ }));

    await waitFor(() =>
      expect(createProductKnowledgeSource).toHaveBeenCalledWith("p1", {
        sourceType: "DESCRIPTION",
        title: "3호 몰딩에는 전선을 4가닥까지 넣을 수 있습니다.",
        body: "3호 몰딩에는 전선을 4가닥까지 넣을 수 있습니다.",
        variantId: "v3",
      }),
    );
    // The whole of what saving does: re-ask. It does not approve and it does not send.
    await waitFor(() => expect(generateInquiryDraft).toHaveBeenCalledTimes(2));
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
  });

  it("전체 상품 공통 is the default, and it is sent as a null rather than as a guess", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InquiryResponsePanel workItemId="w1" />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    await user.click(await screen.findByRole("button", { name: "답변 기준 추가" }));

    await user.type(screen.getByLabelText("답변 기준 내용"), "몰딩 안에는 전선을 3가닥까지 넣을 수 있습니다.");
    await user.click(screen.getByRole("button", { name: /저장하고 다시 답변 만들기/ }));

    await waitFor(() =>
      expect(createProductKnowledgeSource).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ variantId: null }),
      ),
    );
  });
});
