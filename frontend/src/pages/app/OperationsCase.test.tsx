// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { OperationsCaseDetail } from "../../lib/customerOperationsTypes";
import { expectNoAxeViolations } from "../../test/axe";

const api = vi.hoisted(() => ({
  getOperationsCase: vi.fn(),
  teachOperationsCase: vi.fn(),
  editOperationsCaseDraft: vi.fn(),
  correctOperationsCase: vi.fn(),
  getOperationsCaseMedia: vi.fn(),
}));
vi.mock("../../lib/apiClient", () => ({ api, getToken: () => null }));

import { OperationsCase } from "./OperationsCase";

function detail(over: Partial<OperationsCaseDetail> = {}): OperationsCaseDetail {
  return {
    caseId: "case-1",
    open: true,
    subjectKind: "INQUIRY",
    channelNameKo: "네이버 스마트스토어",
    productName: "선바로 일체형 전선몰딩",
    productScopeAvailable: true,
    receivedOn: "2026-09-17",
    rating: null,
    title: "방수 되나요?",
    body: "욕실에 붙이려는데 방수 되는지 궁금합니다.",
    reasonNote: "고객이 답변을 기다리고 있습니다.",
    disposition: "NEEDS_DECISION",
    decidedBy: "AGENT",
    summary: "고객이 욕실 사용 가능 여부를 묻고 있습니다.",
    recommendedActionType: "REPLY_TO_CUSTOMER",
    recommendedAction: "방수 여부를 확인해 답변해 주세요.",
    missingInformation: ["「방수」에 대한 판매자 안내 기준"],
    whyDecisionNeeded: "답변에 필요한 회사 정보가 없어 Reviewnary가 답을 만들 수 없습니다.",
    investigated: [
      { label: "고객이 남긴 내용", results: 1 },
      { label: "회사·상품 지식", results: 0 },
    ],
    knowledgeUsed: [],
    gap: { missingSubject: "방수", sentence: "「방수」에 대해 고객에게 안내할 기준이 없습니다.", suggestedScope: "PRODUCT" },
    draft: null,
    to: "/inquiries/inq-1",
    ...over,
  };
}

function taught(): OperationsCaseDetail {
  return detail({
    gap: null,
    missingInformation: [],
    whyDecisionNeeded: "고객에게 무엇을 말하거나 약속할지는 판매자가 정합니다.",
    knowledgeUsed: [
      {
        authority: "판매자가 확정한 상품 지식",
        provenance: "판매자가 등록한 상품 지식",
        title: "방수 안내",
        excerpt: "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.",
        capturedOn: "2026-09-18",
        cited: true,
        scope: "PRODUCT",
        pastAnswer: false,
        reusableText: null,
      },
    ],
    draft: {
      version: 2,
      title: "[답변] 방수",
      body: "생활 방수가 되어 욕실에도 사용하실 수 있습니다.",
      authorKind: "MODEL",
      answerBasis: "GROUNDED",
      evidence: [{ kind: "PRODUCT_KNOWLEDGE", scopeLabel: "상품 정보", title: "방수 안내", snippet: "생활 방수" }],
    },
  });
}

/** The folded evidence's own control — a native <summary>, which carries no button role in jsdom. */
function evidenceToggle(): HTMLElement {
  const summary = [...document.querySelectorAll("summary")].find((el) => el.textContent?.startsWith("근거"));
  if (!summary) throw new Error("no evidence disclosure");
  return summary as HTMLElement;
}

function renderCase() {
  return render(
    <MemoryRouter initialEntries={["/customer-operations/cases/case-1"]}>
      <Routes>
        <Route path="/customer-operations/cases/:caseId" element={<OperationsCase />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The case screen: what happened, what was investigated, which company knowledge was used, and — when knowledge is
 * what is missing — the one place to supply it. Teaching re-prepares the answer on the same screen.
 */
describe("OperationsCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows what was investigated, what is missing, and why the seller is needed", async () => {
    api.getOperationsCase.mockResolvedValue(detail());

    const { container } = renderCase();

    expect(await screen.findByRole("heading", { level: 1, name: "방수 되나요?" })).toBeTruthy();
    expect(screen.getByText(/욕실에 붙이려는데/)).toBeTruthy();
    // 자동 확인 → 내 확인 필요: what was found, then what is left and why.
    expect(screen.getByText("방수 정보 없음")).toBeTruthy();
    expect(screen.getByText("답변 확인 후 발송")).toBeTruthy();
    expect(screen.getByText("답변에 필요한 회사 정보가 없어 Reviewnary가 답을 만들 수 없습니다.")).toBeTruthy();
    // A check that found nothing says so instead of printing 0.
    expect(screen.getByText("회사·상품 지식 없음")).toBeTruthy();
    expect(screen.getByText("고객이 남긴 내용 1")).toBeTruthy();
    expect(screen.getByText("사용한 근거 없음")).toBeTruthy();
    expect(screen.getByText("「방수」에 대해 고객에게 안내할 기준이 없습니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /원문 보기/ }).getAttribute("href")).toBe("/inquiries/inq-1");
    await expectNoAxeViolations(container);
  });

  it("teaching the missing knowledge replaces the ask with the regenerated answer and its sources", async () => {
    api.getOperationsCase.mockResolvedValue(detail());
    api.teachOperationsCase.mockResolvedValue(taught());
    const user = userEvent.setup();

    renderCase();
    await user.type(
      await screen.findByLabelText("안내 내용"),
      "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.",
    );
    await user.click(screen.getByRole("button", { name: "저장 후 초안 재작성" }));

    await waitFor(() =>
      expect(api.teachOperationsCase).toHaveBeenCalledWith("case-1", {
        content: "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.",
        scope: "PRODUCT",
      }),
    );
    // The ask is replaced by what was saved, where, and that the answer was re-drafted from it.
    const receipt = await screen.findByRole("status", { name: "저장됨" });
    expect(within(receipt).getByText("저장됨 · 이 상품")).toBeTruthy();
    expect(within(receipt).getByText("제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.")).toBeTruthy();
    expect(within(receipt).getByText(/초안 재작성 완료/)).toBeTruthy();
    expect(screen.queryByText("「방수」에 대해 고객에게 안내할 기준이 없습니다.")).toBeNull();
    const draft = screen.getByRole("region", { name: "답변 초안" });
    expect(within(draft).getByText(/생활 방수가 되어 욕실에도/)).toBeTruthy();
    expect(within(draft).getByText("미발송")).toBeTruthy();
    expect(within(draft).getByText("상품 정보 1")).toBeTruthy();
    await user.click(evidenceToggle());
    expect(screen.getByText("판매자가 확정한 상품 지식")).toBeTruthy();
  });

  it("a past answer on a similar question is shown as precedent and can be confirmed as today's basis", async () => {
    api.getOperationsCase.mockResolvedValue(
      detail({
        knowledgeUsed: [
          {
            authority: "과거 판매자 답변",
            provenance: "문의 답변 · 채널에 등록된 답변",
            title: "[답변] 욕실 사용",
            excerpt: "욕실 벽면에도 붙이실 수 있습니다.",
            capturedOn: "2026-07-02",
            cited: false,
            scope: "PRODUCT",
            pastAnswer: true,
            reusableText: "욕실 벽면에도 붙이실 수 있습니다. 다만 물이 직접 닿는 곳은 피해 주세요.",
          },
        ],
      }),
    );
    api.teachOperationsCase.mockResolvedValue(taught());
    const user = userEvent.setup();

    renderCase();
    await screen.findByLabelText("안내 내용");
    await user.click(evidenceToggle());
    expect(screen.getByText("과거 답변")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "과거 답변 불러오기" }));
    expect((screen.getByLabelText("안내 내용") as HTMLTextAreaElement).value).toBe(
      "욕실 벽면에도 붙이실 수 있습니다. 다만 물이 직접 닿는 곳은 피해 주세요.",
    );
    await user.click(screen.getByRole("button", { name: "저장 후 초안 재작성" }));

    await waitFor(() =>
      expect(api.teachOperationsCase).toHaveBeenCalledWith("case-1", {
        content: "욕실 벽면에도 붙이실 수 있습니다. 다만 물이 직접 닿는 곳은 피해 주세요.",
        scope: "PRODUCT",
      }),
    );
  });

  it("a past answer found where no knowledge was starts the seller's answer — saved as it is or edited, it is taught", async () => {
    const past = "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.";
    api.getOperationsCase.mockResolvedValue(
      detail({
        gap: {
          missingSubject: "방수",
          sentence: "「방수」에 대해 고객에게 안내할 기준이 없습니다.",
          suggestedScope: "PRODUCT",
          prefill: { text: past, strengthKo: "채널에 등록된 답변", answeredOn: "2026-07-02" },
        },
      }),
    );
    api.teachOperationsCase.mockResolvedValue(taught());
    const user = userEvent.setup();

    const { container } = renderCase();
    const box = (await screen.findByLabelText("안내 내용")) as HTMLTextAreaElement;
    // The ask is still an ask: the gap sentence stands, and the past answer is offered as the seller's starting text.
    expect(screen.getByText("「방수」에 대해 고객에게 안내할 기준이 없습니다.")).toBeTruthy();
    expect(box.value).toBe(past);
    expect(screen.getByText(/예전에 비슷한 문의에 이렇게 답하셨습니다/)).toBeTruthy();
    expect(screen.getByText("과거 답변 · 채널에 등록된 답변 · 2026-07-02")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "과거 답변 불러오기" })).toBeNull();
    await expectNoAxeViolations(container);

    await user.clear(box);
    await user.type(box, "생활 방수가 되어 욕실 벽면과 주방에도 부착하실 수 있습니다.");
    await user.click(screen.getByRole("button", { name: "저장 후 초안 재작성" }));

    await waitFor(() =>
      expect(api.teachOperationsCase).toHaveBeenCalledWith("case-1", {
        content: "생활 방수가 되어 욕실 벽면과 주방에도 부착하실 수 있습니다.",
        scope: "PRODUCT",
      }),
    );
    expect(await screen.findByRole("status", { name: "저장됨" })).toBeTruthy();
  });

  it("a partly covered inquiry shows what is confirmed and asks only for what is missing (Inquiry Decision v2)", async () => {
    const past = "연결캡과 엘보캡은 몰딩과 같은 호수로 구매하시면 됩니다.";
    api.getOperationsCase.mockResolvedValue(
      detail({
        gap: {
          missingSubject: "마감캡 끝이 뚫려 있는지",
          sentence: "「마감캡 끝이 뚫려 있는지」에 대해 고객에게 안내할 기준이 없습니다.",
          suggestedScope: "PRODUCT",
          prefill: { text: past, strengthKo: null, answeredOn: null },
          needs: [
            { ask: "마감캡 끝이 뚫려 있는지", status: "UNKNOWN", statusKo: "읽지 못한 자료에 있을 수 있음", covered: false,
              evidence: [], missing: "마감캡 구조가 등록된 자료에 없습니다.", askCustomer: null, prefill: null,
              systemWillRead: false },
            { ask: "8.5mm 케이블에 맞는 호수", status: "FULL", statusKo: "확인됨", covered: true,
              evidence: ["상품 정보 · 선바로 내경표"], missing: null, askCustomer: null, prefill: null,
              systemWillRead: false },
            { ask: "엘보 구간에 쓸 사이즈", status: "NONE", statusKo: "기준 없음", covered: false, evidence: [],
              missing: null, askCustomer: null, prefill: { text: past, strengthKo: null, answeredOn: null },
              systemWillRead: true },
          ],
        },
        knowledgeUsed: [
          { label: "과거 답변", title: "주문 발송", excerpt: "어제 발송되었습니다.", pastAnswer: true,
            reusableText: "주문하신 상품은 어제 발송되었습니다." },
        ],
      } as never),
    );
    const { container } = renderCase();
    const box = (await screen.findByLabelText("안내 내용")) as HTMLTextAreaElement;

    const confirmed = screen.getByRole("region", { name: "이미 확인된 내용" });
    expect(within(confirmed).getByText("8.5mm 케이블에 맞는 호수")).toBeTruthy();
    expect(within(confirmed).getByText("상품 정보 · 선바로 내경표")).toBeTruthy();
    const missing = screen.getByRole("region", { name: "알려 주셔야 하는 내용" });
    expect(within(missing).getByText("마감캡 끝이 뚫려 있는지")).toBeTruthy();
    expect(within(missing).getByText("엘보 구간에 쓸 사이즈")).toBeTruthy();
    expect(within(missing).queryByText("8.5mm 케이블에 맞는 호수")).toBeNull();
    expect(within(missing).getByText(/Reviewnary가 읽으면/)).toBeTruthy();
    // Only the judged, reusable precedent starts the answer; an order's past answer is never offered here.
    expect(box.value).toBe(past);
    expect(screen.queryByRole("button", { name: "과거 답변 불러오기" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("confirming the prefilled past answer unchanged is one press", async () => {
    const past = "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.";
    api.getOperationsCase.mockResolvedValue(
      detail({
        gap: {
          missingSubject: "방수",
          sentence: "「방수」에 대해 고객에게 안내할 기준이 없습니다.",
          suggestedScope: "PRODUCT",
          prefill: { text: past, strengthKo: null, answeredOn: null },
        },
      }),
    );
    api.teachOperationsCase.mockResolvedValue(taught());
    const user = userEvent.setup();

    renderCase();
    await screen.findByLabelText("안내 내용");
    await user.click(screen.getByRole("button", { name: "저장 후 초안 재작성" }));

    await waitFor(() =>
      expect(api.teachOperationsCase).toHaveBeenCalledWith("case-1", { content: past, scope: "PRODUCT" }),
    );
  });

  it("a review's photos show what Reviewnary saw — and a photo it did not look at is never described", async () => {
    api.getOperationsCase.mockResolvedValue(
      detail({
        subjectKind: "REVIEW",
        rating: 5,
        title: null,
        body: "별은 5개인데 모서리가 깨져서 왔어요.",
        gap: null,
        media: [
          {
            ordinal: 1, kind: "IMAGE", inspected: true, statusKo: "Reviewnary가 사진을 확인했습니다.",
            depicts: "모서리가 깨진 흰색 몰딩", problemVisible: "YES", problemDescription: "한쪽 모서리가 깨져 있습니다",
            imagePath: "/api/responsibilities/customer-operations/cases/case-1/media/1",
          },
          {
            ordinal: 2, kind: "IMAGE", inspected: false,
            statusKo: "사진 확인 기능이 꺼져 있어 사진 내용은 보지 않았습니다.", depicts: null, problemVisible: null,
            problemDescription: null, imagePath: "/api/responsibilities/customer-operations/cases/case-1/media/2",
          },
        ],
      }),
    );
    api.getOperationsCaseMedia.mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");

    const { container } = renderCase();

    expect(await screen.findByRole("list", { name: "고객이 올린 사진" })).toBeTruthy();
    expect(await screen.findByAltText("고객이 올린 사진 1")).toBeTruthy();
    expect(screen.getByText("분석: 모서리가 깨진 흰색 몰딩")).toBeTruthy();
    expect(screen.getByText("문제 보임")).toBeTruthy();
    expect(screen.getByText("사진 확인 기능이 꺼져 있어 사진 내용은 보지 않았습니다.")).toBeTruthy();
    // The photo nobody looked at gets no description and no verdict.
    expect(screen.getAllByText(/^분석:/)).toHaveLength(1);
    expect(screen.getAllByText(/문제 보임|이상 없음|판단 어려움/)).toHaveLength(1);
    // A review with no title is named by its first line.
    expect(screen.getByRole("heading", { level: 1, name: "별은 5개인데 모서리가 깨져서 왔어요." })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("an inquiry with no named product can only be taught company-wide", async () => {
    api.getOperationsCase.mockResolvedValue(detail({ productScopeAvailable: false, productName: null }));

    renderCase();
    await screen.findByLabelText("안내 내용");

    expect(screen.queryByLabelText("이 상품")).toBeNull();
    expect((screen.getByLabelText("회사 전체") as HTMLInputElement).checked).toBe(true);
  });

  it("rewriting the draft asks whether to keep it, and nothing on this screen sends it", async () => {
    api.getOperationsCase.mockResolvedValue(taught());
    api.editOperationsCaseDraft.mockResolvedValue(taught());
    const user = userEvent.setup();

    renderCase();
    // The draft is read first; 「유사 건에 재사용」 is offered only while editing.
    const card = await screen.findByRole("region", { name: "답변 초안" });
    expect(within(card).queryByLabelText("유사 건에 재사용")).toBeNull();
    await user.click(within(card).getByRole("button", { name: "수정" }));
    const editor = within(card).getByLabelText("답변 초안") as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, "생활 방수가 되지만 물에 잠기는 곳은 피해 주세요.");
    await user.click(within(card).getByLabelText("유사 건에 재사용"));
    await user.click(within(card).getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(api.editOperationsCaseDraft).toHaveBeenCalledWith("case-1", {
        body: "생활 방수가 되지만 물에 잠기는 곳은 피해 주세요.",
        remember: true,
        scope: "PRODUCT",
      }),
    );
    expect(within(card).getByText("미발송")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /발송 화면으로/ }).getAttribute("href")).toBe("/inquiries/inq-1");
    // Nothing on this screen sends: no button says it sends.
    expect(screen.queryByRole("button", { name: /발송|보내기|전송/ })).toBeNull();
  });

  it("a correction records what the seller thinks, with 「다음에도 참고」 as their choice", async () => {
    api.getOperationsCase.mockResolvedValue(detail());
    api.correctOperationsCase.mockResolvedValue(detail());
    const user = userEvent.setup();

    renderCase();
    await user.click(await screen.findByRole("button", { name: "처리 변경" }));
    const form = screen.getByRole("region", { name: "처리 변경" });
    await user.selectOptions(within(form).getByLabelText("처리 방법"), "REFUND_OR_COMPENSATION");
    await user.type(within(form).getByLabelText("메모 (선택)"), "이런 건은 환불로 처리합니다.");
    expect((within(form).getByLabelText("유사 건에 재사용") as HTMLInputElement).checked).toBe(true);
    await user.click(within(form).getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(api.correctOperationsCase).toHaveBeenCalledWith("case-1", {
        correctedActionType: "REFUND_OR_COMPENSATION",
        note: "이런 건은 환불로 처리합니다.",
        remember: true,
        scope: "PRODUCT",
      }),
    );
  });

  it("a case the Agent closed shows its final state and the Agent's judgement — not the rule's detection or the model's advice", async () => {
    api.getOperationsCase.mockResolvedValue(
      detail({
        open: false, subjectKind: "REVIEW", rating: 5, title: null, gap: null, missingInformation: [],
        body: "구형주택이라 전선 정리가 힘들었는데 깨끗하게 마무리 했습니다",
        disposition: "AUTO_RESOLVED", decidedBy: "AGENT",
        reasonNote: "별점은 높지만 불편을 말하는 내용이 있습니다.",
        summary: "5점 긍정 리뷰로 제품 만족도가 높습니다.",
        recommendedActionType: "NO_ACTION",
        recommendedAction: "이번 건은 추가 조치 없이 모니터링만 하시면 됩니다.",
        whyDecisionNeeded: null,
      }),
    );
    renderCase();
    const card = await screen.findByTestId("work-flow-card");
    expect(card).toHaveTextContent("정리함");
    expect(card).toHaveTextContent("5점 긍정 리뷰로 제품 만족도가 높습니다.");
    expect(card).toHaveTextContent("내가 확인할 일없음");
    // Earlier-stage text that the final state overruled is not shown anywhere on the screen.
    expect(screen.queryByText(/불편을 말하는 내용이 있습니다/)).toBeNull();
    expect(screen.queryByText(/모니터링만 하시면/)).toBeNull();
    expect(screen.queryByText("처리됨")).toBeNull();
  });

  it("a case the rule is watching says so and asks the seller for nothing", async () => {
    api.getOperationsCase.mockResolvedValue(
      detail({
        subjectKind: "REVIEW", rating: 5, title: null, gap: null, missingInformation: [], summary: null,
        body: "좋아요. 마감도 괜찮네요", disposition: "MONITORING", decidedBy: "RULE",
        reasonNote: "별점은 높지만 글이 있어 바로 닫지 않고 지켜봅니다.",
        recommendedActionType: null, recommendedAction: null, whyDecisionNeeded: null, investigated: [],
      }),
    );
    renderCase();
    const card = await screen.findByTestId("work-flow-card");
    expect(card).toHaveTextContent("지켜보는 중");
    expect(card).toHaveTextContent("별점은 높지만 글이 있어 바로 닫지 않고 지켜봅니다.");
    expect(card).not.toHaveTextContent("판단 필요");
    // The note is said once, in the card.
    expect(screen.getAllByText("별점은 높지만 글이 있어 바로 닫지 않고 지켜봅니다.")).toHaveLength(1);
  });

  /**
   * The channel sends markup and the stored row keeps it; the screen is where it comes off. Measured on the demo
   * org, this case's body arrived as `<meta charset="utf-8">교환 신청은 언제까지 가능한가요?` and the tag was the
   * first thing a seller read on the first case they opened — while `/inquiries`, showing the same customer,
   * stripped it. One helper, so the two screens cannot show one customer different words.
   */
  it("채널이 보낸 마크업은 화면에서 벗겨진다 — 문의 화면과 같은 문장을 보인다", async () => {
    api.getOperationsCase.mockResolvedValue(
      detail({ title: null, body: '<meta charset="utf-8">교환 신청은 언제까지 가능한가요?' }),
    );
    renderCase();
    // The headline falls through the same body, so the stripped sentence stands in both places.
    expect(await screen.findAllByText("교환 신청은 언제까지 가능한가요?")).not.toHaveLength(0);
    expect(document.body.textContent).not.toContain("<meta");
    expect(document.body.textContent).not.toContain("charset");
  });

  /**
   * 「사용한 근거 없음」 is a claim about the case, and the draft standing on the same screen can already disprove
   * it: `knowledgeUsed` is empty because the rule lane does not record it, which is a fact about our bookkeeping.
   * Measured: a case whose draft cited 「운영 정책 · 교환·반품 기준」 rendered 「사용한 근거 없음」 two blocks below
   * that citation. It stays silent there — it does not restate the citation either, because the draft card owns it.
   */
  it("초안이 근거를 인용하는 동안 「사용한 근거 없음」이라고 말하지 않는다", async () => {
    api.getOperationsCase.mockResolvedValue(
      detail({
        knowledgeUsed: [], gap: null, missingInformation: [],
        draft: {
          version: 1, title: "교환 신청 가능 기간 안내", body: "상품 수령 후 7일 이내입니다.",
          authorKind: "MODEL", answerBasis: "GROUNDED",
          evidence: [{ kind: "ORG_POLICY", scopeLabel: "운영 정책", title: "교환·반품 기준", snippet: null }],
        },
      }),
    );
    renderCase();
    // The draft card names the evidence it stood on.
    expect(await screen.findByText(/운영 정책/)).toBeInTheDocument();
    expect(screen.queryByText("사용한 근거 없음")).toBeNull();
  });
});
