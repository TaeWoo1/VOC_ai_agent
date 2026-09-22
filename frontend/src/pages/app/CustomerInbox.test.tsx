// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CustomerInbox } from "./CustomerInbox";
import { expectNoAxeViolations } from "../../test/axe";
import type { InquiryQueueItem, InquiryRowItem } from "../../lib/types";

/**
 * 문의 — 지금 처리할 일, then 전체 문의 (Inquiry Operations Workspace v1).
 *
 * <b>CONTRACT CHANGED, and this file was rewritten for it.</b> The screen used to make ONE read — the
 * inbox feed at `limit=500` — and render every row it got in a single column, filtering and ordering
 * on the client. On the demo org that was 94 rows and 7,100px with no way to search; a seller with
 * three thousand inquiries would have been handed three thousand rows. The old assertions were about
 * that shape: a client-side 인박스 필터 rail, a single 문의 목록, and a mixed 문의+리뷰 mode no route
 * had passed since product assembly A2.
 *
 * Everything those tests protected that is still true is asserted below — the list is the screen
 * until a row is chosen, a deep link opens its row, the response workflow appears only when a work
 * item resolves, nothing offers a send on the default posture, empty and failed states are told
 * apart. What is new is the split itself, and the two properties it rests on: the queue's membership
 * comes from the WORK QUEUE read, and the record's filters are the server's.
 */

const getItemAnalysisStrict = vi.fn();
const getInquiryQueueStrict = vi.fn();
const getInquiryRowsStrict = vi.fn();
const getInquiryDetailStrict = vi.fn();
const generateInquiryProposal = vi.fn();
const getInquiryPublishCapability = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getItemAnalysisStrict: () => getItemAnalysisStrict(),
    getInquiryQueueStrict: (params: unknown) => getInquiryQueueStrict(params),
    getInquiryRowsStrict: (params: unknown) => getInquiryRowsStrict(params),
    getInquiryDetailStrict: (id: string) => getInquiryDetailStrict(id),
    generateInquiryProposal: (id: string) => generateInquiryProposal(id),
    getInquiryPublishCapability: () => getInquiryPublishCapability(),
  },
  getToken: () => null,
}));

function row(over: Partial<InquiryRowItem> & Pick<InquiryRowItem, "inquiryId">): InquiryRowItem {
  return {
    workItemId: null,
    sellerAccountId: "s1",
    channelId: "c1",
    channelCode: "CAFE24",
    channelNameKo: "카페24 자사몰",
    productId: null,
    productName: null,
    phase: null,
    status: "ANSWERED",
    title: "제목",
    snippet: "고객이 쓴 문장",
    receivedAt: "2026-08-03T10:00:00Z",
    answeredAt: null,
    sourceSubtype: null,
    executableIdentity: "NONE",
    ...over,
  };
}

function queued(over: Partial<InquiryQueueItem> & Pick<InquiryQueueItem, "workItemId" | "inquiryId">): InquiryQueueItem {
  return {
    sellerAccountId: "s1",
    channelId: "c1",
    channelCode: "CAFE24",
    channelNameKo: "카페24 자사몰",
    productId: null,
    productName: null,
    phase: "OPEN",
    status: "UNANSWERED",
    title: "제목",
    snippet: "답을 기다리는 문장",
    receivedAt: "2026-08-01T10:00:00Z",
    hasDraft: false,
    ...over,
  };
}

/**
 * ONE read for the whole of `AWAITING_SELLER` — the endpoint's own default (Secondary Workspaces UX
 * Closure v1 §1). The fixture used to answer per phase because this screen asked twice and joined the
 * pages itself, which is what let 홈 and 문의 print different numbers under the same noun. A caller that
 * names a phase here is now the exception, so the fixture refuses one: an unexpected `phase` would mean
 * the screen went back to deciding membership on its own.
 */
function queueOf(rows: InquiryQueueItem[]) {
  return (params: { phase?: string } = {}) => {
    if (params.phase) throw new Error(`the queue is read as one set, not per phase (got ${params.phase})`);
    return Promise.resolve({ content: rows, totalElements: rows.length });
  };
}

function renderInbox(path = "/inquiries") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inquiries" element={<CustomerInbox />} />
        <Route path="/inquiries/:itemRef" element={<CustomerInbox />} />
      </Routes>
    </MemoryRouter>,
  );
}

const RECORD = [
  row({ inquiryId: "i1", status: "UNANSWERED", productName: "케이블 몰딩", snippet: "폭이 몇 mm인가요" }),
  row({ inquiryId: "i2", snippet: "잘 받았습니다", channelCode: "NAVER", channelNameKo: "네이버 스마트스토어" }),
];

beforeEach(() => {
  getItemAnalysisStrict.mockResolvedValue([]);
  getInquiryQueueStrict.mockResolvedValue({ content: [], totalElements: 0 });
  getInquiryRowsStrict.mockResolvedValue({ items: RECORD, totalCount: RECORD.length, limit: 50, productId: null });
  getInquiryDetailStrict.mockResolvedValue({
    workItemId: "w1",
    inquiryId: "i1",
    sellerAccountId: "s1",
    channelId: "c1",
    channelCode: "CAFE24",
    channelNameKo: "카페24",
    isSecret: false,
    phase: "OPEN",
    status: "UNANSWERED",
    informStatus: null,
    title: "폭이 몇 mm인가요",
    details: "굵은 전선도 들어가나요?",
    receivedAt: "2026-08-03T10:00:00Z",
    proposal: null,
    draft: null,
  });
  // The DEFAULT deployment posture: the send path is off and no channel has a reply adapter. Every
  // assertion below about "never offers to send" is therefore about the real default.
  getInquiryPublishCapability.mockResolvedValue({ executionEnabled: false, replyAdapterChannelCodes: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("지금 처리할 일 — the work queue, from the queue read", () => {
  it("is the WORK QUEUE, not a slice of the record: it renders what the queue read returned", async () => {
    getInquiryQueueStrict.mockImplementation(queueOf([queued({ workItemId: "w1", inquiryId: "i1" })]));
    renderInbox();

    const queue = await screen.findByLabelText("지금 처리할 일");
    expect(within(queue).getAllByRole("link")).toHaveLength(1);
    expect(within(queue).getByRole("link")).toHaveAttribute("href", "/inquiries/i1");
    // Membership is not decided on screen: the read names no phase, so the server answers with the
    // set it declared (`InquiryWorkItemPhase.AWAITING_SELLER`).
    expect(getInquiryQueueStrict).toHaveBeenCalledTimes(1);
    expect(getInquiryQueueStrict.mock.calls[0][0]).not.toHaveProperty("phase");
  });

  it("초안 준비됨 needs a draft — a queued row without one is 답변 필요", async () => {
    getInquiryQueueStrict.mockImplementation(
      queueOf([
        queued({ workItemId: "w1", inquiryId: "i1", phase: "PROPOSED", hasDraft: false }),
        queued({ workItemId: "w2", inquiryId: "i2", phase: "PROPOSED", hasDraft: true, receivedAt: "2026-08-02T10:00:00Z" }),
      ]),
    );
    renderInbox();

    const queue = await screen.findByLabelText("지금 처리할 일");
    const items = within(queue).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("답변 필요");
    expect(items[1]).toContain("초안 준비됨");
  });

  it("longest-waiting first WITHIN recent work — but a decade-old row does not bury this week's", async () => {
    getInquiryQueueStrict.mockImplementation(
      queueOf([
        queued({ workItemId: "w-newest", inquiryId: "newest", receivedAt: new Date(Date.now() - 3_600_000).toISOString() }),
        queued({ workItemId: "w-ancient", inquiryId: "ancient", receivedAt: "2014-01-04T10:00:00Z" }),
        queued({ workItemId: "w-week", inquiryId: "week", receivedAt: new Date(Date.now() - 7 * 86_400_000).toISOString() }),
      ]),
    );
    renderInbox();

    const queue = await screen.findByLabelText("지금 처리할 일");
    const hrefs = within(queue).getAllByRole("link").map((a) => a.getAttribute("href"));
    // Recent work, longest-waiting first; then the year-plus backlog under its own divider.
    expect(hrefs).toEqual(["/inquiries/week", "/inquiries/newest", "/inquiries/ancient"]);
    // The divider says what the group is and is not itself a heading or a control.
    const divider = within(queue).getByText(/1년 넘게 지난 문의 1건/);
    expect(divider).toHaveAttribute("aria-hidden", "true");
    expect(divider.closest("a")).toBeNull();
  });

  it("renders no section at all when nothing is waiting — never 「0건」", async () => {
    renderInbox();
    await screen.findByLabelText("전체 문의");
    expect(screen.queryByLabelText("지금 처리할 일")).toBeNull();
  });

  it("a queue read that FAILED says so — an unread queue is not an empty one", async () => {
    getInquiryQueueStrict.mockRejectedValue(new Error("down"));
    renderInbox();
    expect(await screen.findByText(/지금 처리할 일을 불러오지 못했습니다/)).toBeInTheDocument();
    // The record is a separate read and is unaffected.
    expect(screen.getByLabelText("전체 문의")).toBeInTheDocument();
  });
});

describe("전체 문의 — the record, filtered by the server", () => {
  // CONTRACT CHANGE (Product Operations Continuity v1 §6). This used to assert the sentence
  // 「최근 2건을 보여 드립니다. 나머지는 위에서 찾아 주세요」 — true, and a dead end: the read was capped
  // at 50 rows and always asked for page 0, so search was the only way out of a record whose own total
  // said there were 3,120. What is asserted now is what was asserted then plus the way through: the
  // page is bounded, the whole set's count is shown, a record that holds everything says nothing, and
  // 더 보기 asks the server for the next page rather than telling the seller to search.
  it("is one bounded page with the whole set's count, and offers the way to the rest", async () => {
    getInquiryRowsStrict.mockResolvedValue({ items: RECORD, totalCount: 3120, limit: 50, productId: null });
    renderInbox();
    await screen.findByLabelText("전체 문의");
    expect(screen.getByText(/2 \/ 3120건/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "더 보기" })).toBeInTheDocument();
    expect(getInquiryRowsStrict).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, page: 0 }));
  });

  it("더 보기 asks for the next page of the same question", async () => {
    getInquiryRowsStrict.mockResolvedValue({ items: RECORD, totalCount: 3120, limit: 50, productId: null });
    renderInbox();
    await screen.findByLabelText("전체 문의");
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    await waitFor(() =>
      expect(getInquiryRowsStrict).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, page: 1 })),
    );
  });

  it("a page that holds everything offers no way to more", async () => {
    renderInbox();
    await screen.findByLabelText("전체 문의");
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
  });

  it("the search box narrows the SERVER read, not the loaded rows", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByLabelText("전체 문의");
    await user.type(screen.getByLabelText("문의 내용 검색"), "세금계산서{Enter}");
    expect(getInquiryRowsStrict).toHaveBeenLastCalledWith(expect.objectContaining({ q: "세금계산서" }));
  });

  it("답변 상태 and 채널 are the server's too", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByLabelText("전체 문의");
    await user.selectOptions(screen.getByLabelText("답변 상태"), "UNANSWERED");
    expect(getInquiryRowsStrict).toHaveBeenLastCalledWith(expect.objectContaining({ status: "UNANSWERED" }));
    await user.selectOptions(screen.getByLabelText("채널"), "NAVER");
    expect(getInquiryRowsStrict).toHaveBeenLastCalledWith(expect.objectContaining({ channel: "NAVER" }));
  });

  it("an answered row is quieter than the work above it, and still readable", async () => {
    renderInbox();
    const record = await screen.findByLabelText("전체 문의");
    expect(within(record).getByText("잘 받았습니다")).toBeInTheDocument();
  });

  it("tells 「찾는 게 없다」 and 「아무것도 없다」 apart", async () => {
    getInquiryRowsStrict.mockResolvedValue({ items: [], totalCount: 0, limit: 50, productId: null });
    const { unmount } = renderInbox();
    expect(await screen.findByText("아직 들어온 문의가 없습니다")).toBeInTheDocument();
    unmount();

    renderInbox("/inquiries?q=없는말");
    expect(await screen.findByText("찾는 문의가 없습니다")).toBeInTheDocument();
  });

  it("says the read failed rather than showing an empty record", async () => {
    getInquiryRowsStrict.mockRejectedValue(new Error("down"));
    renderInbox();
    expect(await screen.findByText("문의를 불러오지 못했습니다")).toBeInTheDocument();
  });
});

describe("상품 → 문의 doorway", () => {
  it("?productId narrows the SAME read the product's number was counted with, and says which product", async () => {
    getInquiryRowsStrict.mockResolvedValue({
      items: [row({ inquiryId: "i1", status: "UNANSWERED", productId: "p1", productName: "케이블 몰딩" })],
      totalCount: 1,
      limit: 50,
      productId: "p1",
    });
    renderInbox("/inquiries?productId=p1&status=UNANSWERED");
    await screen.findByLabelText("전체 문의");

    expect(getInquiryRowsStrict).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "p1", status: "UNANSWERED" }),
    );
    const scope = screen.getByTestId("record-product-scope");
    expect(scope).toHaveTextContent("케이블 몰딩");
  });

  it("the WORK is scoped too — a doorway must not land the seller above 21 other products' items", async () => {
    getInquiryQueueStrict.mockImplementation(
      queueOf([
        queued({ workItemId: "w-mine", inquiryId: "mine", productId: "p1", productName: "케이블 몰딩" }),
        queued({ workItemId: "w-other", inquiryId: "other", productId: "p2", productName: "다른 상품" }),
        queued({ workItemId: "w-none", inquiryId: "none" }),
      ]),
    );
    getInquiryRowsStrict.mockResolvedValue({
      items: [row({ inquiryId: "mine", status: "UNANSWERED", productId: "p1", productName: "케이블 몰딩" })],
      totalCount: 1,
      limit: 50,
      productId: "p1",
    });
    renderInbox("/inquiries?productId=p1");

    const queue = await screen.findByLabelText("이 상품의 지금 처리할 일");
    const hrefs = within(queue).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/inquiries/mine"]);
    // Scoped from rows already read — the queue is not asked a second time for the product.
    expect(getInquiryQueueStrict).toHaveBeenCalledTimes(1);
  });

  it("the scope can be cleared, and clearing it re-reads without the product", async () => {
    const user = userEvent.setup();
    getInquiryRowsStrict.mockResolvedValue({
      items: [row({ inquiryId: "i1", productId: "p1", productName: "케이블 몰딩" })],
      totalCount: 1,
      limit: 50,
      productId: "p1",
    });
    renderInbox("/inquiries?productId=p1");
    await screen.findByTestId("record-product-scope");
    await user.click(screen.getByRole("button", { name: "전체 문의 보기" }));
    expect(getInquiryRowsStrict).toHaveBeenLastCalledWith(expect.not.objectContaining({ productId: "p1" }));
  });
});

describe("deep link and the exact inquiry", () => {
  it("opens the requested row from the page it is already on", async () => {
    renderInbox("/inquiries/i1");
    const detail = await screen.findByLabelText("선택한 항목");
    // The rail beside it shows the same row, so this asserts the DETAIL holds it, not that it is unique.
    expect(within(detail).getAllByText("폭이 몇 mm인가요").length).toBeGreaterThan(0);
  });

  it("a link naming a row the page does not hold is fetched by id — one exact read", async () => {
    getInquiryRowsStrict.mockImplementation((params: { inquiryId?: string }) =>
      Promise.resolve(
        params?.inquiryId === "elsewhere"
          ? { items: [row({ inquiryId: "elsewhere", snippet: "다른 페이지의 문의" })], totalCount: 1, limit: 1, productId: null }
          : { items: RECORD, totalCount: RECORD.length, limit: 50, productId: null },
      ),
    );
    renderInbox("/inquiries/elsewhere");
    const detail = await screen.findByLabelText("선택한 항목");
    expect(within(detail).getAllByText("다른 페이지의 문의").length).toBeGreaterThan(0);
    expect(getInquiryRowsStrict).toHaveBeenCalledWith(expect.objectContaining({ inquiryId: "elsewhere" }));
  });

  it("says so honestly when the row cannot be found at all", async () => {
    getInquiryRowsStrict.mockImplementation((params: { inquiryId?: string }) =>
      Promise.resolve(
        params?.inquiryId
          ? { items: [], totalCount: 0, limit: 1, productId: null }
          : { items: RECORD, totalCount: RECORD.length, limit: 50, productId: null },
      ),
    );
    renderInbox("/inquiries/does-not-exist");
    expect(await screen.findByText("문의를 찾을 수 없습니다")).toBeInTheDocument();
  });
});

describe("response workflow", () => {
  it("shows no response panel when no work item resolves", async () => {
    renderInbox("/inquiries/i1");
    await screen.findByLabelText("선택한 항목");
    expect(screen.queryByText("응답 제안")).toBeNull();
    expect(screen.getByText(/답변 방향을 제안할 수 없습니다/)).toBeInTheDocument();
  });

  it("shows the customer's question and offers to draft an answer", async () => {
    getInquiryQueueStrict.mockImplementation(queueOf([queued({ workItemId: "w1", inquiryId: "i1" })]));
    renderInbox("/inquiries/i1");
    expect(await screen.findByText("고객 문의")).toBeInTheDocument();
    expect(screen.getByText("굵은 전선도 들어가나요?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /초안 만들기/ })).toBeInTheDocument();
  });

  it("offers no send on the default posture, and never implies one happens by itself", async () => {
    getInquiryQueueStrict.mockImplementation(queueOf([queued({ workItemId: "w1", inquiryId: "i1" })]));
    renderInbox("/inquiries/i1");
    await screen.findByText("고객 문의");
    const text = document.body.textContent ?? "";
    for (const banned of ["자동 발송", "대신 답변", "즉시 전송", "바로 보내기"]) {
      expect(text).not.toContain(banned);
    }
    expect(screen.queryByRole("button", { name: /답변 보내기/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /확인, 등록합니다/ })).toBeNull();
  });

  it("says what a draft is for before it is written — reviewed, then sent on purpose", async () => {
    getInquiryQueueStrict.mockImplementation(queueOf([queued({ workItemId: "w1", inquiryId: "i1" })]));
    renderInbox("/inquiries/i1");
    await screen.findByText("고객 문의");
    expect(screen.getByText(/보내는 것은 확인 후 따로 누릅니다/)).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations with a row open", async () => {
    getInquiryQueueStrict.mockImplementation(queueOf([queued({ workItemId: "w1", inquiryId: "i1" })]));
    const { container } = renderInbox("/inquiries/i1");
    await screen.findByLabelText("선택한 항목");
    await expectNoAxeViolations(container);
  });
});

describe("master-detail (UI/UX v2 Phase 2) — the list and the chosen inquiry, side by side", () => {
  it("on a wide screen opens the first row of 지금 처리할 일 beside the list, without a click", async () => {
    const restore = stubWide(true);
    try {
      getInquiryQueueStrict.mockImplementation(
        queueOf([
          queued({ workItemId: "w-newest", inquiryId: "newest", receivedAt: new Date(Date.now() - 3_600_000).toISOString() }),
          queued({ workItemId: "w1", inquiryId: "i1", receivedAt: new Date(Date.now() - 7 * 86_400_000).toISOString() }),
        ]),
      );
      renderInbox();
      // The row the list itself puts first — the one that has waited longest this year — is the one open.
      const pane = await screen.findByLabelText("선택한 문의");
      expect(pane).toBeInTheDocument();
      await waitFor(() => expect(getInquiryDetailStrict).toHaveBeenCalledWith("w1"));
      const queue = screen.getByLabelText("지금 처리할 일");
      expect(within(queue).getAllByRole("link")[0]).toHaveAttribute("aria-current", "true");
    } finally {
      restore();
    }
  });

  it("on a narrow screen the chosen inquiry takes the column, with the way back to the list", async () => {
    renderInbox("/inquiries/i1");
    expect(await screen.findByRole("link", { name: "← 문의 목록" })).toHaveAttribute("href", "/inquiries");
    expect(screen.queryByLabelText("전체 문의")).toBeNull();
  });
});

/** Stands the list and the detail side by side, as the layout does at 1200px and up. Returns the restore. */
function stubWide(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
