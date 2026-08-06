// @vitest-environment jsdom
// ConnectCoupang: the first-connection tutorial + guided initial sync. Proves the read-only prerequisite
// display (advertised calling IP, never fabricated), the lazy account-create → store → test chain that
// lands on PREPARING (not a completed connection), the explicit first-sync CTA → CONNECTED, refresh
// recovery from persisted state, per-reason error recovery, and the single-flight guards.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { screen, userEvent } from "../test/renderWithRouter";
import type { ConnectionTestResultView, SellerAccountResponse, SyncRunView } from "../lib/types";

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

function run(overrides: Partial<SyncRunView>): SyncRunView {
  return {
    id: "run-1",
    sellerAccountId: "acc-new",
    channelId: "coupang-ch",
    dataType: "ORDER_SUMMARY",
    trigger: "MANUAL",
    attempt: 1,
    rateLimited: false,
    nextRetryAt: null,
    jobType: "SYNC",
    uploadType: null,
    status: "SUCCESS",
    totalRows: 12,
    successRows: 12,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
    startedAt: "2026-08-06T00:00:00Z",
    finishedAt: "2026-08-06T00:01:00Z",
    ...overrides,
  };
}

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const h = vi.hoisted(() => ({
  advertisedEgressIps: ["203.0.113.20"] as string[],
  accounts: [] as SellerAccountResponse[],
  connectionInfo: null as unknown, // null = no credential on file
  runs: [] as SyncRunView[],
  connStatusState: "CONNECTED" as string,
  testResult: {
    sellerAccountId: "acc-new",
    status: "SUCCESS",
    checkedAt: "2026-08-06T00:00:00Z",
    message: "연결 정보가 확인되었습니다.",
    reasonCode: null,
  } as ConnectionTestResultView,
  syncRun: run({ status: "SUCCESS" }) as SyncRunView,
  createApiChannelAccount: vi.fn(async (_channelId: string) => ({ id: "acc-new" })),
  storeCredential: vi.fn(
    async (
      _accountId: string,
      _request: { connectorClass: string; authType: string; secrets: Record<string, string> },
    ) => undefined,
  ),
  testConnection: vi.fn(async () => h.testResult),
  manualSync: vi.fn(async (_id: string, _dt: string) => h.syncRun),
  getSyncRuns: vi.fn(async () => h.runs),
}));

vi.mock("../lib/apiClient", () => ({
  api: {
    getCoupangSetup: async () => ({ advertisedEgressIps: h.advertisedEgressIps }),
    getChannelsStrict: async () => [{ id: "coupang-ch", code: "COUPANG" }],
    getSellerAccountsStrict: async () => h.accounts,
    getCredentialTemplateStrict: async () => COUPANG_TEMPLATE,
    getConnectionInfoStrict: async () => h.connectionInfo,
    getSyncRunsStrict: h.getSyncRuns,
    getConnectionStatusStrict: async () => ({
      sellerAccountId: "acc-new",
      state: h.connStatusState,
      lastSuccessAt: "2026-08-06T00:01:00Z",
      consecutiveFailures: 0,
      lastError: null,
      lastSyncedAt: "2026-08-06T00:01:00Z",
      nextScheduledAt: null,
    }),
    createApiChannelAccount: h.createApiChannelAccount,
    storeCredential: h.storeCredential,
    testConnection: h.testConnection,
    manualSync: h.manualSync,
  },
}));

import { ConnectCoupang } from "./ConnectCoupang";

function acct(overrides: Partial<SellerAccountResponse> = {}): SellerAccountResponse {
  return {
    id: "acc-new",
    channelId: "coupang-ch",
    channelNameKo: "쿠팡",
    alias: null,
    connectionStatus: "PENDING",
    lastSyncedAt: null,
    fileUpload: false,
    ...overrides,
  };
}

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

// A brand-new seller now lands on the agent-driven WING issuance walkthrough FIRST. The credential-entry
// flow these tests exercise begins after issuance — the seller either completes the guided walk or (here)
// clicks the "이미 키가 있어요" skip to jump straight to credential entry. No account is created by skipping.
async function skipIssuance(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "이미 키가 있어요" }));
}

describe("ConnectCoupang tutorial", () => {
  beforeEach(() => {
    h.advertisedEgressIps = ["203.0.113.20"];
    h.accounts = [];
    h.connectionInfo = null;
    h.runs = [];
    h.connStatusState = "CONNECTED";
    h.testResult = {
      sellerAccountId: "acc-new",
      status: "SUCCESS",
      checkedAt: "2026-08-06T00:00:00Z",
      message: "연결 정보가 확인되었습니다.",
      reasonCode: null,
    };
    h.syncRun = run({ status: "SUCCESS" });
    navigateSpy.mockClear();
    h.createApiChannelAccount.mockClear();
    h.storeCredential.mockClear();
    h.testConnection.mockClear();
    h.manualSync.mockClear();
    h.getSyncRuns.mockClear();
  });

  it("a fresh seller lands on the WING issuance walkthrough FIRST (not the credential prereqs)", async () => {
    renderPage();
    // The agent-driven issuance start gate — before any credential entry, and creating no account.
    expect(await screen.findByRole("button", { name: "쿠팡 연결 안내 시작" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이미 키가 있어요" })).toBeInTheDocument();
    expect(screen.queryByTestId("coupang-prereqs")).toBeNull();
    expect(h.createApiChannelAccount).not.toHaveBeenCalled();
  });

  it("shows the prerequisites, the 6-step stepper, and the advertised IP after issuance; a load creates no account", async () => {
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    expect(await screen.findByTestId("coupang-prereqs")).toBeInTheDocument();
    expect(screen.getByTestId("coupang-stepper")).toBeInTheDocument();
    expect(await screen.findByText("203.0.113.20")).toBeInTheDocument();
    expect(h.createApiChannelAccount).not.toHaveBeenCalled();
  });

  it("shows the 'not yet advertised' guidance (never a fabricated IP) when no IP is configured", async () => {
    h.advertisedEgressIps = [];
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    expect(await screen.findByTestId("coupang-prereqs")).toBeInTheDocument();
    expect(await screen.findByText(/아직 설정되지 않았습니다/)).toBeInTheDocument();
  });

  it("submit → lazy account-create → store → test lands on PREPARING (not completed), with an explicit CTA", async () => {
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    expect(await screen.findByTestId("coupang-preparing")).toBeInTheDocument();
    expect(h.createApiChannelAccount).toHaveBeenCalledWith("coupang-ch");
    expect(h.storeCredential).toHaveBeenCalledTimes(1);
    expect(h.storeCredential.mock.calls[0][1].secrets).toMatchObject({
      access_key: "AK-TEST",
      secret_key: "SK-SECRET",
      vendor_id: "A00012345",
    });
    expect(h.testConnection).toHaveBeenCalledWith("acc-new");
    // Honest two-signal: a passing test is NOT a completed connection, and NO sync auto-started.
    expect(screen.getByText(/첫 주문을 한 번 불러오면 연결이 완료됩니다/)).toBeInTheDocument();
    expect(h.manualSync).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "첫 주문 불러오기" })).toBeInTheDocument();
  });

  it("full offline E2E: connect → PREPARING → first sync → CONNECTED → Operations", async () => {
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    // PREPARING → the explicit first-sync CTA.
    const cta = await screen.findByRole("button", { name: "첫 주문 불러오기" });
    await user.click(cta);

    // First sync resolves SUCCESS synchronously (manualSync returns a terminal run) → CONNECTED.
    expect(await screen.findByTestId("coupang-connected")).toBeInTheDocument();
    expect(h.manualSync).toHaveBeenCalledWith("acc-new", "ORDER_SUMMARY");
    expect(h.manualSync).toHaveBeenCalledTimes(1);

    // Operations entry points.
    await user.click(screen.getByRole("button", { name: "주문 보러 가기" }));
    expect(navigateSpy).toHaveBeenCalledWith("/orders");
    await user.click(screen.getByRole("button", { name: "연결 상태·수집 기록 보기" }));
    expect(navigateSpy).toHaveBeenCalledWith("/connect/channels/acc-new");
  });

  it("refresh recovery: PREPARING account with no run → lands on the first-sync CTA (no re-trigger)", async () => {
    h.accounts = [acct({ connectionStatus: "PREPARING" })];
    h.connectionInfo = { connectorClass: "API", authType: "HMAC", tokenExpiresAt: null, lastRotatedAt: null, hasRefreshToken: false };
    h.runs = [];
    renderPage();
    expect(await screen.findByTestId("coupang-preparing")).toBeInTheDocument();
    expect(h.manualSync).not.toHaveBeenCalled();
  });

  it("refresh recovery: PREPARING with a RUNNING run → resumes observing, never re-triggers the sync", async () => {
    h.accounts = [acct({ connectionStatus: "PREPARING" })];
    h.connectionInfo = { connectorClass: "API", authType: "HMAC", tokenExpiresAt: null, lastRotatedAt: null, hasRefreshToken: false };
    h.runs = [run({ status: "RUNNING", finishedAt: null })];
    renderPage();
    expect(await screen.findByTestId("coupang-syncing")).toBeInTheDocument();
    expect(h.manualSync).not.toHaveBeenCalled();
  });

  it("refresh recovery: CONNECTED account → lands on the completed step", async () => {
    h.accounts = [acct({ connectionStatus: "CONNECTED" })];
    h.connectionInfo = { connectorClass: "API", authType: "HMAC", tokenExpiresAt: null, lastRotatedAt: null, hasRefreshToken: false };
    renderPage();
    expect(await screen.findByTestId("coupang-connected")).toBeInTheDocument();
    // Already-issued seller: the WING issuance walkthrough is skipped entirely (never shown).
    expect(screen.queryByRole("button", { name: "쿠팡 연결 안내 시작" })).toBeNull();
  });

  it("refresh recovery: credential on file but PENDING → recovery screen (re-verify / re-enter)", async () => {
    h.accounts = [acct({ connectionStatus: "PENDING" })];
    h.connectionInfo = { connectorClass: "API", authType: "HMAC", tokenExpiresAt: null, lastRotatedAt: null, hasRefreshToken: false };
    renderPage();
    expect(await screen.findByTestId("coupang-connect-error")).toBeInTheDocument();
    // Already-issued (credential on file): issuance is skipped — the recovery screen shows directly.
    expect(screen.queryByRole("button", { name: "쿠팡 연결 안내 시작" })).toBeNull();
    // Re-verify uses the stored credential — no secret re-entry required, no account re-create.
    expect(screen.getByRole("button", { name: "연결 다시 확인" })).toBeInTheDocument();
    expect(h.createApiChannelAccount).not.toHaveBeenCalled();
  });

  it("call-IP-mismatch failure shows the IP-registration recovery and can re-verify without re-entry", async () => {
    h.testResult = {
      sellerAccountId: "acc-new",
      status: "FAILED",
      checkedAt: "2026-08-06T00:00:00Z",
      message: "허용된 호출 환경(호출 IP)과 일치하지 않을 수 있습니다.",
      reasonCode: "CALL_ENVIRONMENT_MISMATCH",
    };
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    const banner = await screen.findByTestId("coupang-connect-error");
    expect(banner).toHaveTextContent(/허용된 호출 IP와 일치하지 않아요/);
    // The IP panel is shown (registration guidance) and re-verify reruns the test on the stored credential.
    expect(screen.getByRole("button", { name: /호출 IP를 확인했어요, 다시 확인/ })).toBeInTheDocument();

    h.testResult = { ...h.testResult, status: "SUCCESS", reasonCode: null };
    await user.click(screen.getByRole("button", { name: /호출 IP를 확인했어요, 다시 확인/ }));
    expect(await screen.findByTestId("coupang-preparing")).toBeInTheDocument();
    // Re-verify did NOT create a second account or re-store the secret.
    expect(h.createApiChannelAccount).toHaveBeenCalledTimes(1);
    expect(h.storeCredential).toHaveBeenCalledTimes(1);
  });

  it("invalid-credential failure offers re-entering the key", async () => {
    h.testResult = {
      sellerAccountId: "acc-new",
      status: "FAILED",
      checkedAt: "2026-08-06T00:00:00Z",
      message: "연결 정보가 올바르지 않습니다.",
      reasonCode: "INVALID_CREDENTIAL",
    };
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    const banner = await screen.findByTestId("coupang-connect-error");
    expect(banner).toHaveTextContent(/연결 정보가 올바르지 않아요/);
    await user.click(screen.getByRole("button", { name: "연결 정보 다시 입력" }));
    // Back to the form.
    expect(await screen.findByTestId("coupang-prereqs")).toBeInTheDocument();
  });

  it("never surfaces the internal returnShippingCenters/ordersheets fallback or a raw 400", async () => {
    h.testResult = {
      sellerAccountId: "acc-new",
      status: "FAILED",
      checkedAt: "2026-08-06T00:00:00Z",
      message: "연결을 확인하지 못했습니다.",
      reasonCode: "PROVIDER_UNAVAILABLE",
    };
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    await screen.findByTestId("coupang-connect-error");
    expect(document.body.textContent).not.toMatch(/returnShippingCenter|ordersheet/i);
    expect(document.body.textContent).not.toMatch(/\b400\b/);
  });

  it("first-sync FAILED shows a retry that fires exactly one new run", async () => {
    h.syncRun = run({ status: "FAILED", successRows: 0, failedRows: 3 });
    const user = userEvent.setup();
    renderPage();
    await skipIssuance(user);
    await screen.findByTestId("coupang-prereqs");
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    await user.click(await screen.findByRole("button", { name: "첫 주문 불러오기" }));

    expect(await screen.findByTestId("coupang-sync-error")).toBeInTheDocument();
    expect(h.manualSync).toHaveBeenCalledTimes(1);

    h.syncRun = run({ status: "SUCCESS" });
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByTestId("coupang-connected")).toBeInTheDocument();
    expect(h.manualSync).toHaveBeenCalledTimes(2);
  });
});

// The RUNNING → poll → terminal path and the stall timeout use real intervals, so these drive them with
// fake timers. `advanceTimersByTimeAsync` flushes the async interval callback's awaited run-list reads.
describe("ConnectCoupang tutorial — async polling (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.advertisedEgressIps = ["203.0.113.20"];
    h.connectionInfo = { connectorClass: "API", authType: "HMAC", tokenExpiresAt: null, lastRotatedAt: null, hasRefreshToken: false };
    h.connStatusState = "CONNECTED";
    navigateSpy.mockClear();
    h.manualSync.mockClear();
    h.getSyncRuns.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("resumes a RUNNING sync and completes when the poller observes SUCCESS (never re-triggers)", async () => {
    h.accounts = [acct({ connectionStatus: "PREPARING" })];
    h.runs = [run({ status: "RUNNING", finishedAt: null, startedAt: "2026-08-06T00:00:00Z" })];
    renderPage();
    await flush();
    expect(screen.getByTestId("coupang-syncing")).toBeInTheDocument();
    expect(h.manualSync).not.toHaveBeenCalled();

    // Server settles the run → the next poll tick (5s) reads SUCCESS and completes.
    h.runs = [run({ status: "SUCCESS" })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId("coupang-connected")).toBeInTheDocument();
    expect(h.manualSync).not.toHaveBeenCalled(); // observed only — never a re-trigger
  });

  it("keeps observing (no completion, no re-trigger) while the poller still reads RUNNING", async () => {
    h.accounts = [acct({ connectionStatus: "PREPARING" })];
    h.runs = [run({ status: "RUNNING", finishedAt: null, startedAt: "2026-08-06T00:00:00Z" })];
    renderPage();
    await flush();
    expect(screen.getByTestId("coupang-syncing")).toBeInTheDocument();

    // Several poll ticks with the run still RUNNING → stays on the progress screen, never completes/fails.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByTestId("coupang-syncing")).toBeInTheDocument();
    expect(screen.queryByTestId("coupang-connected")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupang-sync-error")).not.toBeInTheDocument();
    expect(h.manualSync).not.toHaveBeenCalled();
  });
});
