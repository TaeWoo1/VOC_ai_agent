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
});
