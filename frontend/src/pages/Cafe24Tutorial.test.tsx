// @vitest-environment jsdom
// Cafe24 first-connection tutorial integration: the step chain, callback resume, per-cause
// failure guidance, refresh recovery, and the read-only capability/sync wiring — all against a
// mocked backend boundary. Also pins that no OAuth code/state/token is ever read here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { screen, userEvent, waitFor } from "../test/renderWithRouter";
import type { Cafe24CapabilityView, SyncRunView } from "../lib/types";

vi.mock("../lib/apiClient", () => ({
  api: {
    startCafe24Connect: vi.fn(),
    getCafe24Capability: vi.fn(),
    manualSync: vi.fn(),
  },
}));

import { api } from "../lib/apiClient";
import { Cafe24Tutorial } from "./Cafe24Tutorial";

const ROUTE = "/connect/cafe24/tutorial";

function verifiedView(over: Partial<Cafe24CapabilityView> = {}): Cafe24CapabilityView {
  return {
    sellerAccountId: "acc-1",
    connectionStatus: "CONNECTED",
    credentialPresent: true,
    credentialDecryptable: true,
    identityConfirmed: true,
    excludedBoardHidden: true,
    connectionVerified: true,
    overall: "AVAILABLE",
    reason: null,
    features: [
      { feature: "ORDER_READ", state: "AVAILABLE", label: "주문 조회", reason: null },
      { feature: "INQUIRY_COLLECT", state: "AVAILABLE", label: "문의 수집", reason: null },
      { feature: "REVIEW_COLLECT", state: "AVAILABLE", label: "리뷰 수집", reason: null },
      { feature: "ISSUE_ANALYSIS", state: "AVAILABLE", label: "운영 이슈 분석", reason: null },
      { feature: "INQUIRY_REPLY", state: "NOT_ENABLED", label: "문의 답변 API (읽기 전용 연결에서는 미활성화)", reason: "READ_ONLY_CONNECTION" },
      { feature: "ONE_TO_ONE_EXCLUDED", state: "NOT_ENABLED", label: "1:1 맞춤상담 게시판은 수집하지 않습니다", reason: null },
    ],
    ...over,
  };
}

const syncRun = (over: Partial<SyncRunView> = {}): SyncRunView => ({
  id: "run", sellerAccountId: "acc-1", channelId: "ch", dataType: "ORDER_SUMMARY", trigger: "MANUAL",
  attempt: 1, rateLimited: false, nextRetryAt: null, jobType: "SYNC", uploadType: null, status: "SUCCESS",
  totalRows: 1, successRows: 1, skippedRows: 0, failedRows: 0, errorMessage: null, startedAt: null, finishedAt: null,
  ...over,
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/connect/cafe24/tutorial" element={<Cafe24Tutorial />} />
        <Route path="/settings/channels" element={<div>채널 목록</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("Cafe24Tutorial step chain", () => {
  it("walks intro → mall → permissions → consent and redirects to Cafe24", async () => {
    vi.mocked(api.startCafe24Connect).mockResolvedValue({
      sellerAccountId: "acc-1",
      connectionStatus: "PENDING",
      authorizationUrl: "https://mystore.cafe24.com/oauth",
    });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign },
    });
    renderAt(ROUTE);

    await userEvent.click(screen.getByRole("button", { name: "시작하기" }));
    await userEvent.type(screen.getByLabelText("쇼핑몰 주소 또는 Mall ID"), "mystore.cafe24.com");
    await userEvent.click(screen.getByRole("button", { name: "Mall ID 확인" }));

    // Permissions step shows the normalized mall id and read-only scopes.
    expect(await screen.findByText("mystore")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "동의 화면으로 진행" }));
    await userEvent.click(screen.getByRole("button", { name: "카페24 동의 화면으로 이동" }));

    await waitFor(() => expect(api.startCafe24Connect).toHaveBeenCalledWith("mystore"));
    expect(assign).toHaveBeenCalledWith("https://mystore.cafe24.com/oauth");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("rejects a non-cafe24 host at the mall step (fail-closed)", async () => {
    renderAt(ROUTE);
    await userEvent.click(screen.getByRole("button", { name: "시작하기" }));
    await userEvent.type(screen.getByLabelText("쇼핑몰 주소 또는 Mall ID"), "https://evil.com/x");
    await userEvent.click(screen.getByRole("button", { name: "Mall ID 확인" }));
    expect(await screen.findByText(/자사몰 주소\(\*\.cafe24\.com\)/)).toBeInTheDocument();
    // Did not advance.
    expect(screen.queryByRole("button", { name: "동의 화면으로 진행" })).not.toBeInTheDocument();
  });
});

describe("Cafe24Tutorial callback resume", () => {
  it("auto-verifies, first-syncs, and shows real feature results on success", async () => {
    vi.mocked(api.getCafe24Capability).mockResolvedValue(verifiedView());
    vi.mocked(api.manualSync).mockResolvedValue(syncRun({ status: "SUCCESS" }));

    renderAt(`${ROUTE}?status=connected&accountId=acc-1`);

    expect(await screen.findByText("연결 완료")).toBeInTheDocument();
    expect(await screen.findByText("주문 조회")).toBeInTheDocument();
    expect(screen.getByText("문의 수집")).toBeInTheDocument();
    // Reply is honestly shown as not enabled (the badge text is exactly 미활성화).
    expect(screen.getAllByText("미활성화").length).toBeGreaterThanOrEqual(1);
    expect(api.manualSync).toHaveBeenCalledWith("acc-1", "ORDER_SUMMARY");
  });

  it("shows reconnect guidance when the callback failed", async () => {
    renderAt(`${ROUTE}?status=reconnect_required&accountId=acc-1`);
    expect(await screen.findByText(/카페24 동의를 다시 진행/)).toBeInTheDocument();
    expect(api.getCafe24Capability).not.toHaveBeenCalled();
  });

  it("shows board-mapping guidance and does not run a sync when verification fails", async () => {
    vi.mocked(api.getCafe24Capability).mockResolvedValue(
      verifiedView({
        connectionVerified: false,
        overall: "NEEDS_ATTENTION",
        reason: null,
        features: [
          { feature: "INQUIRY_COLLECT", state: "NEEDS_ATTENTION", label: "문의 수집", reason: "BOARD_MAPPING_MISMATCH" },
        ],
      }),
    );
    renderAt(`${ROUTE}?status=connected&accountId=acc-1`);
    expect(await screen.findByText(/게시판.*매핑/)).toBeInTheDocument();
    expect(api.manualSync).not.toHaveBeenCalled();
  });

  it("fails when the first order sync does not collect", async () => {
    vi.mocked(api.getCafe24Capability).mockResolvedValue(verifiedView());
    vi.mocked(api.manualSync).mockResolvedValue(syncRun({ status: "FAILED" }));
    renderAt(`${ROUTE}?status=connected&accountId=acc-1`);
    expect(await screen.findByText(/첫 동기화에 실패/)).toBeInTheDocument();
  });

  it("keeps a transient provider error retryable on the verify step", async () => {
    vi.mocked(api.getCafe24Capability).mockResolvedValue(
      verifiedView({ connectionVerified: false, overall: "NEEDS_ATTENTION", reason: "PROVIDER_ERROR" }),
    );
    renderAt(`${ROUTE}?status=connected&accountId=acc-1`);
    expect(await screen.findByText(/일시적인 오류/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 검증" })).toBeInTheDocument();
  });

  it("in-place retry re-verifies (never resets to mall entry) and can then succeed", async () => {
    // First probe transient, second probe verified — the retry must re-run verify in place.
    vi.mocked(api.getCafe24Capability)
      .mockResolvedValueOnce(
        verifiedView({ connectionVerified: false, overall: "NEEDS_ATTENTION", reason: "PROVIDER_ERROR" }),
      )
      .mockResolvedValue(verifiedView());
    vi.mocked(api.manualSync).mockResolvedValue(syncRun({ status: "SUCCESS" }));

    renderAt(`${ROUTE}?status=connected&accountId=acc-1`);
    await userEvent.click(await screen.findByRole("button", { name: "다시 검증" }));

    // Advances to completion — did NOT drop back to the mall-entry step.
    expect(await screen.findByText("연결 완료")).toBeInTheDocument();
    expect(screen.queryByLabelText("쇼핑몰 주소 또는 Mall ID")).not.toBeInTheDocument();
    expect(api.getCafe24Capability).toHaveBeenCalledTimes(3); // verify, retry-verify, completion
  });
});

describe("Cafe24Tutorial refresh recovery", () => {
  it("restores the persisted step on a fresh mount with no params", async () => {
    sessionStorage.setItem(
      "cafe24_tutorial_v1",
      JSON.stringify({ phase: "permissions", mallId: "mystore", accountId: null, failure: null }),
    );
    renderAt(ROUTE);
    expect(await screen.findByText("요청 권한 안내")).toBeInTheDocument();
    expect(screen.getByText("mystore")).toBeInTheDocument();
  });
});
