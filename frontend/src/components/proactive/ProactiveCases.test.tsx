// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProactiveCases } from "./ProactiveCases";
import type { ProactiveCaseView } from "../../lib/types";

const getProactiveCases = vi.fn();
const markProactiveCaseOpened = vi.fn();
const track = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getProactiveCases: (limit: number) => getProactiveCases(limit),
    markProactiveCaseOpened: (id: string) => markProactiveCaseOpened(id),
  },
  getToken: () => null,
}));
vi.mock("../../lib/analytics", () => ({
  analytics: { track: (name: string, props?: unknown) => track(name, props) },
}));

function view(over: Partial<ProactiveCaseView> = {}): ProactiveCaseView {
  return {
    id: "case-1",
    subjectKind: "INQUIRY",
    subjectId: "inq-1",
    workItemId: "wi-1",
    channelId: "ch-1",
    channelNameKo: "카페24",
    productId: null,
    productName: null,
    snippet: "배송 언제 되나요",
    rating: null,
    priority: "HIGH",
    reason: "UNANSWERED_INQUIRY",
    reasonNote: "고객이 답변을 기다리고 있습니다. 3일째 기다리고 있습니다.",
    evidenceState: "GROUNDED",
    evidenceCount: 2,
    knowledgeGap: null,
    preparedAction: "DRAFT_PREPARED",
    draftVersion: 1,
    recommendation: null,
    subjectReceivedAt: "2026-08-22T00:00:00Z",
    preparedAt: "2026-08-25T00:00:00Z",
    ...over,
  };
}

function renderSection() {
  return render(
    <MemoryRouter>
      <ProactiveCases limit={4} />
    </MemoryRouter>,
  );
}

describe("ProactiveCases", () => {
  beforeEach(() => {
    getProactiveCases.mockReset();
    markProactiveCaseOpened.mockReset().mockResolvedValue(undefined);
    track.mockReset();
  });

  it("shows why the work is here now, and what is already prepared", async () => {
    getProactiveCases.mockResolvedValue({ items: [view()], total: 1, high: 1 });

    renderSection();

    expect(await screen.findByText("배송 언제 되나요")).toBeInTheDocument();
    expect(screen.getByText(/3일째 기다리고 있습니다/)).toBeInTheDocument();
    expect(screen.getByText("답변 초안 준비됨")).toBeInTheDocument();
    expect(screen.getByText(/근거 2건 사용/)).toBeInTheDocument();
    expect(screen.getByText("먼저 확인")).toBeInTheDocument();
  });

  it("renders nothing at all when nothing is prepared — no empty state to read past", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });

    const { container } = renderSection();

    await waitFor(() => expect(getProactiveCases).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(track).not.toHaveBeenCalled();
  });

  it("is fail-soft: a dead read removes the section, never the page", async () => {
    getProactiveCases.mockRejectedValue(new Error("500"));

    const { container } = renderSection();

    await waitFor(() => expect(getProactiveCases).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("the CTA goes to the flow that already exists, and records the first look", async () => {
    getProactiveCases.mockResolvedValue({ items: [view()], total: 1, high: 1 });
    renderSection();

    const cta = await screen.findByRole("link", { name: "확인하기" });
    expect(cta).toHaveAttribute("href", "/inquiries/inq-1");

    await userEvent.click(cta);

    expect(markProactiveCaseOpened).toHaveBeenCalledWith("case-1");
    expect(track).toHaveBeenCalledWith("proactive_case_opened", { kind: "inquiry" });
  });

  it("a review card offers no send control — there is no proven review-reply write", async () => {
    getProactiveCases.mockResolvedValue({
      items: [
        view({
          id: "case-2",
          subjectKind: "REVIEW",
          subjectId: "rev-1",
          workItemId: null,
          rating: 1,
          priority: "HIGH",
          reason: "REPEAT_ISSUE_REVIEW",
          reasonNote: "같은 문제가 이 상품에서 반복되고 있습니다.",
          evidenceState: null,
          evidenceCount: 1,
          preparedAction: "RECOMMENDATION_ONLY",
          draftVersion: null,
          recommendation: "이 상품에서 「포장 파손」 문제가 3건 확인됐습니다.",
          snippet: "포장이 찢어져 있었습니다",
        }),
      ],
      total: 1,
      high: 1,
    });

    renderSection();

    expect(await screen.findByText("확인할 내용 정리됨")).toBeInTheDocument();
    expect(screen.getByText(/반복 문제 확인됨/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "확인하기" })).toHaveAttribute("href", "/reviews");
    expect(screen.queryByRole("button", { name: /전송|보내기|답변 보내기/ })).toBeNull();
  });

  it("names the knowledge gap so the seller can close it", async () => {
    getProactiveCases.mockResolvedValue({
      items: [
        view({
          evidenceState: "NO_LIBRARY",
          evidenceCount: 0,
          knowledgeGap: "이 상품에 등록된 지식이 없습니다. 상품 정보를 한 번 적어 두세요.",
        }),
      ],
      total: 1,
      high: 1,
    });

    renderSection();

    expect(await screen.findByText(/상품 정보를 한 번 적어 두세요/)).toBeInTheDocument();
    expect(screen.getByText(/상품 지식 없음/)).toBeInTheDocument();
  });


  it("does not repeat 상품 미지정 — the product line already said it", async () => {
    getProactiveCases.mockResolvedValue({
      items: [view({ evidenceState: "NO_PRODUCT", evidenceCount: 0, productName: null,
        knowledgeGap: "이 문의가 어떤 상품에 대한 것인지 연결해 두면, 다음 초안은 상품 지식을 근거로 씁니다." })],
      total: 1,
      high: 1,
    });

    renderSection();

    await screen.findByText("배송 언제 되나요");
    // Once, as the product line. An evidence label repeating it made the card stutter, and a line a
    // seller reads twice in a row is a line they stop reading.
    expect(screen.getAllByText("상품 미지정")).toHaveLength(1);
    expect(screen.getByText(/다음 초안은 상품 지식을 근거로 씁니다/)).toBeInTheDocument();
  });

  it("says how much it is showing when it is showing less than it has", async () => {
    getProactiveCases.mockResolvedValue({
      items: [view(), view({ id: "case-3", subjectId: "inq-3" })],
      total: 9,
      high: 4,
    });

    renderSection();

    expect(await screen.findByText(/전체 9건 중 2건/)).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("proactive_cases_viewed", undefined);
  });
});
