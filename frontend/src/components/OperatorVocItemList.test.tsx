// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OperatorVocItemList } from "./OperatorVocItemList";
import { api } from "../lib/apiClient";
import type { OperatorVocItem, OperatorVocItemPage } from "../lib/types";

// The list's job around triage is narrow but load-bearing: pass the account down so a row
// can be addressed, and DO NOT let a decision disturb the counts.

/** A NAVER review row — the only shape a decidable page contains. */
function row(over: Partial<OperatorVocItem> = {}): OperatorVocItem {
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    sourceType: "REVIEW",
    productName: "가을 니트 가디건 CHARCOAL",
    rating: 2,
    // An export carries no reply state — the source sends null, not a token.
    replyStatus: null,
    sourceCreatedDate: "2026-05-10",
    collectedDate: "2026-05-30",
    signalType: "LOW_RATING_REVIEW",
    safePreview: "배송은 빨랐는데 색이 생각과 달라요",
    actionRef: "review:abc",
    triageDisposition: null,
    hasReplyPreparation: false,
    category: "배송",
    hasReportedSubmission: false,
    ...over,
  };
}

function page(
  items: OperatorVocItem[],
  total = items.length,
  over: Partial<OperatorVocItemPage> = {},
): OperatorVocItemPage {
  return {
    signalType: "LOW_RATING_REVIEW",
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
    page: 0,
    size: 10,
    total,
    unfilteredTotal: total,
    categoryCounts: [],
    unclassifiedCount: 0,
    items,
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OperatorVocItemList triage wiring", () => {
  it("addresses a decision to the account whose drill-down is open", async () => {
    vi.spyOn(api, "getAttentionItems").mockResolvedValue(page([row()]));
    const spy = vi
      .spyOn(api, "recordVocItemTriage")
      .mockResolvedValue({ actionRef: "review:abc", disposition: "MONITOR", replayed: false });

    render(
      <OperatorVocItemList accountId="acct-42" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />,
    );
    await screen.findByRole("group", { name: "처리 상태" });
    await userEvent.click(screen.getByRole("button", { name: "지켜보기" }));

    // The account is authorization, not decoration — the backend re-derives scope from it,
    // so the wrong one here is a 404 rather than someone else's row.
    await waitFor(() => expect(spy).toHaveBeenCalledWith("acct-42", "review:abc", expect.anything()));
  });

  it("does not change the total after a decision is recorded", async () => {
    const itemsSpy = vi.spyOn(api, "getAttentionItems").mockResolvedValue(page([row()], 6));
    vi.spyOn(api, "recordVocItemTriage").mockResolvedValue({
      actionRef: "review:abc",
      disposition: "NO_ACTION",
      replayed: false,
    });

    render(
      <OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />,
    );
    expect(await screen.findByText("총 6건")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "조치 불필요" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "조치 불필요" })).toHaveAttribute("aria-pressed", "true"),
    );

    // Triage is a record, not a filter: deciding NO_ACTION does not make a review stop
    // being low-rating, so the count must not move and the row must not vanish. The list
    // also must not silently refetch — a decision is not a reason to reload the window.
    expect(screen.getByText("총 6건")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(itemsSpy).toHaveBeenCalledTimes(1);
  });

  it("gives every row on a decidable page its own control", async () => {
    // One page is one account is one channel, so a page does not mix a decidable row with
    // an undecidable one — an earlier version of this test built a NAVER+Cafe24 page and
    // called it "real data", which is the account shape the mock fixtures now explicitly
    // reject. Whether a null ref renders no control is a per-ROW question, and it is
    // answered at the VocItemCard boundary over a real Cafe24 item.
    vi.spyOn(api, "getAttentionItems").mockResolvedValue(
      page([
        row({ actionRef: "review:one" }),
        row({ actionRef: "review:two" }),
        row({ actionRef: "review:three", triageDisposition: "MONITOR" }),
      ]),
    );

    render(
      <OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />,
    );
    await screen.findAllByRole("group", { name: "처리 상태" });

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByRole("group", { name: "처리 상태" })).toHaveLength(3);
  });

  it("keeps one row's decision off its neighbours", async () => {
    vi.spyOn(api, "getAttentionItems").mockResolvedValue(
      page([row({ actionRef: "review:one" }), row({ actionRef: "review:two" })]),
    );
    const spy = vi
      .spyOn(api, "recordVocItemTriage")
      .mockResolvedValue({ actionRef: "review:one", disposition: "RESPONSE_NEEDED", replayed: false });

    render(
      <OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />,
    );
    await screen.findAllByRole("group", { name: "처리 상태" });
    await userEvent.click(screen.getAllByRole("button", { name: "대응 필요" })[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // Exactly one row moved; each control owns its own state.
    const checkedRows = screen
      .getAllByRole("button", { name: "대응 필요" })
      .filter((r) => r.getAttribute("aria-pressed") === "true");
    expect(checkedRows).toHaveLength(1);
    expect(spy.mock.calls[0][1]).toBe("review:one");
  });
});

describe("OperatorVocItemList classification facet", () => {
  const faceted = (over = {}) =>
    page([row()], 6, {
      unfilteredTotal: 6,
      categoryCounts: [
        { category: "배송", count: 3 },
        { category: "품질", count: 2 },
      ],
      unclassifiedCount: 1,
      ...over,
    });

  it("builds the facet from the SERVER's window counts, not from the rendered page", async () => {
    // The list is server-paginated at 10. Deriving options from `items` would describe one
    // page and present it as the window — here, one row standing in for six.
    vi.spyOn(api, "getAttentionItems").mockResolvedValue(faceted());

    render(<OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />);

    const group = await screen.findByRole("group", { name: "분류 필터" });
    expect(group).toHaveTextContent("전체 6");
    expect(group).toHaveTextContent("배송 3");
    expect(group).toHaveTextContent("품질 2");
    expect(group).toHaveTextContent("분류 전 1");
  });

  it("refetches with the chosen category and sends the sentinel for the unclassified bucket", async () => {
    const spy = vi.spyOn(api, "getAttentionItems").mockResolvedValue(faceted());

    render(<OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />);
    await screen.findByRole("group", { name: "분류 필터" });

    await userEvent.click(screen.getByRole("button", { name: /배송 3/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("a", expect.objectContaining({ category: "배송" })),
    );

    await userEvent.click(screen.getByRole("button", { name: /분류 전 1/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("a", expect.objectContaining({ category: "unclassified" })),
    );
  });

  it("omits the param entirely for 전체 rather than sending an empty category", async () => {
    const spy = vi.spyOn(api, "getAttentionItems").mockResolvedValue(faceted());

    render(<OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />);
    await screen.findByRole("group", { name: "분류 필터" });
    await userEvent.click(screen.getByRole("button", { name: /배송 3/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole("button", { name: /전체 6/ }));

    await waitFor(() => {
      const last = spy.mock.calls[spy.mock.calls.length - 1][1];
      expect(last).not.toHaveProperty("category");
    });
  });

  it("resets to the first page when the facet changes", async () => {
    // A page index left over from a wider result set renders an empty list above a non-zero
    // total — which reads as "no such reviews" when the truth is "you are past the end".
    const spy = vi.spyOn(api, "getAttentionItems").mockResolvedValue(
      faceted({ page: 0, total: 30, unfilteredTotal: 30 }),
    );

    render(<OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />);
    await screen.findByRole("group", { name: "분류 필터" });
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("a", expect.objectContaining({ page: 1 })),
    );

    await userEvent.click(screen.getByRole("button", { name: /배송 3/ }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("a", expect.objectContaining({ category: "배송", page: 0 })),
    );
  });

  it("keeps the facet visible when a filter yields nothing, so the operator is not stranded", async () => {
    vi.spyOn(api, "getAttentionItems").mockResolvedValue(faceted({ total: 0, items: [] }));

    render(<OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />);

    expect(await screen.findByText("해당하는 항목이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "분류 필터" })).toBeInTheDocument();
  });

  it("hides the facet when there is nothing to choose between", async () => {
    // A control whose every setting shows the same rows is noise dressed as agency.
    vi.spyOn(api, "getAttentionItems").mockResolvedValue(
      page([row()], 3, { unfilteredTotal: 3, categoryCounts: [{ category: "배송", count: 3 }], unclassifiedCount: 0 }),
    );

    render(<OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />);

    await screen.findByText(/총 3건/);
    expect(screen.queryByRole("group", { name: "분류 필터" })).not.toBeInTheDocument();
  });

  it("shows no facet counts beside a failed read", async () => {
    // Fail closed: the counts describe a window this read could not confirm, so rendering
    // them next to an error would present unverified numbers as current.
    vi.spyOn(api, "getAttentionItems").mockRejectedValue(new Error("backend down"));

    render(<OperatorVocItemList accountId="a" type="LOW_RATING_REVIEW" from="2026-05-01" to="2026-05-31" />);

    expect(await screen.findByText(/항목을 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "분류 필터" })).not.toBeInTheDocument();
  });
});
