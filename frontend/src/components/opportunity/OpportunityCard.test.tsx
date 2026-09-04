// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OpportunityCard } from "./OpportunityCard";
import type { OpportunityView } from "../../lib/types";

const acceptOpportunity = vi.fn();
const dismissOpportunity = vi.fn();
const restoreOpportunity = vi.fn();
const updateOpportunityDraft = vi.fn();
const createProductKnowledgeSource = vi.fn();
const getProductKnowledgeStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    acceptOpportunity: (i: string, k: string) => acceptOpportunity(i, k),
    dismissOpportunity: (i: string, k: string) => dismissOpportunity(i, k),
    restoreOpportunity: (i: string, k: string) => restoreOpportunity(i, k),
    updateOpportunityDraft: (i: string, k: string, d: unknown) => updateOpportunityDraft(i, k, d),
    createProductKnowledgeSource: (p: string, r: unknown) => createProductKnowledgeSource(p, r),
    createOrgKnowledge: vi.fn(),
    getProductKnowledgeStrict: (id: string) => getProductKnowledgeStrict(id),
  },
  getToken: () => "token",
}));

function opportunity(over: Partial<OpportunityView> = {}): OpportunityView {
  return {
    issueId: "issue-1", kind: "FAQ_SUPPLEMENT", kindLabelKo: "FAQ 보완", status: "OPEN", statusLabelKo: "검토 전",
    issueTitle: "접착 탈락", aspect: "접착", problem: "탈락", severity: "NORMAL", evidenceCount: 5,
    firstEvidenceOn: "2026-08-01", lastEvidenceOn: "2026-09-01", changeLabelsKo: ["증가 중"],
    productId: "p-1", productName: "선바로 일체형 전선몰딩",
    whyKo: ["「접착 탈락」 근거 리뷰 5건 (2026-08-01 ~ 2026-09-01).", "최근 판단: 증가 중.", "이 상품의 상품 지식 2건 중 '접착'을(를) 다룬 내용은 없습니다."],
    recommendationKo: "'접착' 관련 안내를 이 상품의 자주 묻는 질문에 추가하는 것을 검토하세요.",
    evidenceTo: "/memory/issue-1",
    knowledge: { scope: "PRODUCT", scopeLabelKo: "이 상품의 상품 지식", type: "USAGE", topicLabelKo: "접착", sources: 2, mentions: 0, excerpts: [] },
    nextActionKo: "FAQ 초안 준비", draft: null, decidedAt: null,
    ...over,
  };
}

function renderCard(o: OpportunityView, onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <OpportunityCard opportunity={o} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return onChanged;
}

afterEach(() => vi.clearAllMocks());

describe("개선 기회 카드 — what repeated, why, the evidence, the next action", () => {
  it("shows the backend's sentences and links to the issue's evidence", () => {
    renderCard(opportunity());
    expect(screen.getByText(/자주 묻는 질문에 추가하는 것을 검토하세요/)).toBeTruthy();
    expect(screen.getByText(/근거 리뷰 5건 \(2026-08-01 ~ 2026-09-01\)/)).toBeTruthy();
    expect(screen.getByText(/'접착'을\(를\) 다룬 내용은 없습니다/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /근거 리뷰 5건 보기/ }).getAttribute("href")).toBe("/memory/issue-1");
    expect(screen.getByRole("button", { name: "FAQ 초안 준비" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "지금은 보류" })).toBeTruthy();
    // No cause is ever asserted by this card: the sentences are the backend's, verbatim.
    expect(screen.queryByText(/원인입니다/)).toBeNull();
  });

  it("accept prepares a draft the seller can edit and file as knowledge", async () => {
    const accepted = opportunity({
      status: "ACCEPTED", statusLabelKo: "초안 준비됨",
      draft: { title: "Q. 접착 관련해서 자주 묻는 질문", body: "질문: …\n\n답변: (판매자님이 채워 주세요)", updatedAt: "2026-09-04T00:00:00Z" },
    });
    acceptOpportunity.mockResolvedValue(accepted);
    const onChanged = renderCard(opportunity());
    fireEvent.click(screen.getByRole("button", { name: "FAQ 초안 준비" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(accepted));
    expect(acceptOpportunity).toHaveBeenCalledWith("issue-1", "FAQ_SUPPLEMENT");
  });

  it("an accepted FAQ draft opens the knowledge quick-add prefilled — the write is the library's own", async () => {
    getProductKnowledgeStrict.mockResolvedValue({ variants: [] });
    createProductKnowledgeSource.mockResolvedValue({});
    renderCard(opportunity({
      status: "ACCEPTED", statusLabelKo: "초안 준비됨",
      draft: { title: "Q. 접착", body: "먼지를 닦고 붙이세요.", updatedAt: "2026-09-04T00:00:00Z" },
    }));
    expect(screen.getByLabelText("초안 내용")).toHaveProperty("value", "먼지를 닦고 붙이세요.");
    fireEvent.click(screen.getByRole("button", { name: "답변 기준으로 저장" }));
    const save = await screen.findAllByRole("button", { name: "답변 기준으로 저장" });
    fireEvent.click(save[save.length - 1]!);
    await waitFor(() => expect(createProductKnowledgeSource).toHaveBeenCalled());
    expect(createProductKnowledgeSource.mock.calls[0]![0]).toBe("p-1");
    expect(createProductKnowledgeSource.mock.calls[0]![1]).toMatchObject({ sourceType: "FAQ", body: "먼지를 닦고 붙이세요." });
    expect(await screen.findByText(/저장했습니다/)).toBeTruthy();
  });

  it("an edited draft must be saved before it can be filed; the edit goes through the draft endpoint", async () => {
    updateOpportunityDraft.mockResolvedValue(opportunity({
      status: "ACCEPTED", statusLabelKo: "초안 준비됨",
      draft: { title: "t", body: "고친 본문", updatedAt: "2026-09-04T00:00:00Z" },
    }));
    renderCard(opportunity({
      status: "ACCEPTED", statusLabelKo: "초안 준비됨",
      draft: { title: "t", body: "원래 본문", updatedAt: "2026-09-04T00:00:00Z" },
    }));
    fireEvent.change(screen.getByLabelText("초안 내용"), { target: { value: "고친 본문" } });
    expect((screen.getByRole("button", { name: "답변 기준으로 저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() => expect(updateOpportunityDraft).toHaveBeenCalledWith("issue-1", "FAQ_SUPPLEMENT", { title: "t", body: "고친 본문" }));
  });

  it("a memo kind offers a copy, never a send", () => {
    renderCard(opportunity({
      kind: "PRODUCT_IMPROVEMENT_REVIEW", kindLabelKo: "제품 개선 검토", status: "ACCEPTED", statusLabelKo: "초안 준비됨",
      knowledge: null, nextActionKo: "제품 개선 검토 메모 준비",
      draft: { title: "제품 개선 검토 메모", body: "근거 리뷰: 5건", updatedAt: "2026-09-04T00:00:00Z" },
    }));
    expect(screen.getByRole("button", { name: "메모 복사" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /저장/ })).toBeNull();
    expect(screen.queryByText(/보내기|전송|게시/)).toBeNull();
  });

  it("dismiss goes through its endpoint and hands the new state up", async () => {
    dismissOpportunity.mockResolvedValue(opportunity({ status: "DISMISSED", statusLabelKo: "보류", decidedAt: "2026-09-04T00:00:00Z" }));
    const onChanged = renderCard(opportunity());
    fireEvent.click(screen.getByRole("button", { name: "지금은 보류" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(dismissOpportunity).toHaveBeenCalledWith("issue-1", "FAQ_SUPPLEMENT");
  });

  it("a dismissed opportunity offers only 되돌리기 — the prepared action is gone with the decision", () => {
    renderCard(opportunity({ status: "DISMISSED", statusLabelKo: "보류" }));
    expect(screen.getByRole("button", { name: "되돌리기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "FAQ 초안 준비" })).toBeNull();
    expect(screen.getByText("보류")).toBeTruthy();
  });
});
