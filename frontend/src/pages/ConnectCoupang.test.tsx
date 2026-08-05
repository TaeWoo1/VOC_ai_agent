// @vitest-environment jsdom
// ConnectCoupang page: the first-time Coupang connection surface. Proves the read-only prerequisite
// display (advertised calling IP, never fabricated), the lazy account-create → store → test chain, and
// the honest two-signal success copy (a passing test is NOT a completed connection).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { screen, userEvent, waitFor } from "../test/renderWithRouter";
import type { ConnectionTestResultView } from "../lib/types";

const COUPANG_TEMPLATE = {
  channelCode: "COUPANG",
  connectorClass: "API",
  authType: "HMAC",
  fields: [
    { key: "access_key", label: "액세스 키", required: true, secret: false, helpText: "" },
    { key: "secret_key", label: "시크릿 키", required: true, secret: true, helpText: "" },
    { key: "vendor_id", label: "업체 코드", required: true, secret: false, helpText: "" },
  ],
  notes: "",
};

const h = vi.hoisted(() => ({
  advertisedEgressIps: ["203.0.113.20"] as string[],
  accounts: [] as unknown[],
  testResult: {
    sellerAccountId: "acc-new",
    status: "SUCCESS",
    checkedAt: "2026-08-05T00:00:00Z",
    message: "연결 정보가 확인되었습니다.",
    reasonCode: null,
  } as ConnectionTestResultView,
  createApiChannelAccount: vi.fn(async (_channelId: string) => ({ id: "acc-new" })),
  storeCredential: vi.fn(
    async (
      _accountId: string,
      _request: { connectorClass: string; authType: string; secrets: Record<string, string> },
    ) => undefined,
  ),
  testConnection: vi.fn(async (_accountId: string) => h.testResult),
}));

vi.mock("../lib/apiClient", () => ({
  api: {
    getCoupangSetup: async () => ({ advertisedEgressIps: h.advertisedEgressIps }),
    getChannelsStrict: async () => [{ id: "coupang-ch", code: "COUPANG" }],
    getSellerAccountsStrict: async () => h.accounts,
    getCredentialTemplateStrict: async () => COUPANG_TEMPLATE,
    createApiChannelAccount: h.createApiChannelAccount,
    storeCredential: h.storeCredential,
    testConnection: h.testConnection,
  },
}));

import { ConnectCoupang } from "./ConnectCoupang";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connect/coupang"]}>
      <ConnectCoupang />
    </MemoryRouter>,
  );
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("액세스 키"), "AK-TEST");
  await user.type(screen.getByLabelText("시크릿 키"), "SK-SECRET");
  await user.type(screen.getByLabelText("업체 코드"), "A00012345");
}

describe("ConnectCoupang", () => {
  beforeEach(() => {
    h.advertisedEgressIps = ["203.0.113.20"];
    h.accounts = [];
    h.testResult = {
      sellerAccountId: "acc-new",
      status: "SUCCESS",
      checkedAt: "2026-08-05T00:00:00Z",
      message: "연결 정보가 확인되었습니다.",
      reasonCode: null,
    };
    h.createApiChannelAccount.mockClear();
    h.storeCredential.mockClear();
    h.testConnection.mockClear();
  });

  it("shows the prerequisites and the advertised calling IP from the setup endpoint", async () => {
    renderPage();
    expect(await screen.findByTestId("coupang-prereqs")).toBeInTheDocument();
    // The advertised IP is displayed (never fabricated — it came from the backend).
    expect(await screen.findByText("203.0.113.20")).toBeInTheDocument();
    // A page load creates no account.
    expect(h.createApiChannelAccount).not.toHaveBeenCalled();
  });

  it("shows the 'not yet advertised' guidance (never a fabricated IP) when no IP is configured", async () => {
    h.advertisedEgressIps = [];
    renderPage();
    expect(await screen.findByTestId("coupang-prereqs")).toBeInTheDocument();
    expect(await screen.findByText(/아직 설정되지 않았습니다/)).toBeInTheDocument();
  });

  it("submits credentials → lazy account create → store → test, and shows honest two-signal success", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    await waitFor(() => expect(screen.getByTestId("coupang-test-success")).toBeInTheDocument());
    // The account was created lazily, the secret went ONLY to storeCredential, then the test ran.
    expect(h.createApiChannelAccount).toHaveBeenCalledWith("coupang-ch");
    expect(h.storeCredential).toHaveBeenCalledTimes(1);
    expect(h.storeCredential.mock.calls[0][1].secrets).toMatchObject({
      access_key: "AK-TEST",
      secret_key: "SK-SECRET",
      vendor_id: "A00012345",
    });
    expect(h.testConnection).toHaveBeenCalledWith("acc-new");
    // Honest: a passing test is NOT a completed connection — the first sync completes it.
    expect(screen.getByText(/첫 주문 수집이 완료되면 연결이 완료됩니다/)).toBeInTheDocument();
  });

  it("shows a safe failure message on a failed test (e.g. call-IP not registered)", async () => {
    h.testResult = {
      sellerAccountId: "acc-new",
      status: "FAILED",
      checkedAt: "2026-08-05T00:00:00Z",
      message: "허용된 호출 환경(호출 IP)과 일치하지 않을 수 있습니다. 애플리케이션의 API 호출 IP 등록을 확인해 주세요.",
      reasonCode: "CALL_ENVIRONMENT_MISMATCH",
    };
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    const banner = await screen.findByTestId("coupang-test-failed");
    expect(banner).toHaveTextContent(/API 호출 IP 등록을 확인/);
  });
});
