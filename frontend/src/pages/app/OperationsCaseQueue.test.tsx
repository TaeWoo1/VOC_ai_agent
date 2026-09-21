// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerOperationsDecisionRow } from "../../lib/customerOperationsTypes";
import { expectNoAxeViolations } from "../../test/axe";

const api = vi.hoisted(() => ({ getCustomerOperationsDecisions: vi.fn() }));
vi.mock("../../lib/apiClient", () => ({ api, getToken: () => null }));

import { OperationsCaseQueue } from "./OperationsCaseQueue";

const NOW = new Date("2026-09-22T05:30:00Z"); // 14:30 KST

function row(over: Partial<CustomerOperationsDecisionRow> = {}): CustomerOperationsDecisionRow {
  return {
    caseId: "c-1",
    subjectKind: "INQUIRY",
    channelNameKo: "카페24",
    title: "교환 신청은 언제까지 가능한가요?",
    rating: null,
    reasonNote: "고객이 답변을 기다리고 있습니다",
    summary: "등록된 지식으로 답변할 수 있는 문의입니다.",
    recommendedActionType: "REPLY_TO_CUSTOMER",
    recommendedAction: null,
    missingInformation: [],
    draftPrepared: true,
    decidedBy: "RULE",
    openedAt: "2026-09-21T04:00:00Z",
    to: "/inquiries/i-1",
    ...over,
  };
}

const REVIEW = row({
  caseId: "c-2",
  subjectKind: "REVIEW",
  channelNameKo: "네이버",
  title: "배송이 너무 늦었어요",
  rating: 2,
  reasonNote: "확인이 필요한 리뷰입니다",
  summary: null,
  recommendedActionType: null,
  draftPrepared: false,
  openedAt: "2026-09-20T04:00:00Z",
  to: "/reviews/reply/r-2",
});

function draw() {
  return render(
    <MemoryRouter>
      <OperationsCaseQueue now={NOW} />
    </MemoryRouter>,
  );
}

describe("OperationsCaseQueue", () => {
  beforeEach(() => vi.resetAllMocks());

  it("문의와 리뷰가 한 목록에 함께, 기다린 순서대로 선다", async () => {
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 2, rows: [row(), REVIEW] });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    const items = within(list).getAllByRole("listitem");
    // The review has waited a day longer, so it leads — the order is the wait, not the kind.
    expect(items[0]).toHaveTextContent("배송이 너무 늦었어요");
    expect(items[1]).toHaveTextContent("교환 신청은 언제까지 가능한가요?");
    expect(list).toHaveTextContent("카페24");
    expect(list).toHaveTextContent("네이버");
  });

  it("모든 행이 케이스 화면을 연다 — 종류별로 다른 화면으로 갈라지지 않는다", async () => {
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 2, rows: [row(), REVIEW] });
    draw();

    await screen.findByRole("list", { name: "확인 필요" });
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/customer-operations/cases/c-2",
      "/customer-operations/cases/c-1",
    ]);
  });

  it("준비된 초안은 아직 보내지 않았다고 말한다", async () => {
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 1, rows: [row()] });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    expect(list).toHaveTextContent("초안 있음");
    expect(list).toHaveTextContent("미발송");
  });

  it("읽지 못한 목록과 빈 목록은 다른 문장이다", async () => {
    api.getCustomerOperationsDecisions.mockRejectedValue(new Error("boom"));
    const failed = draw();
    expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText(/확인이 필요한 문의나 리뷰가 없습니다/)).toBeNull();
    failed.unmount();

    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 0, rows: [] });
    draw();
    expect(await screen.findByText(/확인이 필요한 문의나 리뷰가 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("한 번에 읽는 깊이보다 많으면 그렇게 말하고, 다른 화면으로 보내지 않는다", async () => {
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 80, rows: [row(), REVIEW] });
    draw();

    await screen.findByRole("list", { name: "확인 필요" });
    const note = screen.getByText(/80건이 있고/);
    expect(note).toHaveTextContent("처리하시면 다음 건이 올라옵니다");
    expect(note.textContent).not.toMatch(/문의|리뷰 화면/);
  });

  it("리뷰 행도 무엇을 하면 되는지 말한다 — 「판단 보류」로 비워 두지 않는다", async () => {
    // The review lane prepares this sentence with no model call, from the issue memory another pipeline already
    // wrote. Before it reached the row, a review stood here carrying only 「확인이 필요한 리뷰입니다」 beside an
    // inquiry that said what was ready to send — and was tagged 「판단 보류」, which described the row as emptier
    // than it was.
    api.getCustomerOperationsDecisions.mockResolvedValue({
      total: 1,
      rows: [
        {
          ...REVIEW,
          recommendedAction:
            "이 상품에서 「포장 파손」 문제가 3건 확인됐습니다. 개별 응대보다 상품 설명이나 운영 기준을 함께 손보는 편이 빠릅니다.",
        },
      ],
    });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    expect(list).toHaveTextContent(/「포장 파손」 문제가 3건 확인됐습니다/);
    expect(list).toHaveTextContent("리뷰");
    expect(list).not.toHaveTextContent("판단 보류");
  });

  it("준비된 것이 없는 리뷰는 없는 추천을 지어내지 않는다", async () => {
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 1, rows: [REVIEW] });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    // Falls back to the rule's own line. A product with no issue memory yields no repeat claim rather than a
    // hedged one, and the row says only what is true.
    expect(list).toHaveTextContent("확인이 필요한 리뷰입니다");
  });

  it("이 화면에는 결정하는 컨트롤이 없다", async () => {
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 2, rows: [row(), REVIEW] });
    draw();

    await screen.findByRole("list", { name: "확인 필요" });
    // Every row is a link to the screen that owns the decision; nothing here resolves, dismisses or sends.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("접근성 위반 0", async () => {
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 2, rows: [row(), REVIEW] });
    const { container } = draw();
    await screen.findByRole("list", { name: "확인 필요" });
    await expectNoAxeViolations(container);
  });
});
