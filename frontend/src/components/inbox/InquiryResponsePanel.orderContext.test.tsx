// @vitest-environment jsdom
/**
 * 운영 정보 — the operational context card, and the four things it refuses to say.
 *
 * Every assertion here is a refusal. The card is small and its risk is not that it shows too little:
 * it is that a seller reads "결제 완료" and answers "곧 발송됩니다", or reads an empty card and
 * concludes the order has no state. So the tests are about what is absent.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InquiryResponsePanel } from "./InquiryResponsePanel";

const getInquiryDetailStrict = vi.fn();
const getInquiryPublishCapability = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInquiryDetailStrict: (id: string) => getInquiryDetailStrict(id),
    getInquiryPublishCapability: () => getInquiryPublishCapability(),
    saveInquiryReplyDraft: vi.fn(),
    confirmInquiryPublish: vi.fn(),
    verifyInquiryPublish: vi.fn(),
    resumeInquiryPublish: vi.fn(),
    generateInquiryProposal: vi.fn(),
    generateInquiryDraft: vi.fn(),
  },
  getToken: () => null,
}));

function detail(orderContext: unknown) {
  return {
    workItemId: "w1",
    inquiryId: "i1",
    sellerAccountId: "s1",
    channelId: "c1",
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    isSecret: false,
    phase: "OPEN",
    status: "UNANSWERED",
    informStatus: null,
    title: "주문 취소됐나요?",
    details: "어제 취소 요청드렸습니다.",
    receivedAt: "2026-08-22T00:00:00Z",
    proposal: null,
    draft: null,
    productId: null,
    productName: null,
    productBinding: null,
    sourceSubtype: "NAVER_CUSTOMER_INQUIRY",
    answerStateProven: true,
    answerStateNote: null,
    draftEvidence: [],
    replyCapability: null,
    orderContext,
  };
}

describe("운영 정보 card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInquiryPublishCapability.mockResolvedValue({ enabled: false, channels: [] });
  });

  it("renders nothing at all when the inquiry names no order", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({
        present: false,
        state: "NO_ORDER_REFERENCE",
        summaryKo: null,
        paymentKo: null,
        fulfillmentKo: null,
        cancellationKo: null,
        observedKo: null,
      }),
    );

    render(<InquiryResponsePanel workItemId="w1" />);
    await screen.findByText("주문 취소됐나요?");

    // An empty card would read as "we looked the order up and it has no state".
    expect(screen.queryByText("운영 정보")).toBeNull();
  });

  it("renders nothing when the backend sent no context at all", async () => {
    getInquiryDetailStrict.mockResolvedValue(detail(null));

    render(<InquiryResponsePanel workItemId="w1" />);
    await screen.findByText("주문 취소됐나요?");

    expect(screen.queryByText("운영 정보")).toBeNull();
  });

  it("shows payment separately from delivery, so one is never read off the other", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({
        present: true,
        state: "OBSERVED_FRESH",
        summaryKo: "이 주문은 결제가 완료된 것으로 확인됩니다. 발송 여부는 확인되지 않았습니다.",
        paymentKo: "결제 완료",
        fulfillmentKo: "확인되지 않음",
        cancellationKo: "확인되지 않음",
        observedKo: "방금 확인한 상태입니다.",
      }),
    );

    render(<InquiryResponsePanel workItemId="w1" />);
    await screen.findByText("운영 정보");

    expect(screen.getByText("결제 완료")).toBeTruthy();
    expect(screen.getAllByText("확인되지 않음")).toHaveLength(2);
    expect(screen.queryByText(/취소되지 않/)).toBeNull();
  });

  it("says when the state was last seen instead of implying it is current", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({
        present: true,
        state: "OBSERVED_FRESHNESS_UNPROVEN",
        summaryKo: "이 주문은 결제가 완료된 것으로 확인됩니다. 발송 여부는 확인되지 않았습니다.",
        paymentKo: "결제 완료",
        fulfillmentKo: "확인되지 않음",
        cancellationKo: "확인되지 않음",
        observedKo: "마지막 확인 8월 21일 기준입니다.",
      }),
    );

    render(<InquiryResponsePanel workItemId="w1" />);
    await screen.findByText("운영 정보");

    expect(screen.getByText("마지막 확인 8월 21일 기준입니다.")).toBeTruthy();
  });

  it("never shows a developer enum", async () => {
    getInquiryDetailStrict.mockResolvedValue(
      detail({
        present: true,
        state: "SOURCE_UNAVAILABLE",
        summaryKo: "이 채널의 주문 정보를 지금 확인할 수 없어, 주문 상태를 근거로 쓰지 못했습니다.",
        paymentKo: "확인되지 않음",
        fulfillmentKo: "확인되지 않음",
        cancellationKo: "확인되지 않음",
        observedKo: "현재 상태를 다시 확인할 수 없습니다.",
      }),
    );

    render(<InquiryResponsePanel workItemId="w1" />);
    await waitFor(() => expect(screen.getByText("운영 정보")).toBeTruthy());

    expect(document.body.textContent).not.toContain("SOURCE_UNAVAILABLE");
    expect(document.body.textContent).not.toContain("OBSERVED_");
  });
});
