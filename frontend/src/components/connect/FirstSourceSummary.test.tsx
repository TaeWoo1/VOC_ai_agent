// @vitest-environment jsdom
//
// Disconnected Channel Onboarding Live Walkthrough v1 §5/§6/§7/§19-B/C/D.
//
// The card a connection now ends at. What is under test is not the layout: it is which sentences this
// screen is allowed to say, and where the number in them is allowed to come from.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FirstSourceSummary } from "./FirstSourceSummary";
import { renderWithRouter, screen, waitFor } from "../../test/renderWithRouter";
import { api } from "../../lib/apiClient";
import type { ChannelCoverageRowView, SyncRunView } from "../../lib/types";

function coverage(dataType: string, state: ChannelCoverageRowView["state"], rows = 0): ChannelCoverageRowView {
  return {
    channelCode: "CAFE24",
    channelNameKo: "카페24",
    dataType,
    state,
    supported: state !== "NOT_SUPPORTED",
    verificationStatus: null,
    connected: true,
    connectionStatus: "CONNECTED",
    routineEnabled: true,
    routinePausedBy: null,
    lastSuccessfulSyncAt: null,
    rows,
    openRows: null,
    newestObservedAt: null,
  };
}

function run(dataType: string, successRows: number): SyncRunView {
  return {
    id: `run-${dataType}`,
    sellerAccountId: "acct-1",
    channelId: "ch-1",
    dataType,
    trigger: "MANUAL",
    attempt: 1,
    rateLimited: false,
    nextRetryAt: null,
    jobType: "SYNC",
    uploadType: null,
    status: "SUCCESS",
    totalRows: successRows,
    successRows,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
    startedAt: "2026-08-27T00:59:00Z",
    finishedAt: "2026-08-27T01:00:00Z",
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("FirstSourceSummary", () => {
  it("tells the seller what came in and hands them to the work, not back to the channel list", async () => {
    vi.spyOn(api, "getChannelCoverageStrict").mockResolvedValue([
      coverage("ORDER_SUMMARY", "OBSERVED_FRESH"),
      coverage("INQUIRY", "OBSERVED_FRESH"),
    ]);
    vi.spyOn(api, "getSyncRunsStrict").mockResolvedValue([run("ORDER_SUMMARY", 14), run("INQUIRY", 22)]);

    renderWithRouter(<FirstSourceSummary channelCode="CAFE24" channelNameKo="카페24" accountId="acct-1" />);

    expect(await screen.findByText("카페24에서 다음 정보를 가져왔습니다.")).toBeInTheDocument();
    expect(screen.getByText("주문 14건을 가져왔습니다.")).toBeInTheDocument();
    expect(screen.getByText("문의 22건을 가져왔습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 할 일 확인하기" })).toHaveAttribute("href", "/");
  });

  it("does not turn stored rows into a collection claim (§19-D)", async () => {
    // 4,000 rows held, nothing proven fresh, no run: the screen may not say it fetched anything and
    // may not say there is nothing.
    vi.spyOn(api, "getChannelCoverageStrict").mockResolvedValue([
      coverage("INQUIRY", "OBSERVED_FRESHNESS_UNPROVEN", 4000),
    ]);
    vi.spyOn(api, "getSyncRunsStrict").mockResolvedValue([]);

    renderWithRouter(<FirstSourceSummary channelCode="CAFE24" channelNameKo="카페24" accountId="acct-1" />);

    expect(await screen.findByText("문의는 아직 확인하지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/4000|4,000/)).toBeNull();
    expect(screen.queryByText(/없습니다/)).toBeNull();
  });

  it("reports a measured zero as a normal outcome, not a failure (§19-C)", async () => {
    vi.spyOn(api, "getChannelCoverageStrict").mockResolvedValue([coverage("INQUIRY", "ZERO")]);
    vi.spyOn(api, "getSyncRunsStrict").mockResolvedValue([]);

    renderWithRouter(<FirstSourceSummary channelCode="CAFE24" channelNameKo="카페24" accountId="acct-1" />);

    expect(await screen.findByText("확인된 문의가 없습니다.")).toBeInTheDocument();
    const card = screen.getByTestId("first-source-summary");
    expect(card).toHaveTextContent("연결이 완료되었습니다");
    expect(card.textContent).not.toMatch(/실패|오류/);
  });

  it("keeps the handoff when the reads fail — silence, never an invented number", async () => {
    vi.spyOn(api, "getChannelCoverageStrict").mockRejectedValue(new Error("boom"));
    vi.spyOn(api, "getSyncRunsStrict").mockRejectedValue(new Error("boom"));

    renderWithRouter(<FirstSourceSummary channelCode="CAFE24" channelNameKo="카페24" accountId="acct-1" />);

    await waitFor(() => expect(screen.queryByTestId("first-source-lines")).toBeNull());
    expect(screen.getByRole("link", { name: "오늘 할 일 확인하기" })).toBeInTheDocument();
    expect(screen.getByTestId("first-source-summary")).toHaveTextContent("카페24 연결이 완료되었습니다.");
  });

  it("reads no runs at all when there is no account yet", async () => {
    const coverageRead = vi.spyOn(api, "getChannelCoverageStrict").mockResolvedValue([]);
    const runsRead = vi.spyOn(api, "getSyncRunsStrict").mockResolvedValue([]);

    renderWithRouter(<FirstSourceSummary channelCode="NAVER" channelNameKo="네이버" accountId={null} />);

    await waitFor(() => expect(coverageRead).toHaveBeenCalled());
    expect(runsRead).not.toHaveBeenCalled();
  });
});
