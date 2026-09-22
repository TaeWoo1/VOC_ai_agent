// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerOperationsDecisionRow } from "../../lib/customerOperationsTypes";
import { expectNoAxeViolations } from "../../test/axe";

const api = vi.hoisted(() => ({
  getCustomerOperationsDecisions: vi.fn(),
  getCustomerOperationsHome: vi.fn(),
  getOperationsHomeStrict: vi.fn(),
  getInquiryQueueStrict: vi.fn(),
}));
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

/**
 * The three reads the Home makes, empty by default.
 *
 * <p>This screen used to read cases alone while the Home's 「확인 필요」 merged cases, flagged reviews and the inquiry
 * queue — measured on the demo org, the Home said 27건 and this screen said 1건 under the same name. It now draws the
 * same list with the same composer, so the fixtures have to supply the same three reads.
 */
function reads(over: { co?: unknown; ops?: unknown; queue?: unknown } = {}) {
  api.getCustomerOperationsHome.mockResolvedValue(
    over.co ?? { available: true, eligible: true, status: "ACTIVE", cadenceMinutes: 120, lastCheckedAt: null,
      lastRunStatus: null, nextCheckAt: null, sources: [], decisions: { total: 0, rows: [] },
      handled: { since: null, autoResolved: 0, monitoring: 0, draftsPrepared: 0, verifying: 0, rows: [], checked: 0 },
      gaps: { total: 0, rows: [] } },
  );
  api.getOperationsHomeStrict.mockResolvedValue(
    over.ops ?? { reviews: { needsAttentionUndecided: 0, needsAttentionTotal: 0, watchTotal: 0, rows: [] },
      problems: { decidable: 0, observing: 0, dormant: 0, rows: [] },
      prepared: { reviewRepliesApproved: 0, inquiryDraftsReady: 0, improvementDraftsReady: 0, rows: [] },
      collection: [] },
  );
  api.getInquiryQueueStrict.mockResolvedValue(over.queue ?? { content: [], totalElements: 0 });
}

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
    reads();
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

  it("케이스 행은 케이스 화면을 연다 — 종류별로 갈라지지 않는다", async () => {
    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 2, rows: [row(), REVIEW] });
    draw();

    await screen.findByRole("list", { name: "확인 필요" });
    const links = screen.getAllByRole("link");
    // A case opens its case screen whatever its subject is — the investigation is what the seller came for, and
    // splitting cases by subject kind would be two queues wearing one name.
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/customer-operations/cases/c-2",
      "/customer-operations/cases/c-1",
    ]);
  });

  /**
   * <b>The defect this screen was fixed for.</b> The Home's list is cases + flagged reviews + the inquiry queue,
   * deduplicated by owning screen; this screen read cases alone and called itself the same thing. On the demo org
   * that was 27건 against 1건, with 확인할 일 — the sidebar entry a seller reaches for first — pointing at the 1.
   */
  it("홈과 같은 목록을 그린다 — 케이스만이 아니라 리뷰와 문의도 선다", async () => {
    reads({
      ops: {
        reviews: {
          needsAttentionUndecided: 1, needsAttentionTotal: 1, watchTotal: 0,
          rows: [{ reviewId: "r-9", accountId: "a-1", channelCode: "NAVER", rating: 1,
                   occurredOn: "2026-09-19", productName: "전선몰딩", quote: "접착이 약해요" }],
        },
        problems: { decidable: 0, observing: 0, dormant: 0, rows: [] },
        prepared: { reviewRepliesApproved: 0, inquiryDraftsReady: 0, improvementDraftsReady: 0, rows: [] },
        collection: [],
      },
      queue: {
        totalElements: 1,
        content: [{ inquiryId: "i-9", workItemId: "w-9", channelCode: "CAFE24", channelNameKo: "카페24",
                    title: "배송 언제 되나요?", snippet: null, hasDraft: false, phase: "OPEN",
                    receivedAt: "2026-09-18T04:00:00Z" }],
      },
    });
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 1, rows: [row()] });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    expect(list).toHaveTextContent("접착이 약해요");
    expect(list).toHaveTextContent("배송 언제 되나요?");
    expect(list).toHaveTextContent("교환 신청은 언제까지 가능한가요?");
    // Each row opens the screen that owns it — the same identity the Home dedupes by.
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/reviews/reply/r-9");
    expect(hrefs).toContain("/inquiries/i-9");
    expect(hrefs).toContain("/customer-operations/cases/c-1");
  });

  it("준비된 초안은 아직 보내지 않았다고 말한다", async () => {
    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 1, rows: [row()] });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    expect(list).toHaveTextContent("초안 있음");
    expect(list).toHaveTextContent("미발송");
  });

  it("읽지 못한 목록과 빈 목록은 다른 문장이다", async () => {
    reads();
    api.getCustomerOperationsHome.mockRejectedValue(new Error("boom"));
    api.getOperationsHomeStrict.mockRejectedValue(new Error("boom"));
    api.getInquiryQueueStrict.mockRejectedValue(new Error("boom"));
    api.getCustomerOperationsDecisions.mockRejectedValue(new Error("boom"));
    const failed = draw();
    expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText(/확인이 필요한 문의나 리뷰가 없습니다/)).toBeNull();
    failed.unmount();

    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 0, rows: [] });
    draw();
    expect(await screen.findByText(/확인이 필요한 문의나 리뷰가 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("한 번에 읽는 깊이보다 많으면 그렇게 말하고, 다른 화면으로 보내지 않는다", async () => {
    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 80, rows: [row(), REVIEW] });
    draw();

    await screen.findByRole("list", { name: "확인 필요" });
    // It says the depth it reached, not a total: the reads that overflow count different populations, and their
    // sum is a number nobody measured.
    const note = screen.getByText(/2건까지 보여 드립니다/);
    expect(note).toHaveTextContent("처리하시면 다음 건이 올라옵니다");
    expect(note.textContent).not.toMatch(/문의 화면|리뷰 화면/);
  });

  it("리뷰 행도 무엇을 하면 되는지 말한다 — 「판단 보류」로 비워 두지 않는다", async () => {
    // The review lane prepares this sentence with no model call, from the issue memory another pipeline already
    // wrote. Before it reached the row, a review stood here carrying only 「확인이 필요한 리뷰입니다」 beside an
    // inquiry that said what was ready to send — and was tagged 「판단 보류」, which described the row as emptier
    // than it was.
    reads();
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

  /**
   * `REPLY_TO_CUSTOMER` is the one recommendation in this vocabulary that Reviewnary DID take on itself — it names
   * an action on the customer, not a judgement the seller must first make, and `DECISION` has always read it as
   * 「답변 확인 후 발송」. Tagging the same field 「판단 보류」 in the list made one DTO field say two opposite things:
   * measured, the demo org's one case carried a prepared draft and 「등록된 지식으로 답변할 수 있는 문의입니다」
   * under a 「판단 보류」 tag. 「답변 필요」 is the tag the raw inquiry rows already wear for the same work.
   */
  it("답변이 준비된 문의 케이스는 「답변 필요」다 — 「판단 보류」가 아니다", async () => {
    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 1, rows: [row()] });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    expect(list).toHaveTextContent("답변 필요");
    expect(list).not.toHaveTextContent("판단 보류");
    // The recommendation and the tag are the same fact, so the row still says what is ready.
    expect(list).toHaveTextContent("초안 있음");
  });

  it("준비된 것이 없는 리뷰는 없는 추천을 지어내지 않는다", async () => {
    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 1, rows: [REVIEW] });
    draw();

    const list = await screen.findByRole("list", { name: "확인 필요" });
    // Falls back to the rule's own line. A product with no issue memory yields no repeat claim rather than a
    // hedged one, and the row says only what is true.
    expect(list).toHaveTextContent("확인이 필요한 리뷰입니다");
  });

  it("이 화면에는 결정하는 컨트롤이 없다", async () => {
    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 2, rows: [row(), REVIEW] });
    draw();

    await screen.findByRole("list", { name: "확인 필요" });
    // Every row is a link to the screen that owns the decision; nothing here resolves, dismisses or sends.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("접근성 위반 0", async () => {
    reads();
    api.getCustomerOperationsDecisions.mockResolvedValue({ total: 2, rows: [row(), REVIEW] });
    const { container } = draw();
    await screen.findByRole("list", { name: "확인 필요" });
    await expectNoAxeViolations(container);
  });
});
