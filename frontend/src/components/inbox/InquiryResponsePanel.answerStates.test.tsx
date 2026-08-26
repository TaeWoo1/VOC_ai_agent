// @vitest-environment jsdom
/**
 * <b>The three answer states, on the screen</b> — Core Daily Loop UX Integration v1 §5 / §14 E·F·G·H.
 *
 * The backend has had three states for a while and the screen had one shape for two of them. A
 * GROUNDED draft was announced by the same orange caution strip a failure got, and
 * NEEDS_CLARIFICATION — the state where the draft is a QUESTION back to the customer — was rendered
 * nowhere at all, so a seller read a polite request for the 규격 as an answer that had come out
 * short and sent it.
 *
 * These cases assert the difference is visible and that each state carries the control that belongs
 * to it. What they do NOT assert is the wording of the draft itself: no model runs here, and the
 * sentences the states carry are the backend's.
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

function detail(over: Record<string, unknown> = {}) {
  return {
    workItemId: "w1",
    inquiryId: "i1",
    sellerAccountId: "s1",
    channelId: "c1",
    channelCode: "CAFE24",
    channelNameKo: "카페24 자사몰",
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
    ...over,
  };
}

function draftRow(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    answerStatus: 2,
    title: "[답변] 전선 가닥 수",
    comments: "규격에 따라 달라집니다. 사용하실 규격을 알려주시면 정확히 안내드리겠습니다.",
    contentFingerprint: "a".repeat(64),
    fingerprintAlgorithm: "SHA-256",
    createdAt: "2026-08-24T00:00:00Z",
    authorKind: "MODEL",
    modelVersion: "test-model/v1+style/default",
    knowledgeState: "GROUNDED",
    knowledgeNote: "판매자가 등록한 상품 정보를 근거로 썼습니다.",
    ...over,
  };
}

const GROUNDED = {
  draft: draftRow({ comments: "몰딩 안쪽으로 전선 3가닥까지 들어갑니다." }),
  authorKind: "MODEL",
  knowledgeState: "GROUNDED",
  knowledgeNote: "판매자가 등록한 상품 정보를 근거로 썼습니다.",
  answerBasis: "GROUNDED",
  answerBasisNote: "답변에 필요한 정보를 확인했습니다.",
  answerBasisAction: null,
  productId: "p1",
  evidence: [
    {
      kind: "PRODUCT_KNOWLEDGE",
      scopeLabel: "상품 정보",
      title: "자주 묻는 질문 - 전선 수용",
      locator: "product-knowledge/FAQ:1",
      sourceId: "s1",
      chunkId: "c1",
      snippet: "몰딩 하나에 들어가는 전선은 최대 3가닥입니다.",
    },
  ],
  unavailableMessage: null,
};

const NEEDS_CLARIFICATION = {
  ...GROUNDED,
  draft: draftRow(),
  answerBasis: "NEEDS_CLARIFICATION",
  answerBasisNote: "정확한 답변을 위해 고객에게 확인할 내용이 있습니다.",
  answerBasisAction: "고객이 어떤 규격·옵션인지 밝히지 않았습니다. 아래 초안은 그 내용을 되묻습니다.",
};

const NO_BASIS = {
  draft: null,
  authorKind: null,
  knowledgeState: "NO_MATCH",
  knowledgeNote: "상품 지식·운영 정책·과거 답변 어디에도 이 질문에 해당하는 내용이 없습니다.",
  answerBasis: "NO_ANSWER_BASIS",
  answerBasisNote: "답변 기준이 필요합니다.",
  answerBasisAction: "등록된 상품 지식·운영 정책에 「가닥」 관련 내용이 없습니다.",
  productId: "p1",
  evidence: [],
  unavailableMessage: null,
};

function open() {
  render(
    <MemoryRouter>
      <InquiryResponsePanel workItemId="w1" />
    </MemoryRouter>,
  );
}

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
  createProductKnowledgeSource.mockResolvedValue({ id: "k1", chunks: 1 });
  getProductKnowledgeStrict.mockResolvedValue({ variants: [] });
});

afterEach(() => vi.clearAllMocks());

describe("the three answer states", () => {
  it("E — GROUNDED: a confirmation, the evidence, the draft, and something to press", async () => {
    generateInquiryDraft.mockResolvedValue(GROUNDED);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    const card = await screen.findByTestId("answer-state");
    expect(card).toHaveAttribute("data-basis", "GROUNDED");
    expect(card).toHaveTextContent("답변에 필요한 정보를 확인했습니다.");
    // The one visual difference a 50-year-old operator reads before any word: this state is not a
    // caution. It used to share the orange strip with every failure on the screen.
    expect(card.className).toContain("good");
    expect(card.className).not.toContain("warn");

    expect(screen.getByText("몰딩 안쪽으로 전선 3가닥까지 들어갑니다.")).toBeInTheDocument();
    expect(screen.getByText("몰딩 하나에 들어가는 전선은 최대 3가닥입니다.")).toBeInTheDocument();
    expect(screen.getByText("자주 묻는 질문 - 전선 수용")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /초안 복사/ })).toBeInTheDocument();
    // Nothing is missing, so nothing asks the seller to go and fix their library.
    expect(screen.queryByRole("button", { name: "답변 기준 추가" })).toBeNull();
  });

  it("E — GROUNDED does not also repeat the same fact as a caution line", async () => {
    generateInquiryDraft.mockResolvedValue(GROUNDED);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    await screen.findByTestId("answer-state");
    // 「판매자가 등록한 상품 정보를 근거로 썼습니다」 says what the card and the citation below both
    // already say. Three statements of one fact is how a screen teaches people to skim (§11).
    expect(screen.queryByText(/근거로 썼습니다/)).toBeNull();
  });

  it("F — NEEDS_CLARIFICATION: it says what is missing, and the draft that asks is still there", async () => {
    generateInquiryDraft.mockResolvedValue(NEEDS_CLARIFICATION);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    const card = await screen.findByTestId("answer-state");
    expect(card).toHaveAttribute("data-basis", "NEEDS_CLARIFICATION");
    expect(card).toHaveTextContent("정확한 답변을 위해 고객에게 확인할 내용이 있습니다.");
    expect(card).toHaveTextContent("고객이 어떤 규격·옵션인지 밝히지 않았습니다.");
    // The missing context, and nothing invented alongside it: no delivery window, no figure, no
    // second question the customer was never asked.
    expect(card.textContent ?? "").not.toMatch(/발송|배송|일 이내|원/);
    expect(
      screen.getByText(/사용하실 규격을 알려주시면/, { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답변 기준 추가" })).toBeNull();
  });

  it("G — NO_ANSWER_BASIS: the gap, the way to close it, and no draft at all", async () => {
    generateInquiryDraft.mockResolvedValue(NO_BASIS);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    const card = await screen.findByTestId("answer-state");
    expect(card).toHaveAttribute("data-basis", "NO_ANSWER_BASIS");
    expect(card).toHaveTextContent("답변 기준이 필요합니다.");
    expect(card).toHaveTextContent("「가닥」 관련 내용이 없습니다");
    expect(screen.getByRole("button", { name: "답변 기준 추가" })).toBeInTheDocument();
    // No draft was written and none is faked. The seller's own box is open instead.
    expect(screen.queryByRole("button", { name: /초안 복사/ })).toBeNull();
    expect(screen.getByLabelText("내용")).toBeInTheDocument();
  });

  it("H — saving an answer basis says what happened, and where the sentence now lives", async () => {
    generateInquiryDraft.mockResolvedValueOnce(NO_BASIS).mockResolvedValueOnce(GROUNDED);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    await user.click(await screen.findByRole("button", { name: "답변 기준 추가" }));
    await user.type(
      screen.getByLabelText("답변 기준 내용"),
      "몰딩 안쪽으로 전선 3가닥까지 들어갑니다.",
    );
    await user.click(screen.getByRole("button", { name: /저장하고 다시 답변 만들기/ }));

    await waitFor(() => expect(generateInquiryDraft).toHaveBeenCalledTimes(2));
    // The two facts, and neither more nor less. The result is the card underneath.
    expect(
      await screen.findByText(/답변 기준을 저장했습니다\. 저장한 내용으로 답변을 다시 만들었습니다\./),
    ).toBeInTheDocument();
    expect((await screen.findByTestId("answer-state"))).toHaveAttribute("data-basis", "GROUNDED");
    // §12 — the minimum path back to what they just wrote.
    expect(screen.getByRole("link", { name: /등록된 답변 기준 보기/ })).toHaveAttribute(
      "href",
      "/products/p1",
    );
    // K — none of this touched a marketplace.
    expect(confirmInquiryPublish).not.toHaveBeenCalled();
  });

  it("H — a save that does not cover the question is still reported honestly", async () => {
    generateInquiryDraft.mockResolvedValue(NO_BASIS);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    await user.click(await screen.findByRole("button", { name: "답변 기준 추가" }));
    await user.type(screen.getByLabelText("답변 기준 내용"), "설치는 벽면에 붙입니다.");
    await user.click(screen.getByRole("button", { name: /저장하고 다시 답변 만들기/ }));

    await waitFor(() => expect(generateInquiryDraft).toHaveBeenCalledTimes(2));
    // Saved, re-run, and STILL 「답변 기준이 필요합니다」 — which is the ordinary outcome of adding
    // knowledge that does not happen to answer this question. The confirmation says what it did; it
    // does not claim the gap is closed.
    expect(await screen.findByText(/답변 기준을 저장했습니다/)).toBeInTheDocument();
    expect(screen.getByTestId("answer-state")).toHaveAttribute("data-basis", "NO_ANSWER_BASIS");
  });

  it("the machinery failing is not a knowledge gap — no state card, no library errand", async () => {
    generateInquiryDraft.mockResolvedValue({
      ...GROUNDED,
      draft: null,
      authorKind: null,
      unavailableMessage: "오늘 사용할 수 있는 AI 사용량을 모두 썼습니다.",
    });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText(/오늘 사용할 수 있는 AI 사용량/)).toBeInTheDocument();
    expect(screen.queryByTestId("answer-state")).toBeNull();
    expect(screen.queryByText("답변 기준이 필요합니다.")).toBeNull();
  });

  it("a reload claims no state — the stored row cannot tell a clarification from an answer", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({ phase: "PROPOSED", draft: draftRow(), draftEvidence: GROUNDED.evidence }),
    );
    open();

    expect(await screen.findByText(/사용하실 규격을 알려주시면/)).toBeInTheDocument();
    expect(screen.queryByTestId("answer-state")).toBeNull();
    // What the row DOES record still shows, and it is not dressed as a warning.
    expect(screen.getByText(/근거로 썼습니다/)).toBeInTheDocument();
  });

  it("I — an inquiry already answered on the channel offers no send and no draft", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({ phase: "PROPOSED", status: "ANSWERED", draft: draftRow() }),
    );
    getInquiryPublishCapability.mockResolvedValue({
      executionEnabled: true,
      replyAdapterChannelCodes: ["CAFE24"],
    });
    open();

    await screen.findByText(/사용하실 규격을 알려주시면/);
    expect(screen.queryByRole("button", { name: "답변 보내기" })).toBeNull();
    expect(screen.queryByRole("button", { name: /다시 작성/ })).toBeNull();
  });
});
