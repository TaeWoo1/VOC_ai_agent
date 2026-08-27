// @vitest-environment jsdom
//
// Disconnected Channel Onboarding Live Walkthrough v1 §17/§19-A.
//
// A seller who signed up two minutes ago was told 「지금 먼저 확인할 일은 없습니다」 above six zeros.
// The sentence was arithmetically correct and operationally false: there IS one thing to do, it is
// the only thing, and it was not on the screen.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentBriefing } from "./AgentBriefing";
import { renderWithRouter, screen, waitFor } from "../../test/renderWithRouter";
import { api } from "../../lib/apiClient";
import type { SellerAccountResponse } from "../../lib/types";

function account(connectionStatus: string): SellerAccountResponse {
  return {
    id: "acct-1",
    channelId: "ch-1",
    channelCode: "CAFE24",
    channelNameKo: "카페24 자사몰",
    label: "몰",
    connectionStatus,
    fileUpload: false,
  } as unknown as SellerAccountResponse;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "getInquiryQueueStrict").mockResolvedValue({ content: [], totalElements: 0, totalPages: 0 } as never);
  vi.spyOn(api, "getProactiveCases").mockResolvedValue({ items: [], total: 0 } as never);
});

describe("AgentBriefing — before the first connection", () => {
  it("names the one thing to do instead of counting an absence", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([]);
    renderWithRouter(<AgentBriefing insights={[]} />);

    expect(await screen.findByText("판매 채널을 연결하면 시작할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "채널 연결하기" })).toHaveAttribute("href", "/connect");
    expect(screen.queryByText("지금 먼저 확인할 일은 없습니다.")).toBeNull();
  });

  it("a pending account is not a connection", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([account("PENDING")]);
    renderWithRouter(<AgentBriefing insights={[]} />);
    expect(await screen.findByText("판매 채널을 연결하면 시작할 수 있습니다.")).toBeInTheDocument();
  });

  it("goes away by itself once one channel is connected — no flag to turn off", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([account("CONNECTED")]);
    renderWithRouter(<AgentBriefing insights={[]} />);

    await waitFor(() => expect(screen.getByText("지금 먼저 확인할 일은 없습니다.")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "채널 연결하기" })).toBeNull();
  });

  it("never invents an outage: a failed read is 「모른다」, not 「연결이 없다」", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockRejectedValue(new Error("backend down"));
    renderWithRouter(<AgentBriefing insights={[]} />);

    await waitFor(() => expect(screen.getByText("지금 먼저 확인할 일은 없습니다.")).toBeInTheDocument());
    expect(screen.queryByText("판매 채널을 연결하면 시작할 수 있습니다.")).toBeNull();
  });
});
