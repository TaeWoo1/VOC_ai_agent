// @vitest-environment jsdom
// ConnectNaver page integration: proves the wiring the unit tests can't — bridge pairing feeds the
// readiness gate, and the imperative register→test→sync chain drives the journey to completed with a
// real (mocked) backend boundary. Also pins that the Client Secret reaches ONLY api.storeCredential.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { screen, userEvent, waitFor } from "../test/renderWithRouter";
import { NAVER_LIKE_TEMPLATE } from "../lib/guidedConnection";

vi.mock("../hooks/useBridge", () => ({
  useBridge: () => ({
    state: { phase: "paired", maybeNeedsLocalNetworkAccess: false },
    requestPairing: vi.fn(),
    revoke: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock("../lib/apiClient", () => ({
  api: {
    getChannelsStrict: vi.fn(),
    getSellerAccountsStrict: vi.fn(),
    getCredentialTemplateStrict: vi.fn(),
    storeCredential: vi.fn(),
    testConnection: vi.fn(),
    manualSync: vi.fn(),
  },
}));

import { api } from "../lib/apiClient";
import { ConnectNaver } from "./ConnectNaver";

const SECRET = "n4ver-client-secret";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getChannelsStrict).mockResolvedValue([
    { id: "ch-naver", code: "NAVER", nameKo: "네이버", status: "AVAILABLE", dataBadges: [], lastSyncedAt: null, actionLabel: "연결하기", support: {} as never },
  ]);
  vi.mocked(api.getSellerAccountsStrict).mockResolvedValue([
    { id: "acc-1", channelId: "ch-naver", channelNameKo: "네이버", alias: null, connectionStatus: "PENDING", lastSyncedAt: null, fileUpload: false },
  ]);
  vi.mocked(api.getCredentialTemplateStrict).mockResolvedValue(NAVER_LIKE_TEMPLATE);
  vi.mocked(api.storeCredential).mockResolvedValue(undefined);
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connect/naver"]}>
      <ConnectNaver />
    </MemoryRouter>,
  );
}

describe("ConnectNaver — end-to-end guided journey (offline, mocked backend)", () => {
  it("walks readiness → issuance → credentials → test → sync → completed", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
    vi.mocked(api.manualSync).mockResolvedValue({ id: "run-1", sellerAccountId: "acc-1", channelId: "ch-naver", dataType: "ORDER_SUMMARY", trigger: "MANUAL", attempt: 1, rateLimited: false, nextRetryAt: null, jobType: "SYNC", uploadType: null, status: "SUCCESS", totalRows: 0, successRows: 0, skippedRows: 0, failedRows: 0, errorMessage: null, startedAt: null, finishedAt: null });

    renderPage();

    // Paired agent + no login attestation yet → the gate stops at NAVER 로그인 필요.
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
    await userEvent.click(await screen.findByRole("button", { name: "발급을 완료했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /발급된 정보를 입력/ }));

    await userEvent.type(await screen.findByLabelText(/Client ID/), "app-id-1");
    await userEvent.type(screen.getByLabelText(/Client Secret/), SECRET);
    await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    // The imperative chain (register → test → first sync) drives us to completed.
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(api.storeCredential).toHaveBeenCalledWith("acc-1", {
      connectorClass: NAVER_LIKE_TEMPLATE.connectorClass,
      authType: NAVER_LIKE_TEMPLATE.authType,
      secrets: { client_id: "app-id-1", client_secret: SECRET },
    });
    expect(api.testConnection).toHaveBeenCalledWith("acc-1");
    expect(api.manualSync).toHaveBeenCalledWith("acc-1", "ORDER_SUMMARY");
  });

  it("a 0-row first sync still completes (SUCCESS with no new orders ≠ failure)", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
    vi.mocked(api.manualSync).mockResolvedValue({ id: "run-2", sellerAccountId: "acc-1", channelId: "ch-naver", dataType: "ORDER_SUMMARY", trigger: "MANUAL", attempt: 1, rateLimited: false, nextRetryAt: null, jobType: "SYNC", uploadType: null, status: "SUCCESS", totalRows: 0, successRows: 0, skippedRows: 0, failedRows: 0, errorMessage: null, startedAt: null, finishedAt: null });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
    await userEvent.click(await screen.findByRole("button", { name: "발급을 완료했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /발급된 정보를 입력/ }));
    await userEvent.type(await screen.findByLabelText(/Client ID/), "app-id-1");
    await userEvent.type(screen.getByLabelText(/Client Secret/), SECRET);
    await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
  });

  it("an invalid credential bounces back to the entry step, not completion", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "FAILED", checkedAt: "", message: "", reasonCode: "INVALID_CREDENTIAL" });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
    await userEvent.click(await screen.findByRole("button", { name: "발급을 완료했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /발급된 정보를 입력/ }));
    await userEvent.type(await screen.findByLabelText(/Client ID/), "app-id-1");
    await userEvent.type(screen.getByLabelText(/Client Secret/), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    // Back at credential entry with a safe reason; sync never ran.
    expect(await screen.findByRole("alert")).toHaveTextContent(/연결 정보가 올바르지 않/);
    expect(screen.getByRole("heading", { name: "연결 정보 입력" })).toBeInTheDocument();
    expect(api.manualSync).not.toHaveBeenCalled();
  });

  it("never persists the Client Secret to localStorage", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
    vi.mocked(api.manualSync).mockResolvedValue({ id: "run-3", sellerAccountId: "acc-1", channelId: "ch-naver", dataType: "ORDER_SUMMARY", trigger: "MANUAL", attempt: 1, rateLimited: false, nextRetryAt: null, jobType: "SYNC", uploadType: null, status: "SUCCESS", totalRows: 0, successRows: 0, skippedRows: 0, failedRows: 0, errorMessage: null, startedAt: null, finishedAt: null });
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
    await userEvent.click(await screen.findByRole("button", { name: "발급을 완료했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /발급된 정보를 입력/ }));
    await userEvent.type(await screen.findByLabelText(/Client ID/), "app-id-1");
    await userEvent.type(screen.getByLabelText(/Client Secret/), SECRET);
    await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    await screen.findByRole("heading", { name: "주문 연결 완료" });

    await waitFor(() => {
      for (const call of setItem.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
    });
  });
});
