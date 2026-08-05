// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CustomerInbox } from "./CustomerInbox";
import { expectNoAxeViolations } from "../../test/axe";
import type { FeedItem } from "../../lib/types";

const getInboxStrict = vi.fn();
const getItemAnalysisStrict = vi.fn();
const getInquiryQueueStrict = vi.fn();
const getInquiryDetailStrict = vi.fn();
const generateInquiryProposal = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInboxStrict: () => getInboxStrict(),
    getItemAnalysisStrict: () => getItemAnalysisStrict(),
    getInquiryQueueStrict: (params: unknown) => getInquiryQueueStrict(params),
    getInquiryDetailStrict: (id: string) => getInquiryDetailStrict(id),
    generateInquiryProposal: (id: string) => generateInquiryProposal(id),
  },
  getToken: () => null,
}));

function feedItem(over: Partial<FeedItem> & Pick<FeedItem, "id" | "type">): FeedItem {
  return {
    channelNameKo: "채널 가",
    productName: "상품",
    snippet: "내용",
    rating: null,
    status: "NORMAL",
    receivedAt: "2026-08-03T10:00:00Z",
    ...over,
  } as FeedItem;
}

const ITEMS = [
  feedItem({ id: "i1", type: "INQUIRY", status: "UNANSWERED", productName: "케이블 몰딩" }),
  feedItem({
    id: "r1",
    type: "REVIEW",
    status: "NEGATIVE",
    rating: 1,
    productName: "바닥 몰딩",
    snippet: "접착력이 약합니다",
    channelNameKo: "채널 나",
  }),
];

function renderInbox(path = "/inbox") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inbox" element={<CustomerInbox />} />
        <Route path="/inbox/:itemRef" element={<CustomerInbox />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getInboxStrict.mockResolvedValue({ items: ITEMS, total: ITEMS.length });
  getItemAnalysisStrict.mockResolvedValue([]);
  getInquiryQueueStrict.mockResolvedValue({ content: [] });
  getInquiryDetailStrict.mockResolvedValue({
    workItemId: "w1",
    inquiryId: "i1",
    sellerAccountId: "s1",
    channelId: "c1",
    phase: "OPEN",
    status: "UNANSWERED",
    informStatus: null,
    title: "폭이 몇 mm인가요",
    details: "굵은 전선도 들어가나요?",
    receivedAt: "2026-08-03T10:00:00Z",
    proposal: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("고객 인박스 — three panes", () => {
  it("renders the filter rail, the list and the detail pane", async () => {
    renderInbox();
    expect(await screen.findByLabelText("인박스 필터")).toBeInTheDocument();
    expect(screen.getByLabelText("고객 문의·리뷰 목록")).toBeInTheDocument();
    expect(screen.getByText(/왼쪽 목록에서 항목을 고르면/)).toBeInTheDocument();
  });

  it("orders the list worst-first", async () => {
    renderInbox();
    const list = await screen.findByLabelText("고객 문의·리뷰 목록");
    const links = within(list).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/inbox/i1");
  });

  it("builds the channel filter from the loaded rows only", async () => {
    renderInbox();
    const rail = await screen.findByLabelText("인박스 필터");
    expect(within(rail).getByRole("button", { name: /채널 가/ })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /채널 나/ })).toBeInTheDocument();
  });

  it("narrows the list when a state filter is chosen", async () => {
    const user = userEvent.setup();
    renderInbox();
    const rail = await screen.findByLabelText("인박스 필터");
    await user.click(within(rail).getByRole("button", { name: "답변 필요" }));
    const list = screen.getByLabelText("고객 문의·리뷰 목록");
    expect(within(list).getAllByRole("link")).toHaveLength(1);
  });
});

describe("고객 인박스 — deep link", () => {
  it("opens the requested row", async () => {
    renderInbox("/inbox/r1");
    const detail = await screen.findByLabelText("선택한 항목");
    expect(within(detail).getByRole("heading", { level: 2 })).toHaveTextContent("바닥 몰딩");
    expect(within(detail).getByText("접착력이 약합니다")).toBeInTheDocument();
  });

  it("labels a review's text as an excerpt, never as the full original", async () => {
    renderInbox("/inbox/r1");
    const detail = await screen.findByLabelText("선택한 항목");
    // The feed carries a snippet and nothing more; calling it 원문 would tell the seller they had
    // read the whole review.
    expect(within(detail).getByText("리뷰 발췌")).toBeInTheDocument();
    expect(within(detail).queryByText("리뷰 원문")).toBeNull();
  });

  it("says so honestly when the requested row is not loaded", async () => {
    renderInbox("/inbox/does-not-exist");
    expect(await screen.findByText("항목을 찾을 수 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/목록에서 다시 선택해 주세요/)).toBeInTheDocument();
  });

  it("resolves a row the active filters would have hidden", async () => {
    // Deep links are shared; a filter the recipient happens to have set must not blank the page.
    renderInbox("/inbox/r1");
    expect(await screen.findByLabelText("선택한 항목")).toBeInTheDocument();
  });
});

describe("고객 인박스 — response workflow", () => {
  it("shows no response panel when no work item resolves", async () => {
    renderInbox("/inbox/i1");
    await screen.findByLabelText("선택한 항목");
    expect(screen.queryByText("응답 제안")).toBeNull();
    expect(screen.getByText(/응답 작업으로 연결되어 있지 않아/)).toBeInTheDocument();
  });

  it("shows the inquiry body and the response suggestion once a work item resolves", async () => {
    getInquiryQueueStrict.mockResolvedValue({
      content: [{ workItemId: "w1", inquiryId: "i1", phase: "OPEN" }],
    });
    renderInbox("/inbox/i1");
    expect(await screen.findByText("문의 내용")).toBeInTheDocument();
    expect(screen.getByText("굵은 전선도 들어가나요?")).toBeInTheDocument();
    expect(screen.getByText("응답 제안")).toBeInTheDocument();
  });

  it("never offers to send, and never implies SellerOps will", async () => {
    getInquiryQueueStrict.mockResolvedValue({
      content: [{ workItemId: "w1", inquiryId: "i1", phase: "OPEN" }],
    });
    renderInbox("/inbox/i1");
    await screen.findByText("응답 제안");
    const text = document.body.textContent ?? "";
    for (const banned of ["자동 발송", "대신 답변", "즉시 전송", "바로 보내기", "발송하기"]) {
      expect(text).not.toContain(banned);
    }
    for (const name of [/발송/, /전송/, /보내기/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    // It states plainly who does the sending.
    expect(screen.getByText(/판매자가 채널에서 직접 합니다/)).toBeInTheDocument();
  });

  it("describes the suggestion as a response type, not as an AI-written draft", async () => {
    getInquiryQueueStrict.mockResolvedValue({
      content: [{ workItemId: "w1", inquiryId: "i1", phase: "OPEN" }],
    });
    renderInbox("/inbox/i1");
    await screen.findByText("응답 제안");
    const text = document.body.textContent ?? "";
    // The generator returns a response CATEGORY and its provenance — no reply body, and its
    // provider kind is rule-based. "AI 답변 초안" would name something that is not produced.
    expect(text).not.toContain("AI 초안");
    expect(text).not.toContain("AI 답변");
    expect(screen.getByText(/답변 문구는 판매자가 직접 작성/)).toBeInTheDocument();
  });
});

describe("고객 인박스 — empty and failed states", () => {
  it("invites a connection when nothing has arrived", async () => {
    getInboxStrict.mockResolvedValue({ items: [], total: 0 });
    renderInbox();
    expect(await screen.findByText("아직 들어온 문의와 리뷰가 없습니다")).toBeInTheDocument();
  });

  it("says the read failed rather than showing an empty queue", async () => {
    getInboxStrict.mockRejectedValue(new Error("down"));
    renderInbox();
    expect(await screen.findByText("목록을 불러오지 못했습니다")).toBeInTheDocument();
  });
});

describe("고객 인박스 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderInbox("/inbox/r1");
    await screen.findByLabelText("선택한 항목");
    await expectNoAxeViolations(container);
  });
});
