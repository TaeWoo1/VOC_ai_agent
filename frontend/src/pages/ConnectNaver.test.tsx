// @vitest-environment jsdom
// ConnectNaver page integration: proves the wiring the unit tests can't — the saved-credential check,
// the browser gate, the three-path fork, and the imperative register→test→sync chain, all against a real
// (mocked) backend boundary. Also pins that the Client Secret reaches ONLY api.storeCredential.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { screen, userEvent, waitFor } from "../test/renderWithRouter";
import { NAVER_LIKE_TEMPLATE } from "../lib/guidedConnection";
import type { BridgeState } from "../lib/bridge/bridgeClient";
import type { BridgeConnectionState, BridgeConnectionView, BridgePendingUserAction } from "../lib/bridge/bridgeProtocol";
import type { ConnectionInfoView, SyncRunView } from "../lib/types";

// Configurable bridge state so tests can drive the live-detection source (B4). Default: paired with no
// snapshot → detection unavailable → attestation fallback (the pre-B4-wiring behavior).
const DEFAULT_BRIDGE: BridgeState = { phase: "paired", maybeNeedsLocalNetworkAccess: false };
const h = vi.hoisted(() => ({ bridge: { phase: "paired", maybeNeedsLocalNetworkAccess: false } as BridgeState }));
vi.mock("../hooks/useBridge", () => ({
  useBridge: () => ({ state: h.bridge, requestPairing: () => {}, revoke: () => {}, retry: () => {} }),
}));

/** Build a paired bridge state carrying one connection with the given session state. */
function pairedWith(state: BridgeConnectionState, pendingUserAction: BridgePendingUserAction | null = null): BridgeState {
  const conn: BridgeConnectionView = { ref: "opaque", state, pendingUserAction, browserOpen: false };
  return {
    phase: "paired",
    maybeNeedsLocalNetworkAccess: false,
    snapshot: { agentVersion: "x", protocolVersion: 1, capabilities: [], supportedEvents: [], connections: [conn] },
  };
}

vi.mock("../lib/apiClient", () => ({
  api: {
    getChannelsStrict: vi.fn(),
    getSellerAccountsStrict: vi.fn(),
    getCredentialTemplateStrict: vi.fn(),
    getConnectionInfoStrict: vi.fn(),
    createApiChannelAccount: vi.fn(),
    getConnectionStatusStrict: vi.fn(),
    storeCredential: vi.fn(),
    testConnection: vi.fn(),
    manualSync: vi.fn(),
  },
}));

import { api } from "../lib/apiClient";
import { ConnectNaver } from "./ConnectNaver";

const SECRET = "n4ver-client-secret";
/** A masked saved-credential view (never a secret) — its mere presence means "a key is on file". */
const SAVED_INFO: ConnectionInfoView = {
  connectorClass: "NaverApiConnector", authType: "API_KEY", tokenExpiresAt: null, lastRotatedAt: null, hasRefreshToken: false,
};

const syncRun = (accountId: string, over: Partial<SyncRunView> = {}): SyncRunView => ({
  id: "run", sellerAccountId: accountId, channelId: "ch-naver", dataType: "ORDER_SUMMARY", trigger: "MANUAL",
  attempt: 1, rateLimited: false, nextRetryAt: null, jobType: "SYNC", uploadType: null, status: "SUCCESS",
  totalRows: 0, successRows: 0, skippedRows: 0, failedRows: 0, errorMessage: null, startedAt: null, finishedAt: null,
  ...over,
});

/** Mock a passing test + a (0-row) successful sync for the given account. */
function mockTestAndSyncSuccess(accountId = "acc-1") {
  vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: accountId, status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
  vi.mocked(api.manualSync).mockResolvedValue(syncRun(accountId));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.bridge = DEFAULT_BRIDGE; // reset to detection-unavailable (attestation fallback) each test
  vi.mocked(api.getChannelsStrict).mockResolvedValue([
    { id: "ch-naver", code: "NAVER", nameKo: "네이버", status: "AVAILABLE", dataBadges: [], lastSyncedAt: null, actionLabel: "연결하기", support: {} as never },
  ]);
  vi.mocked(api.getSellerAccountsStrict).mockResolvedValue([
    { id: "acc-1", channelId: "ch-naver", channelNameKo: "네이버", alias: null, connectionStatus: "PENDING", lastSyncedAt: null, fileUpload: false },
  ]);
  vi.mocked(api.getCredentialTemplateStrict).mockResolvedValue(NAVER_LIKE_TEMPLATE);
  vi.mocked(api.getConnectionInfoStrict).mockResolvedValue(null); // default: no saved key → gate + fork path
  vi.mocked(api.storeCredential).mockResolvedValue(undefined);
  vi.mocked(api.getConnectionStatusStrict).mockResolvedValue({
    sellerAccountId: "acc-1", state: "CONNECTED", lastSuccessAt: null,
    consecutiveFailures: 0, lastError: null, lastSyncedAt: null, nextScheduledAt: null,
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connect/naver"]}>
      <ConnectNaver />
    </MemoryRouter>,
  );
}

// Shared step helpers for the new-app path (login → path fork "new" → app-absence check → issuance →
// credential entry). Choosing "new" now first routes through the app-absence check (one app per store,
// no delete): the seller confirms the store has no app before issuance can proceed.
async function loginThenNewApp() {
  await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
  await userEvent.click(await screen.findByRole("button", { name: "처음 발급할게요" }));
  await userEvent.click(await screen.findByRole("button", { name: "애플리케이션이 없어요" }));
  await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
  await userEvent.click(await screen.findByRole("button", { name: "발급을 완료했어요" }));
  await userEvent.click(await screen.findByRole("button", { name: /발급된 정보를 입력/ }));
}
async function enterCredentials(secret = SECRET) {
  await userEvent.type(await screen.findByLabelText(/Client ID/), "app-id-1");
  await userEvent.type(screen.getByLabelText(/Client Secret/), secret);
  await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));
}

describe("ConnectNaver — new-app journey (offline, mocked backend)", () => {
  it("walks saved-check → gate → path 'new' → issuance → credentials → test → sync → completed", async () => {
    mockTestAndSyncSuccess();
    renderPage();
    await loginThenNewApp();
    await enterCredentials();

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
    vi.mocked(api.manualSync).mockResolvedValue(syncRun("acc-1", { totalRows: 0, successRows: 0 }));
    renderPage();
    await loginThenNewApp();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
  });

  it("an invalid credential bounces back to the entry step, not completion", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "FAILED", checkedAt: "", message: "", reasonCode: "INVALID_CREDENTIAL" });
    renderPage();
    await loginThenNewApp();
    await enterCredentials("wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(/연결 정보가 올바르지 않/);
    expect(screen.getByRole("heading", { name: "연결 정보 입력" })).toBeInTheDocument();
    expect(api.manualSync).not.toHaveBeenCalled();
  });

  it("never persists the Client Secret to localStorage", async () => {
    mockTestAndSyncSuccess();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPage();
    await loginThenNewApp();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    await waitFor(() => {
      for (const call of setItem.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
    });
  });
});

describe("ConnectNaver — reuse an existing connection / application (§discovery)", () => {
  it("saved key success: a stored credential reuses the app with NO login, NO path choice, NO re-entry", async () => {
    vi.mocked(api.getConnectionInfoStrict).mockResolvedValue(SAVED_INFO); // a key is on file
    mockTestAndSyncSuccess();
    renderPage();
    // Straight to completed — never shown the login attest or the path fork.
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(api.testConnection).toHaveBeenCalledWith("acc-1");
    expect(screen.queryByRole("button", { name: "로그인했어요" })).toBeNull();
    expect(screen.queryByRole("button", { name: "처음 발급할게요" })).toBeNull();
    expect(api.storeCredential).not.toHaveBeenCalled(); // reuse — nothing re-registered
  });

  it("saved-credential read error fails closed to the gate — never a false reuse", async () => {
    vi.mocked(api.getConnectionInfoStrict).mockRejectedValue(new Error("network"));
    renderPage();
    // Falls through to the browser gate (attest login), and NEVER runs a connection test on an unconfirmed key.
    expect(await screen.findByRole("button", { name: "로그인했어요" })).toBeInTheDocument();
    expect(api.testConnection).not.toHaveBeenCalled();
  });

  it("saved key failure: an invalid stored key drops to existing-credential entry (reuse the app, re-enter the key)", async () => {
    vi.mocked(api.getConnectionInfoStrict).mockResolvedValue(SAVED_INFO);
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "FAILED", checkedAt: "", message: "", reasonCode: "INVALID_CREDENTIAL" });
    renderPage();
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
    expect(api.manualSync).not.toHaveBeenCalled();
  });

  it("existing app, no stored key: 'have' → enter the existing key → completed (never a new app)", async () => {
    mockTestAndSyncSuccess();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "이미 애플리케이션이 있어요" }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    // Issuance guidance was never shown — an existing-app seller is not nudged into a second app.
    expect(screen.queryByRole("button", { name: "발급을 완료했어요" })).toBeNull();
  });

  it("unsure: 'unknown' → self-check NAVER's list → 'found' → existing-credential entry", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "있는지 잘 모르겠어요" }));
    expect(await screen.findByRole("heading", { name: "애플리케이션 목록 확인" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /찾았어요/ }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
  });
});

describe("ConnectNaver — credential recovery when the Secret is lost (§flow 4) — reissue, never delete", () => {
  it("Secret lost: existing entry → 'secret not found' → recovery (never a forced new app)", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "이미 애플리케이션이 있어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "시크릿을 찾지 못했어요" }));
    expect(await screen.findByRole("heading", { name: "시크릿 재확인 필요" })).toBeInTheDocument();
  });

  it("recovery offers NO app-delete; re-obtaining the Secret (re-view/reissue) returns to existing entry", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "이미 애플리케이션이 있어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "시크릿을 찾지 못했어요" }));
    expect(await screen.findByRole("heading", { name: "시크릿 재확인 필요" })).toBeInTheDocument();
    // No delete-then-reissue affordance exists — NAVER provides no app delete.
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "시크릿을 다시 확인했거나 재발급했어요" }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
  });
});

describe("ConnectNaver — connection start creates the account when a first-time seller has none", () => {
  it("creates the PENDING API account, then registers against the created id", async () => {
    vi.mocked(api.getSellerAccountsStrict).mockResolvedValue([]); // no NAVER account yet
    vi.mocked(api.createApiChannelAccount).mockResolvedValue({
      id: "acc-new", channelId: "ch-naver", channelNameKo: "네이버", alias: "네이버",
      connectionStatus: "PENDING", lastSyncedAt: null, fileUpload: false,
    });
    mockTestAndSyncSuccess("acc-new");
    renderPage();
    await loginThenNewApp();
    await enterCredentials();

    await screen.findByRole("heading", { name: "주문 연결 완료" });
    expect(api.createApiChannelAccount).toHaveBeenCalledWith("ch-naver");
    // Registers against the CREATED account id, carrying the secret only in the storeCredential payload.
    expect(api.storeCredential).toHaveBeenCalledWith("acc-new", {
      connectorClass: NAVER_LIKE_TEMPLATE.connectorClass,
      authType: NAVER_LIKE_TEMPLATE.authType,
      secrets: { client_id: "app-id-1", client_secret: SECRET },
    });
  });

  it("does NOT create when an API account already exists (idempotent entry)", async () => {
    renderPage();
    await screen.findByRole("button", { name: "로그인했어요" });
    expect(api.createApiChannelAccount).not.toHaveBeenCalled();
  });
});

describe("ConnectNaver — completion surfaces connection health + review handoff", () => {
  it("shows the connection state and last successful collection time on completion", async () => {
    mockTestAndSyncSuccess();
    vi.mocked(api.getConnectionStatusStrict).mockResolvedValue({
      sellerAccountId: "acc-1", state: "CONNECTED",
      lastSuccessAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      consecutiveFailures: 0, lastError: null, lastSyncedAt: null, nextScheduledAt: null,
    });
    renderPage();
    await loginThenNewApp();
    await enterCredentials();
    expect(await screen.findByText("정상 수집 중")).toBeInTheDocument();
    expect(screen.getByText(/마지막 성공 수집: .*분 전/)).toBeInTheDocument();
  });

  it("the review CTA hands off to the past-review-import screen (not in-wizard collection)", async () => {
    mockTestAndSyncSuccess();
    render(
      <MemoryRouter initialEntries={["/connect/naver"]}>
        <Routes>
          <Route path="/connect/naver" element={<ConnectNaver />} />
          <Route path="/settings/review-import" element={<div>과거 리뷰 가져오기 화면</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await loginThenNewApp();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    await userEvent.click(screen.getByRole("button", { name: "과거 리뷰 가져오기로 이동" }));
    await userEvent.click(await screen.findByRole("button", { name: "리뷰 내보내기로 이동" }));
    expect(await screen.findByText("과거 리뷰 가져오기 화면")).toBeInTheDocument();
  });
});

describe("ConnectNaver — live session detection wiring (B4)", () => {
  it("detected ready drives readiness forward WITHOUT attestation → the path fork", async () => {
    h.bridge = pairedWith("ready");
    renderPage();
    // No "로그인했어요" step needed — a detected live session advances straight to the path fork.
    expect(await screen.findByRole("button", { name: "처음 발급할게요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인했어요" })).toBeNull();
  });

  it("detected reconnect drives naver_reconnect_required — attestation is not even offered", async () => {
    h.bridge = pairedWith("human_reconnect_required");
    renderPage();
    expect(await screen.findByRole("heading", { name: "다시 로그인 필요" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인 후 다시 확인" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인했어요" })).toBeNull();
  });

  it("attestation fallback works when detection is unavailable (no snapshot)", async () => {
    h.bridge = DEFAULT_BRIDGE;
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "로그인했어요" }));
    expect(await screen.findByRole("button", { name: "처음 발급할게요" })).toBeInTheDocument();
  });

  it("indeterminate detection stays neutral → attestation fallback (does not force-fail)", async () => {
    h.bridge = pairedWith("starting");
    renderPage();
    expect(await screen.findByRole("button", { name: "로그인했어요" })).toBeInTheDocument();
  });
});
