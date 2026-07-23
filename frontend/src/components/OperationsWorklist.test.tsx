// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OperationsWorklist } from "./OperationsWorklist";
import { api } from "../lib/apiClient";
import type { OperatorAttentionSummary, SellerAccountResponse } from "../lib/types";

function account(over: Partial<SellerAccountResponse> = {}): SellerAccountResponse {
  return {
    id: "acct-1",
    channelId: "ch-1",
    channelNameKo: "네이버 스마트스토어",
    alias: null,
    connectionStatus: "CONNECTED",
    lastSyncedAt: null,
    fileUpload: true,
    ...over,
  };
}

function attention(): OperatorAttentionSummary {
  return {
    sellerAccountId: "acct-1",
    channel: "네이버 스마트스토어",
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
    items: [
      {
        type: "LOW_RATING_REVIEW",
        severity: "HIGH",
        count: 2,
        label: "낮은 평점(1~2점) 리뷰",
        description: "불만족 리뷰입니다.",
        sourceType: "REVIEW",
        channel: "네이버 스마트스토어",
      },
    ],
  };
}

function renderWorklist() {
  return render(
    <MemoryRouter>
      <OperationsWorklist />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "getAccountAttention").mockResolvedValue(attention());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OperationsWorklist", () => {
  it("shows the worklist for a lone account, and names it", () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([account({ alias: "본점" })]);

    renderWorklist();

    return waitFor(() => {
      expect(screen.getByText("본점")).toBeInTheDocument();
      expect(screen.getByText("낮은 평점(1~2점) 리뷰")).toBeInTheDocument();
    });
  });

  it("fails CLOSED — a dead read must never read as 'nothing needs your attention'", async () => {
    // The failure this product's strict reads exist to prevent. A seller who sees a calm empty
    // state stops looking; a seller who sees an error tries again.
    vi.spyOn(api, "getSellerAccountsStrict").mockRejectedValue(new Error("backend down"));

    renderWorklist();

    expect(await screen.findByText(/확인할 일을 불러오지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByText(/확인할 일이 없습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/연결된 판매 채널이 없어요/)).not.toBeInTheDocument();
  });

  it("distinguishes 'no channel connected' from 'nothing to do', and offers the way out", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([]);

    renderWorklist();

    expect(await screen.findByText(/연결된 판매 채널이 없어요/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /채널 연결하러 가기/ })).toHaveAttribute(
      "href",
      "/settings/channels",
    );
  });

  it("asks which channel when there are several, and shows NO rows until asked", async () => {
    // Auto-picking would render one account's view as the whole worklist — the exact inference the
    // backend refuses to make, since `reviews` carries no seller_account_id.
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([
      account({ id: "a", alias: "본점" }),
      account({ id: "b", alias: "2호점" }),
    ]);

    renderWorklist();

    expect(await screen.findByRole("group", { name: "채널 선택" })).toBeInTheDocument();
    expect(screen.getByText(/확인할 채널을 선택해 주세요/)).toBeInTheDocument();
    expect(screen.queryByText("낮은 평점(1~2점) 리뷰")).not.toBeInTheDocument();
    // And it never asked the server for anybody's rows.
    expect(api.getAccountAttention).not.toHaveBeenCalled();
  });

  it("shows the chosen account's worklist, and only after the seller chooses", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([
      account({ id: "a", alias: "본점" }),
      account({ id: "b", alias: "2호점" }),
    ]);

    renderWorklist();
    await screen.findByRole("group", { name: "채널 선택" });
    await userEvent.click(screen.getByRole("button", { name: "2호점" }));

    await waitFor(() =>
      expect(api.getAccountAttention).toHaveBeenCalledWith("b", expect.anything()),
    );
    expect(await screen.findByText("낮은 평점(1~2점) 리뷰")).toBeInTheDocument();
  });

  it("lets the seller switch channels without reloading the page", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([
      account({ id: "a", alias: "본점" }),
      account({ id: "b", alias: "2호점" }),
    ]);

    renderWorklist();
    await screen.findByRole("group", { name: "채널 선택" });
    await userEvent.click(screen.getByRole("button", { name: "2호점" }));
    await waitFor(() => expect(api.getAccountAttention).toHaveBeenCalledWith("b", expect.anything()));

    await userEvent.click(screen.getByRole("button", { name: "본점" }));

    await waitFor(() => expect(api.getAccountAttention).toHaveBeenCalledWith("a", expect.anything()));
  });

  it("refetches when the page signals a settled run — the completion copy points here", async () => {
    // CompletedResult tells the seller their reviews appear "아래". A list fetched before the import
    // landed would make that sentence false at the one moment a seller is certain to read it.
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([account({ id: "a" })]);
    const { rerender } = render(
      <MemoryRouter>
        <OperationsWorklist refreshKey={0} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.getAccountAttention).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter>
        <OperationsWorklist refreshKey={42} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.getAccountAttention).toHaveBeenCalledTimes(2));
  });

  it("does not re-resolve the ACCOUNTS on a refresh — an import does not connect a channel", async () => {
    const accounts = vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([account({ id: "a" })]);
    const { rerender } = render(
      <MemoryRouter>
        <OperationsWorklist refreshKey={0} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.getAccountAttention).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter>
        <OperationsWorklist refreshKey={7} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.getAccountAttention).toHaveBeenCalledTimes(2));

    expect(accounts).toHaveBeenCalledTimes(1);
  });

  it("does not render a list while the accounts are still loading", () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockReturnValue(new Promise(() => {}));

    renderWorklist();

    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByText(/확인할 일이 없습니다/)).not.toBeInTheDocument();
  });
});
