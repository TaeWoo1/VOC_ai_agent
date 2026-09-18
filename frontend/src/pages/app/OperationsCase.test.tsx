// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { OperationsCaseDetail } from "../../lib/customerOperationsTypes";
import { expectNoAxeViolations } from "../../test/axe";

const api = vi.hoisted(() => ({
  getOperationsCase: vi.fn(),
  teachOperationsCase: vi.fn(),
  editOperationsCaseDraft: vi.fn(),
  correctOperationsCase: vi.fn(),
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

    expect(await screen.findByText("방수 되나요?")).toBeTruthy();
    expect(screen.getByText(/욕실에 붙이려는데/)).toBeTruthy();
    expect(screen.getByText(/회사·상품 지식 0건/)).toBeTruthy();
    expect(screen.getByText("이 건에 쓸 수 있는 회사 지식을 찾지 못했습니다.")).toBeTruthy();
    expect(screen.getByText("「방수」에 대해 고객에게 안내할 기준이 없습니다.")).toBeTruthy();
    expect(screen.getByText(/판매자 확인이 필요한 이유/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "문의 화면에서 보기" }).getAttribute("href")).toBe("/inquiries/inq-1");
    await expectNoAxeViolations(container);
  });

  it("teaching the missing knowledge replaces the ask with the regenerated answer and its sources", async () => {
    api.getOperationsCase.mockResolvedValue(detail());
    api.teachOperationsCase.mockResolvedValue(taught());
    const user = userEvent.setup();

    renderCase();
    await user.click(await screen.findByRole("button", { name: "정보 알려주기" }));
    await user.type(
      screen.getByLabelText("고객에게 안내할 내용"),
      "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.",
    );
    await user.click(screen.getByRole("button", { name: "저장하고 다시 준비" }));

    await waitFor(() =>
      expect(api.teachOperationsCase).toHaveBeenCalledWith("case-1", {
        content: "제품 표면은 생활 방수가 되어 욕실 벽면에도 부착하실 수 있습니다.",
        scope: "PRODUCT",
      }),
    );
    expect(await screen.findByText("판매자가 확정한 상품 지식")).toBeTruthy();
    expect(screen.getByText("준비된 답변")).toBeTruthy();
    expect(screen.queryByText("「방수」에 대해 고객에게 안내할 기준이 없습니다.")).toBeNull();
    expect((screen.getByLabelText("답변 초안") as HTMLTextAreaElement).value).toContain("생활 방수");
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
    expect(await screen.findByText("지난 답변")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "지난 답변을 기준으로 쓰기" }));
    expect((screen.getByLabelText("고객에게 안내할 내용") as HTMLTextAreaElement).value).toBe(
      "욕실 벽면에도 붙이실 수 있습니다. 다만 물이 직접 닿는 곳은 피해 주세요.",
    );
    await user.click(screen.getByRole("button", { name: "저장하고 다시 준비" }));

    await waitFor(() =>
      expect(api.teachOperationsCase).toHaveBeenCalledWith("case-1", {
        content: "욕실 벽면에도 붙이실 수 있습니다. 다만 물이 직접 닿는 곳은 피해 주세요.",
        scope: "PRODUCT",
      }),
    );
  });

  it("an inquiry with no named product can only be taught company-wide", async () => {
    api.getOperationsCase.mockResolvedValue(detail({ productScopeAvailable: false, productName: null }));
    const user = userEvent.setup();

    renderCase();
    await user.click(await screen.findByRole("button", { name: "정보 알려주기" }));

    expect(screen.queryByText(/이 상품에만/)).toBeNull();
    expect(screen.getByLabelText("회사 전체 기준으로")).toBeTruthy();
  });

  it("rewriting the draft asks whether to keep it, and nothing on this screen sends it", async () => {
    api.getOperationsCase.mockResolvedValue(taught());
    api.editOperationsCaseDraft.mockResolvedValue(taught());
    const user = userEvent.setup();

    renderCase();
    const editor = (await screen.findByLabelText("답변 초안")) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, "생활 방수가 되지만 물에 잠기는 곳은 피해 주세요.");
    await user.click(screen.getByLabelText(/다음에도 참고하기 \(비슷한 건에서/));
    await user.click(screen.getByRole("button", { name: "고쳐 쓰기 저장" }));

    await waitFor(() =>
      expect(api.editOperationsCaseDraft).toHaveBeenCalledWith("case-1", {
        body: "생활 방수가 되지만 물에 잠기는 곳은 피해 주세요.",
        remember: true,
        scope: "PRODUCT",
      }),
    );
    expect(screen.getByText(/아직 보내지 않았습니다/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "문의 화면에서 답변 보내기" }).getAttribute("href")).toBe("/inquiries/inq-1");
    expect(screen.queryByRole("button", { name: /보내기/ })).toBeNull();
  });

  it("a correction records what the seller thinks, with 「다음에도 참고」 as their choice", async () => {
    api.getOperationsCase.mockResolvedValue(detail());
    api.correctOperationsCase.mockResolvedValue(detail());
    const user = userEvent.setup();

    renderCase();
    await user.click(await screen.findByRole("button", { name: "다르게 처리해야 해요" }));
    await user.selectOptions(screen.getByLabelText("맞는 처리 방법"), "REFUND_OR_COMPENSATION");
    await user.type(screen.getByLabelText("이렇게 처리하는 이유 (선택)"), "이런 건은 환불로 처리합니다.");
    await user.click(screen.getByRole("button", { name: "저장" }));

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
