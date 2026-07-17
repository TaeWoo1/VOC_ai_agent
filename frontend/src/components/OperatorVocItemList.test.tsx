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
    ...over,
  };
}

function page(items: OperatorVocItem[], total = items.length): OperatorVocItemPage {
  return {
    signalType: "LOW_RATING_REVIEW",
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
    page: 0,
    size: 10,
    total,
    items,
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
