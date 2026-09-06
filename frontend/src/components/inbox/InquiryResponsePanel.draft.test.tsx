// @vitest-environment jsdom
/**
 * Inquiry Draft v1, from the seller's side: what a generated draft SAYS about itself.
 *
 * The draft is the sentence a seller will send to a customer under their own name. So the assertions
 * here are all about honesty rather than about drafting: a limitation is shown before the text it
 * qualifies, a citation appears only when the draft actually stood on one, and a draft that no model
 * wrote never wears a model's evidence.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InquiryResponsePanel } from "./InquiryResponsePanel";

const getInquiryDetailStrict = vi.fn();
const getInquiryPublishCapability = vi.fn();
const generateInquiryProposal = vi.fn();
const generateInquiryDraft = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInquiryDetailStrict: (id: string) => getInquiryDetailStrict(id),
    getInquiryPublishCapability: () => getInquiryPublishCapability(),
    saveInquiryReplyDraft: vi.fn(),
    confirmInquiryPublish: vi.fn(),
    verifyInquiryPublish: vi.fn(),
    resumeInquiryPublish: vi.fn(),
    generateInquiryProposal: (id: string) => generateInquiryProposal(id),
    generateInquiryDraft: (id: string) => generateInquiryDraft(id),
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
    title: "사용 방법이 궁금합니다",
    details: "처음 써봅니다.",
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

function generated(over: Record<string, unknown> = {}) {
  return {
    draft: {
      version: 1,
      answerStatus: 2,
      title: "[답변] 사용 방법",
      comments: "테이프를 벗기고 벽면에 붙이시면 됩니다.",
      contentFingerprint: "a".repeat(64),
      fingerprintAlgorithm: "SHA-256",
      createdAt: "2026-08-24T00:00:00Z",
      authorKind: "MODEL",
      modelVersion: "test-model/v1",
      knowledgeState: "GROUNDED",
      knowledgeNote: "판매자가 등록한 상품 지식을 근거로 썼습니다.",
    },
    authorKind: "MODEL",
    knowledgeState: "GROUNDED",
    knowledgeNote: "판매자가 등록한 상품 지식을 근거로 썼습니다.",
    answerBasis: "GROUNDED",
    answerBasisNote: "판매자가 등록한 근거를 사용해 썼습니다.",
    answerBasisAction: null,
    productId: "p1",
    evidence: [
      { kind: "PRODUCT_KNOWLEDGE", scopeLabel: "상품 정보", title: "사용법", locator: "product-knowledge/USAGE:데모 운영자", sourceId: "s", chunkId: "c", snippet: "몰딩 뒷면 테이프를 벗기고 벽면에 눌러 붙입니다." },
    ],
    unavailableMessage: null,
    ...over,
  };
}

beforeEach(() => {
  getInquiryDetailStrict.mockResolvedValue(detail());
  getInquiryPublishCapability.mockResolvedValue({ executionEnabled: false, replyAdapterChannelCodes: [] });
  generateInquiryProposal.mockResolvedValue({
    workItemId: "w1",
    phase: "PROPOSED",
    proposal: { summaryCategory: "product_info_reply", providerKind: "RULE_BASED", providerName: "rule-proposer", providerVersion: "rules-v1" },
  });
  generateInquiryDraft.mockResolvedValue(generated());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InquiryResponsePanel — the generated draft", () => {
  it("proposes and drafts in one press — the seller asked for an answer, not a state machine", async () => {
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    await waitFor(() => expect(generateInquiryDraft).toHaveBeenCalledWith("w1"));
    expect(generateInquiryProposal).toHaveBeenCalledWith("w1");
    expect(await screen.findByText("테이프를 벗기고 벽면에 붙이시면 됩니다.")).toBeInTheDocument();
  });

  it("shows the lead citation's kind, title AND excerpt without a click", async () => {
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    // The excerpt is the point. A closed 「상품 정보 1개」 told the seller a source existed and
    // nothing about whether it answered the question — which is how a reply about 전선 가닥 수 came
    // to stand, invisibly, on a document titled 「자주 묻는 질문 - 접착과 재부착」.
    expect(await screen.findByText("AI가 확인한 내용")).toBeInTheDocument();
    expect(screen.getByText("상품 정보")).toBeInTheDocument();
    expect(screen.getByText("사용법")).toBeInTheDocument();
    expect(screen.getByText("몰딩 뒷면 테이프를 벗기고 벽면에 눌러 붙입니다.")).toBeInTheDocument();

    // The retrieval's own address for the passage identifies a chunk, and no seller acts on a chunk
    // id. It is not on the screen open or closed.
    expect(screen.queryByText(/product-knowledge\/USAGE/)).toBeNull();
  });

  it("folds everything after the lead citation, so four passages are not four cards", async () => {
    generateInquiryDraft.mockResolvedValue(generated({
      evidence: [
        { kind: "PRODUCT_KNOWLEDGE", scopeLabel: "상품 정보", title: "사용법", locator: "l1", sourceId: "s1", chunkId: "c1", snippet: "테이프를 벗기고 붙입니다." },
        { kind: "ORG_POLICY", scopeLabel: "운영 정책", title: "교환 및 반품", locator: "l2", sourceId: "s2", chunkId: "c2", snippet: "수령 후 7일 이내 교환이 가능합니다." },
      ],
    }));
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText("테이프를 벗기고 붙입니다.")).toBeInTheDocument();
    // `<details>` keeps its closed content in the DOM, so the assertion is on the fold's own state
    // rather than on presence — jsdom renders no `display`, and a presence check would pass either way.
    const more = screen.getByText(/나머지 근거 1개/);
    const fold = more.closest("details");
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute("open");

    await user.click(more);
    expect(fold).toHaveAttribute("open");
    expect(screen.getByText("수령 후 7일 이내 교환이 가능합니다.")).toBeInTheDocument();
  });

  // The fixture used to say `knowledgeState: NO_MATCH` with `answerBasis: GROUNDED` and an author of
  // MODEL — a shape the backend has not produced since 2026-08-26, when a question with no current
  // evidence stopped reaching the model at all. The state that DOES pair a stored draft with a
  // non-grounded library is the company's own approved deferral, and the limitation must still be
  // stated over it: a seller reading that sentence is reading the reason it is a deferral.
  it("states the limitation when the library could not answer — and cites nothing", async () => {
    generateInquiryDraft.mockResolvedValue(generated({
      authorKind: "SELLER_APPROVED_FALLBACK",
      knowledgeState: "NO_MATCH",
      knowledgeNote: "등록된 상품 지식에 이 질문에 해당하는 내용이 없어, 문의 내용만 보고 쓴 초안입니다.",
      answerBasis: "NO_ANSWER_BASIS",
      answerBasisNote: "답변 기준이 필요합니다.",
      answerBasisAction: "등록된 상품 지식·운영 정책에 이 질문에 해당하는 내용이 없습니다.",
      evidence: [],
    }));
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    // The limitation is stated by the state card, once. It used to be stated by the card AND by a
    // second sentence underneath repeating it (Core Daily Loop UX Integration v1 §11), and in this
    // state the longer form of that sentence — 「아래 과거 답변은 참고용이며」 — pointed at citations
    // that a no-basis generate never records.
    const card = await screen.findByTestId("answer-state");
    expect(card).toHaveTextContent("답변 기준이 필요합니다.");
    expect(card).toHaveTextContent("해당하는 내용이 없습니다");
    expect(screen.queryByText(/해당하는 내용이 없어/)).toBeNull();
    expect(screen.queryByText("근거")).toBeNull();
  });

  it("says when the day's AI budget stopped the model — and writes nothing in its place", async () => {
    generateInquiryDraft.mockResolvedValue(generated({
      draft: null,
      authorKind: null,
      knowledgeState: "GROUNDED",
      knowledgeNote: "판매자가 등록한 상품 정보를 근거로 썼습니다.",
      answerBasis: "GROUNDED",
      answerBasisNote: "판매자가 등록한 근거를 사용해 썼습니다.",
      answerBasisAction: null,
      evidence: [],
      unavailableMessage: "오늘 사용할 수 있는 AI 처리량을 모두 썼습니다. 내일 다시 사용할 수 있고, 화면의 숫자와 목록은 그대로 이용할 수 있습니다.",
    }));
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText(/오늘 사용할 수 있는 AI 처리량/)).toBeInTheDocument();
    expect(screen.queryByText("답변 기준이 필요합니다.")).toBeNull();
  });

  /*
    THE MACHINERY DID NOT RUN — and the seller's library is not what is wrong.

    Until 2026-08-27 a vendor that did not answer, and a 상세페이지 read that failed, both surfaced
    as 「답변 기준이 필요합니다」. That sentence sends a seller off to write product knowledge; for a
    fully grounded question they would have written it twice and still had no draft.
  */
  it("operational failure: names what did not run, and never 「답변 기준이 필요합니다」", async () => {
    generateInquiryDraft.mockResolvedValue(generated({
      draft: null,
      authorKind: null,
      knowledgeState: "GROUNDED",
      knowledgeNote: "판매자가 등록한 상품 정보를 근거로 썼습니다.",
      answerBasis: "GROUNDED",
      answerBasisNote: "판매자가 등록한 근거를 사용해 썼습니다.",
      answerBasisAction: null,
      evidence: [],
      unavailableMessage: "답변 초안을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }));
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText(/답변 초안을 생성하지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText("답변 기준이 필요합니다.")).toBeNull();
    expect(screen.queryByText(/근거가 없는 답변은 만들지 않습니다/)).toBeNull();
    // The box stays open: whichever way the machinery failed, the seller can still write the reply.
    expect(screen.getByLabelText("내용")).toBeInTheDocument();
  });

  it("a failed 상세페이지 read is reported as a read, not as a missing basis", async () => {
    generateInquiryDraft.mockResolvedValue(generated({
      draft: null,
      authorKind: null,
      knowledgeState: "NO_LIBRARY",
      knowledgeNote: "이 상품에 등록된 지식이 없고, 운영 정책·과거 답변에도 해당 내용이 없어 문의 내용만 보고 쓴 초안입니다.",
      answerBasis: "NO_ANSWER_BASIS",
      answerBasisNote: "답변 기준이 필요합니다.",
      answerBasisAction: "이 상품에 등록된 지식이 없습니다. 상품 지식을 등록하면 근거가 생깁니다.",
      evidence: [],
      unavailableMessage: "상품 상세 정보를 확인하지 못했습니다.",
    }));
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText("상품 상세 정보를 확인하지 못했습니다.")).toBeInTheDocument();
    // We did not finish looking. "There is nothing to find" is not ours to say yet.
    expect(screen.queryByText("답변 기준이 필요합니다.")).toBeNull();
  });

  /*
    NO_ANSWER_BASIS — the state where SellerOps writes nothing (product-owner, 2026-08-26).

    The old behaviour put 「확인한 뒤 정확한 안내를 드리겠습니다」 in the box whenever grounding
    failed. It looked finished, it was a commitment made in the seller's voice, and nothing had
    authorised it. What replaces it is a headline that says which basis is missing, an editor left
    open, and no sentence for the customer.
  */
  it("no basis: says 「답변 기준이 필요합니다」, names the gap, and produces no reply text", async () => {
    generateInquiryDraft.mockResolvedValue(generated({
      draft: null,
      authorKind: null,
      knowledgeState: "NO_LIBRARY",
      knowledgeNote: "이 상품에 등록된 지식이 없고, 운영 정책·과거 답변에도 해당 내용이 없어 문의 내용만 보고 쓴 초안입니다.",
      answerBasis: "NO_ANSWER_BASIS",
      answerBasisNote: "답변 기준이 필요합니다.",
      answerBasisAction: "이 상품에 등록된 지식이 없습니다. 상품 지식을 등록하면 근거가 생깁니다.",
      evidence: [],
    }));
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText("답변 기준이 필요합니다.")).toBeInTheDocument();
    expect(screen.getByText(/상품 지식을 등록하면 근거가 생깁니다/)).toBeInTheDocument();
    expect(screen.queryByText(/안내드리겠습니다/))
      .toBeNull();
    expect(screen.queryByText(/담당자/)).toBeNull();
  });

  it("no basis: whatever the seller had already typed is left alone", async () => {
    generateInquiryDraft.mockResolvedValue(generated({
      draft: null,
      authorKind: null,
      knowledgeState: "NO_MATCH",
      knowledgeNote: "해당하는 내용이 없습니다.",
      answerBasis: "NO_ANSWER_BASIS",
      answerBasisNote: "답변 기준이 필요합니다.",
      answerBasisAction: null,
      evidence: [],
    }));
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    await screen.findByText("답변 기준이 필요합니다.");

    // The editor is open and the seller can write — a declined generate must not clear their box.
    const box = screen.getByLabelText(/^내용$/);
    await user.type(box, "규격을 알려주시면");
    expect(box).toHaveValue("규격을 알려주시면");
  });

  it("names the product and the channel the answer is about, and how long it has waited", async () => {
    render(<InquiryResponsePanel workItemId="w1" />);
    expect(await screen.findByText("선바로 일체형 전선몰딩")).toBeInTheDocument();
    expect(screen.getByText("카페24 자사몰")).toBeInTheDocument();
  });

  it("says 상품 미지정 rather than hiding it — it is WHY a draft could not be grounded", async () => {
    getInquiryDetailStrict.mockResolvedValue(detail({ productId: null, productName: null }));
    render(<InquiryResponsePanel workItemId="w1" />);
    expect(await screen.findByText("상품 미지정")).toBeInTheDocument();
  });

  it("warns BEFORE the press when the answer state cannot be proven current", async () => {
    getInquiryDetailStrict.mockResolvedValue(detail({
      phase: "PROPOSED",
      channelCode: "COUPANG",
      channelNameKo: "쿠팡",
      answerStateProven: false,
      answerStateNote: "이 채널의 문의 수집이 최신이 아니라, 이 문의에 이미 답변이 달렸는지 지금은 확인할 수 없습니다.",
      draft: generated().draft,
    }));
    getInquiryPublishCapability.mockResolvedValue({
      executionEnabled: true,
      replyAdapterChannelCodes: ["COUPANG"],
    });
    render(<InquiryResponsePanel workItemId="w1" />);

    // The warning has to be readable while the send is still un-pressed. A note that only appears in
    // the publish result would be telling the seller after the reply had already gone.
    expect(await screen.findByText(/이미 답변이 달렸는지 지금은 확인할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /답변 보내기/ })).toBeInTheDocument();
  });

  it("groups the citations by where they came from — a wrong reply is fixed in one place, not three", async () => {
    // A spec is corrected in 상품 지식, a shipping promise in 운영 정책, and a past answer is neither.
    // Rendering them as one undifferentiated list tells a seller that something is wrong and not
    // where to go and change it.
    generateInquiryDraft.mockResolvedValue(
      generated({
        knowledgeNote: "판매자가 등록한 상품 정보·운영 정책을 근거로 썼습니다.",
        evidence: [
          { kind: "PRODUCT_KNOWLEDGE", scopeLabel: "상품 정보", title: "사용법", locator: "product-knowledge/USAGE:데모 운영자", sourceId: "s1", chunkId: "c1" },
          { kind: "ORG_POLICY", scopeLabel: "운영 정책", title: "교환 및 반품 안내", locator: "org-policy/EXCHANGE_REFUND_POLICY:데모 운영자#v2", sourceId: "s2", chunkId: "c2" },
          { kind: "ANSWER_MEMORY", scopeLabel: "과거 답변", title: "채널에 등록된 답변", locator: "answer-memory/IMPORTED_SELLER_ANSWER:NAVER", sourceId: "s3", chunkId: null },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    expect(await screen.findByText("상품 정보")).toBeInTheDocument();
    expect(screen.getByText("운영 정책")).toBeInTheDocument();
    expect(screen.getByText("과거 답변")).toBeInTheDocument();
    expect(screen.getByText("교환 및 반품 안내")).toBeInTheDocument();
    // The transport-shaped storage vocabulary stays out of the seller's view.
    expect(screen.queryByText("ORG_POLICY")).not.toBeInTheDocument();
    expect(screen.queryByText("ANSWER_MEMORY")).not.toBeInTheDocument();
  });
});

/**
 * 초안 복사 — the control the screen's own instruction asked for.
 *
 * Where SellerOps cannot register the reply itself, the panel tells the seller to copy the draft and
 * paste it into the marketplace. It offered no way to do it. What matters about the control that
 * closes that gap is WHICH text it can reach: the saved version, never the editor buffer — the same
 * rule the review lane enforces, for the same reason.
 */
describe("InquiryResponsePanel — 초안 복사", () => {
  it("sits inside the draft card, once — it was one pixel below the fold under it", async () => {
    // Measured at 1440x900 the control landed at y=901 with the fold at 900, and 181px below it at
    // 125% zoom, so a reader shown the screen said 「이 화면에는 버튼이 하나도 없다」. A block's own
    // copy control belongs in the block's header, where it is visible whenever the draft is.
    const user = userEvent.setup();
    render(<InquiryResponsePanel workItemId="w1" />);
    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));

    const copy = await screen.findByRole("button", { name: "초안 복사" });
    // Exactly one — it is not also repeated under the evidence fold.
    expect(screen.getAllByRole("button", { name: "초안 복사" })).toHaveLength(1);
    // In the same card as the draft's own title and body.
    const card = copy.closest("div.rounded-xl");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("[답변] 사용 방법")).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText("테이프를 벗기고 벽면에 붙이시면 됩니다."),
    ).toBeInTheDocument();
  });

  it("copies the saved draft, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // After `setup()`, never before: user-event installs its own clipboard stub on the document's
    // window, so a stub written first is the one that gets replaced.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    const copy = await screen.findByRole("button", { name: "초안 복사" });
    await user.click(copy);

    expect(writeText).toHaveBeenCalledWith(
      "[답변] 사용 방법\n\n테이프를 벗기고 벽면에 붙이시면 됩니다.",
    );
    expect(await screen.findByRole("button", { name: "복사했습니다" })).toBeInTheDocument();
  });

  it("is not offered while the editor is open — an unsaved keystroke is not a draft", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    await screen.findByRole("button", { name: "초안 복사" });
    await user.click(screen.getByRole("button", { name: "수정" }));

    expect(screen.queryByRole("button", { name: "초안 복사" })).toBeNull();
  });

  it("reveals the text instead of claiming a copy when the origin has no clipboard", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<InquiryResponsePanel workItemId="w1" />);

    await user.click(await screen.findByRole("button", { name: /초안 만들기/ }));
    await user.click(await screen.findByRole("button", { name: "초안 복사" }));

    expect(screen.queryByRole("button", { name: "복사했습니다" })).toBeNull();
    expect(await screen.findByLabelText("복사할 초안")).toHaveValue(
      "[답변] 사용 방법\n\n테이프를 벗기고 벽면에 붙이시면 됩니다.",
    );
  });
});

/**
 * <b>The section names the version's author</b> (Pilot QA, 2026-09-06).
 *
 * On the live org the model's v1 was rewritten by the seller as v2, and the panel presented that v2
 * under 「AI가 준비한 답변」 — the seller's own sentence, including an operational promise no
 * registered knowledge supports, attributed to the assistant. The ledger recorded `author_kind`
 * throughout; only the screen was silent.
 */
describe("draft provenance — the heading may not attribute a version to the wrong author", () => {
  it("a SELLER-written version is not called AI, and says which version it is", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({
        draft: {
          version: 2,
          answerStatus: 2,
          title: "[답변] 규격 안내",
          comments: "전화로 문의 주시면 바로 확인해 드리겠습니다.",
          contentFingerprint: "b".repeat(64),
          fingerprintAlgorithm: "SHA-256",
          createdAt: "2026-09-05T00:00:00Z",
          authorKind: "SELLER",
          modelVersion: null,
          knowledgeState: null,
          knowledgeNote: null,
        },
      }),
    );
    render(<InquiryResponsePanel workItemId="w1" />);
    expect(await screen.findByText("내가 쓴 답변")).toBeInTheDocument();
    expect(screen.queryByText("AI가 준비한 답변")).toBeNull();
    expect(screen.getByTestId("draft-provenance")).toHaveTextContent("버전 2 · 판매자 수정");
  });

  it("a MODEL version keeps the AI heading and says so on its own line", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({
        draft: {
          version: 1,
          answerStatus: 2,
          title: "[답변] 사용 방법",
          comments: "테이프를 벗기고 벽면에 붙이시면 됩니다.",
          contentFingerprint: "c".repeat(64),
          fingerprintAlgorithm: "SHA-256",
          createdAt: "2026-08-24T00:00:00Z",
          authorKind: "MODEL",
          modelVersion: "test-model/v1",
          knowledgeState: "GROUNDED",
          knowledgeNote: null,
        },
      }),
    );
    render(<InquiryResponsePanel workItemId="w1" />);
    expect(await screen.findByText("AI가 준비한 답변")).toBeInTheDocument();
    expect(screen.getByTestId("draft-provenance")).toHaveTextContent("버전 1 · AI 작성");
  });
});
