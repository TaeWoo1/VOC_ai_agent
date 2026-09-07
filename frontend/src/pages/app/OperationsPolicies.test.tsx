// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OperationsPolicies } from "./OperationsPolicies";
import type { OrgKnowledgeView } from "../../lib/types";

const listOrgKnowledge = vi.fn();
const createOrgKnowledge = vi.fn();
const updateOrgKnowledge = vi.fn();
const deleteOrgKnowledge = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    listOrgKnowledge: (...args: unknown[]) => listOrgKnowledge(...args),
    createOrgKnowledge: (...args: unknown[]) => createOrgKnowledge(...args),
    updateOrgKnowledge: (...args: unknown[]) => updateOrgKnowledge(...args),
    deleteOrgKnowledge: (...args: unknown[]) => deleteOrgKnowledge(...args),
  },
}));

function policy(over: Partial<OrgKnowledgeView> = {}): OrgKnowledgeView {
  return {
    id: "k1",
    knowledgeType: "CASH_RECEIPT",
    typeLabel: "현금영수증",
    title: "현금영수증 발급 안내",
    body: "결제 완료 후 현금영수증 발급을 요청하실 수 있습니다.",
    sourceUrl: null,
    authorName: "데모 운영자",
    version: 1,
    passageCount: 1,
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
    ...over,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <OperationsPolicies />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("운영 정책 / 답변 기준", () => {
  it("names the rule in the seller's words, never the storage enum", async () => {
    listOrgKnowledge.mockResolvedValue([policy()]);
    renderScreen();

    expect(await screen.findByText("현금영수증")).toBeInTheDocument();
    expect(screen.getByText("현금영수증 발급 안내")).toBeInTheDocument();
    // The developer vocabulary must not reach the default screen.
    expect(screen.queryByText(/CASH_RECEIPT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SHIPPING_POLICY/)).not.toBeInTheDocument();
  });

  it("says when a rule cannot be quoted, rather than listing it as if it could", async () => {
    listOrgKnowledge.mockResolvedValue([policy({ passageCount: 0 })]);
    renderScreen();

    expect(await screen.findByText(/답변에 인용할 수 없습니다/)).toBeInTheDocument();
  });

  it("never prints our word for a chunk beside the rule", async () => {
    const { container } = (listOrgKnowledge.mockResolvedValue([policy()]), renderScreen());
    await screen.findByText("현금영수증 발급 안내");

    // 「인용 단위 1개」 is the storage vocabulary and the number changes nothing a seller can do; the
    // zero case already says the one thing they can act on. Found on screen in pilot QA 2026-09-07.
    expect(container.textContent ?? "").not.toContain("인용 단위");
  });

  it("shows the revision count only once a rule has actually been revised", async () => {
    listOrgKnowledge.mockResolvedValue([policy({ version: 3 })]);
    renderScreen();

    expect(await screen.findByText(/3차 개정/)).toBeInTheDocument();
  });

  it("invites the first rule with the reason it matters, not with a blank list", async () => {
    listOrgKnowledge.mockResolvedValue([]);
    renderScreen();

    expect(await screen.findByText("아직 등록된 기준이 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/상품과 연결되지 않은 문의에도 근거를 갖고 답할 수 있습니다/))
      .toBeInTheDocument();
  });

  it("writes a rule through the API and reloads what was stored", async () => {
    listOrgKnowledge.mockResolvedValueOnce([]).mockResolvedValueOnce([policy()]);
    createOrgKnowledge.mockResolvedValue(policy());
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "기준 추가" }));
    await userEvent.type(screen.getByLabelText("제목"), "현금영수증 발급 안내");
    await userEvent.type(screen.getByLabelText("내용"), "결제 완료 후 요청하실 수 있습니다.");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(createOrgKnowledge).toHaveBeenCalledWith({
        knowledgeType: "SHIPPING_POLICY",
        title: "현금영수증 발급 안내",
        body: "결제 완료 후 요청하실 수 있습니다.",
        sourceUrl: null,
      }),
    );
    expect(await screen.findByText("현금영수증 발급 안내")).toBeInTheDocument();
  });

  it("a failed save says what the seller can do about it, not what the transport said", async () => {
    listOrgKnowledge.mockResolvedValue([]);
    createOrgKnowledge.mockRejectedValue(new Error("Request failed with status code 409"));
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "기준 추가" }));
    await userEvent.type(screen.getByLabelText("제목"), "배송 안내");
    await userEvent.type(screen.getByLabelText("내용"), "영업일 기준 2일 이내 출고됩니다.");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText(/같은 제목의 기준이 이미 있을 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/status code 409/)).not.toBeInTheDocument();
  });

  it("survives a load failure without pretending the list is empty", async () => {
    listOrgKnowledge.mockRejectedValue(new Error("boom"));
    renderScreen();

    expect(await screen.findByText("운영 기준을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByText("아직 등록된 기준이 없습니다")).not.toBeInTheDocument();
  });
});
