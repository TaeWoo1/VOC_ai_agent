// @vitest-environment jsdom
// ConnectNaver page integration: proves the wiring the unit tests can't — the read-only capability resume,
// the (Local-Agent-free) three-path fork, and the imperative register→test→sync chain, all against a real
// (mocked) backend boundary. Pins: the Client Secret reaches ONLY api.storeCredential; the order connection
// completes with NO Local Agent; the bridge affects only REVIEW_IMPORT; and — critically — a page load
// (refresh / re-entry) is READ-ONLY: it NEVER re-runs the connection test or the first sync.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { screen, userEvent, waitFor } from "../test/renderWithRouter";
import { NAVER_LIKE_TEMPLATE } from "../lib/guidedConnection";
import type { BridgeState } from "../lib/bridge/bridgeClient";
import type { ConnectionCapabilityView, SyncRunView } from "../lib/types";

// Configurable bridge state. The bridge NEVER gates the order connection; it only feeds the post-completion
// REVIEW_IMPORT capability. Default: unreachable (no agent) → the order flow must still complete.
const AGENT_DOWN: BridgeState = { phase: "unreachable", maybeNeedsLocalNetworkAccess: false };
const AGENT_PAIRED: BridgeState = { phase: "paired", maybeNeedsLocalNetworkAccess: false };
const h = vi.hoisted(() => ({ bridge: { phase: "unreachable", maybeNeedsLocalNetworkAccess: false } as BridgeState }));
vi.mock("../hooks/useBridge", () => ({
  useBridge: () => ({ state: h.bridge, requestPairing: () => {}, revoke: () => {}, retry: () => {} }),
}));

vi.mock("../lib/apiClient", () => ({
  api: {
    getChannelsStrict: vi.fn(),
    getSellerAccountsStrict: vi.fn(),
    getCredentialTemplateStrict: vi.fn(),
    createApiChannelAccount: vi.fn(),
    getConnectionStatusStrict: vi.fn(),
    storeCredential: vi.fn(),
    testConnection: vi.fn(),
    manualSync: vi.fn(),
    getConnectionCapabilityStrict: vi.fn(),
  },
}));

import { api } from "../lib/apiClient";
import { ConnectNaver } from "./ConnectNaver";

const SECRET = "n4ver-client-secret";

const syncRun = (accountId: string, over: Partial<SyncRunView> = {}): SyncRunView => ({
  id: "run", sellerAccountId: accountId, channelId: "ch-naver", dataType: "ORDER_SUMMARY", trigger: "MANUAL",
  attempt: 1, rateLimited: false, nextRetryAt: null, jobType: "SYNC", uploadType: null, status: "SUCCESS",
  totalRows: 0, successRows: 0, skippedRows: 0, failedRows: 0, errorMessage: null, startedAt: null, finishedAt: null,
  ...over,
});

function mockTestAndSyncSuccess(accountId = "acc-1") {
  vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: accountId, status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
  vi.mocked(api.manualSync).mockResolvedValue(syncRun(accountId));
}

/** A COMPLETED capability snapshot (a prior first sync succeeded) — drives resume-to-completed + the panel. */
function capabilityView(accountId = "acc-1", over: Partial<ConnectionCapabilityView> = {}): ConnectionCapabilityView {
  return {
    sellerAccountId: accountId,
    channelCode: "NAVER",
    connectionStatus: "CONNECTED",
    credentialPresent: true,
    identityConfirmed: true,
    firstSyncStatus: "SUCCESS",
    overall: "AVAILABLE",
    reason: null,
    features: [
      { feature: "ORDER_READ", state: "AVAILABLE", label: "주문 조회", reason: null },
      { feature: "REVIEW_IMPORT", state: "GUIDED_CONFIRMATION", label: "리뷰 가져오기 (작업 창에서 직접 내보내기)", reason: "GUIDED_EXPORT_ONLY" },
      { feature: "REVIEW_REPLY", state: "NOT_ENABLED", label: "리뷰 답변 (자동 전송 없음 · 미검증)", reason: "REPLY_UNVERIFIED" },
      { feature: "INQUIRY_READ", state: "INTEGRATION_PENDING", label: "문의 조회 (연동 준비 중)", reason: "INTEGRATION_PENDING" },
    ],
    ...over,
  };
}
/** A FRESH snapshot: no credential yet → resume lands on the three-path fork. */
const freshCapability = (accountId = "acc-1") =>
  capabilityView(accountId, { credentialPresent: false, identityConfirmed: false, firstSyncStatus: "NONE", overall: "NEEDS_ATTENTION", reason: "CREDENTIAL_MISSING" });
/** A stored key that never completed → resume lands on the connection test as a user CTA. */
const savedKeyIncompleteCapability = (accountId = "acc-1") =>
  capabilityView(accountId, { credentialPresent: true, identityConfirmed: false, firstSyncStatus: "NONE", overall: "NEEDS_ATTENTION", reason: "FIRST_SYNC_REQUIRED" });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.bridge = AGENT_DOWN; // default: NO local agent — the order flow must still complete
  vi.mocked(api.getChannelsStrict).mockResolvedValue([
    { id: "ch-naver", code: "NAVER", nameKo: "네이버", status: "AVAILABLE", dataBadges: [], lastSyncedAt: null, actionLabel: "연결하기", support: {} as never },
  ]);
  vi.mocked(api.getSellerAccountsStrict).mockResolvedValue([
    { id: "acc-1", channelId: "ch-naver", channelNameKo: "네이버", alias: null, connectionStatus: "PENDING", lastSyncedAt: null, fileUpload: false },
  ]);
  vi.mocked(api.getCredentialTemplateStrict).mockResolvedValue(NAVER_LIKE_TEMPLATE);
  vi.mocked(api.storeCredential).mockResolvedValue(undefined);
  vi.mocked(api.getConnectionStatusStrict).mockResolvedValue({
    sellerAccountId: "acc-1", state: "CONNECTED", lastSuccessAt: null,
    consecutiveFailures: 0, lastError: null, lastSyncedAt: null, nextScheduledAt: null,
  });
  // Default: a fresh account → mount resumes to the fork.
  vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(freshCapability());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connect/naver"]}>
      <ConnectNaver />
    </MemoryRouter>,
  );
}

// New-app path with NO login/agent step: fork "new" → app-absence check → issuance tutorial → entry.
async function newAppPath() {
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

describe("ConnectNaver — Local-Agent-free order connection", () => {
  it("with the local agent DOWN, the whole order connection still completes (no readiness gate)", async () => {
    h.bridge = AGENT_DOWN;
    mockTestAndSyncSuccess();
    renderPage();
    expect(await screen.findByRole("button", { name: "처음 발급할게요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인했어요" })).toBeNull();
    await newAppPath();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(api.storeCredential).toHaveBeenCalledWith("acc-1", {
      connectorClass: NAVER_LIKE_TEMPLATE.connectorClass,
      authType: NAVER_LIKE_TEMPLATE.authType,
      secrets: { client_id: "app-id-1", client_secret: SECRET },
    });
    expect(api.testConnection).toHaveBeenCalledTimes(1);
    expect(api.manualSync).toHaveBeenCalledTimes(1); // exactly one test + one first sync
  });

  it("with the bridge feature flag OFF, the order connection still completes and review shows SETUP_REQUIRED", async () => {
    h.bridge = AGENT_PAIRED; // even a paired client cannot matter while the surface flag is off
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValueOnce(freshCapability()).mockResolvedValue(capabilityView());
    mockTestAndSyncSuccess();
    renderPage();
    await newAppPath();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    const panel = await screen.findByRole("status", { name: "연결 역량 결과" });
    expect(panel).toHaveTextContent("설정 필요"); // REVIEW_IMPORT SETUP_REQUIRED (agent not usable)
  });

  it("a 0-row first sync still completes (SUCCESS with no new orders ≠ failure)", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
    vi.mocked(api.manualSync).mockResolvedValue(syncRun("acc-1", { totalRows: 0, successRows: 0 }));
    renderPage();
    await newAppPath();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
  });

  it("an invalid credential bounces back to the entry step, not completion", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "FAILED", checkedAt: "", message: "", reasonCode: "INVALID_CREDENTIAL" });
    renderPage();
    await newAppPath();
    await enterCredentials("wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent(/연결 정보가 올바르지 않/);
    expect(screen.getByRole("heading", { name: "연결 정보 입력" })).toBeInTheDocument();
    expect(api.manualSync).not.toHaveBeenCalled();
  });

  it("never persists the Client Secret to localStorage", async () => {
    mockTestAndSyncSuccess();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPage();
    await newAppPath();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    await waitFor(() => {
      for (const call of setItem.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
    });
  });
});

describe("ConnectNaver — page load / refresh is READ-ONLY (no test/sync re-run)", () => {
  it("completed re-entry: capability shows a prior sync → restore completed with ZERO external calls", async () => {
    // The exact L4 fix: a refresh after completion must mint no token, call no order API, create no sync.
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(capabilityView());
    renderPage();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    // Panel restored read-only from capability.
    expect(await screen.findByRole("status", { name: "연결 역량 결과" })).toHaveTextContent("자격 증명 인증됨");
    expect(api.testConnection).not.toHaveBeenCalled();
    expect(api.manualSync).not.toHaveBeenCalled();
    expect(api.storeCredential).not.toHaveBeenCalled();
  });

  it("stored key but never completed → connection-test CTA, NO auto test/sync until the seller clicks", async () => {
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(savedKeyIncompleteCapability());
    mockTestAndSyncSuccess();
    renderPage();
    // Lands on the test step as a CTA — nothing auto-ran on load.
    expect(await screen.findByRole("button", { name: "연결 확인" })).toBeInTheDocument();
    expect(api.testConnection).not.toHaveBeenCalled();
    expect(api.manualSync).not.toHaveBeenCalled();
    // The seller triggers it explicitly → one test + one sync → completed.
    await userEvent.click(screen.getByRole("button", { name: "연결 확인" }));
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(api.testConnection).toHaveBeenCalledTimes(1);
    expect(api.manualSync).toHaveBeenCalledTimes(1);
  });

  it("stored key incomplete + verify fails (invalid) → existing-credential entry (reuse the app, re-enter)", async () => {
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(savedKeyIncompleteCapability());
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "FAILED", checkedAt: "", message: "", reasonCode: "INVALID_CREDENTIAL" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "연결 확인" }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
    expect(api.manualSync).not.toHaveBeenCalled();
  });

  it("capability read fails on load → fail-safe to the fork; never a false completion, never an auto-sync", async () => {
    vi.mocked(api.getConnectionCapabilityStrict).mockRejectedValue(new Error("backend down"));
    renderPage();
    expect(await screen.findByRole("button", { name: "처음 발급할게요" })).toBeInTheDocument();
    expect(api.testConnection).not.toHaveBeenCalled();
    expect(api.manualSync).not.toHaveBeenCalled();
  });
});

describe("ConnectNaver — API issuance tutorial", () => {
  it("shows the step-by-step tutorial and opens the official center in a NEW TAB (no auto-click)", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "처음 발급할게요" }));
    await userEvent.click(await screen.findByRole("button", { name: "애플리케이션이 없어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
    expect(await screen.findByRole("heading", { name: "애플리케이션 발급" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(3);

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await userEvent.click(screen.getByRole("button", { name: /API 센터 열기/ }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("commerce.naver.com"), "_blank", "noopener,noreferrer");
    expect(screen.getByRole("heading", { name: "애플리케이션 발급" })).toBeInTheDocument(); // checklist still on screen
    openSpy.mockRestore();
  });
});

describe("ConnectNaver — reuse an existing connection / application (§discovery)", () => {
  it("existing app, no stored key: 'have' → enter the existing key → completed (never a new app)", async () => {
    mockTestAndSyncSuccess();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "이미 애플리케이션이 있어요" }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
    expect(screen.getByText("기존 앱에서 어디를 확인하나요?")).toBeInTheDocument();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "발급을 완료했어요" })).toBeNull();
  });

  it("unsure: 'unknown' → self-check NAVER's list → 'found' → existing-credential entry", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "있는지 잘 모르겠어요" }));
    expect(await screen.findByRole("heading", { name: "애플리케이션 목록 확인" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /찾았어요/ }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
  });
});

describe("ConnectNaver — credential recovery when the Secret is lost (§flow 4) — reissue, never delete", () => {
  it("Secret lost: existing entry → 'secret not found' → recovery (never a forced new app)", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "이미 애플리케이션이 있어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "시크릿을 찾지 못했어요" }));
    expect(await screen.findByRole("heading", { name: "시크릿 재확인 필요" })).toBeInTheDocument();
  });

  it("recovery offers NO app-delete; re-obtaining the Secret returns to existing entry", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "이미 애플리케이션이 있어요" }));
    await userEvent.click(await screen.findByRole("button", { name: "시크릿을 찾지 못했어요" }));
    expect(await screen.findByRole("heading", { name: "시크릿 재확인 필요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "시크릿을 다시 확인했거나 재발급했어요" }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
  });
});

describe("ConnectNaver — connection start creates the account when a first-time seller has none", () => {
  it("creates the PENDING API account, then registers against the created id", async () => {
    vi.mocked(api.getSellerAccountsStrict).mockResolvedValue([]);
    vi.mocked(api.createApiChannelAccount).mockResolvedValue({
      id: "acc-new", channelId: "ch-naver", channelNameKo: "네이버", alias: "네이버",
      connectionStatus: "PENDING", lastSyncedAt: null, fileUpload: false,
    });
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(freshCapability("acc-new"));
    mockTestAndSyncSuccess("acc-new");
    renderPage();
    await newAppPath();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    expect(api.createApiChannelAccount).toHaveBeenCalledWith("ch-naver");
    expect(api.storeCredential).toHaveBeenCalledWith("acc-new", {
      connectorClass: NAVER_LIKE_TEMPLATE.connectorClass,
      authType: NAVER_LIKE_TEMPLATE.authType,
      secrets: { client_id: "app-id-1", client_secret: SECRET },
    });
  });

  it("does NOT create when an API account already exists (idempotent entry)", async () => {
    renderPage();
    await screen.findByRole("button", { name: "처음 발급할게요" });
    expect(api.createApiChannelAccount).not.toHaveBeenCalled();
  });
});

describe("ConnectNaver — completion surfaces capability + review handoff", () => {
  it("shows the connection state and last successful collection time on completion", async () => {
    mockTestAndSyncSuccess();
    vi.mocked(api.getConnectionStatusStrict).mockResolvedValue({
      sellerAccountId: "acc-1", state: "CONNECTED",
      lastSuccessAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      consecutiveFailures: 0, lastError: null, lastSyncedAt: null, nextScheduledAt: null,
    });
    renderPage();
    await newAppPath();
    await enterCredentials();
    expect(await screen.findByText("정상 수집 중")).toBeInTheDocument();
    expect(screen.getByText(/마지막 성공 수집: .*분 전/)).toBeInTheDocument();
  });

  it("the review-setup CTA hands off to the past-review-import screen (not in-wizard collection)", async () => {
    mockTestAndSyncSuccess();
    render(
      <MemoryRouter initialEntries={["/connect/naver"]}>
        <Routes>
          <Route path="/connect/naver" element={<ConnectNaver />} />
          <Route path="/settings/review-import" element={<div>과거 리뷰 가져오기 화면</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await newAppPath();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    await userEvent.click(screen.getByRole("button", { name: "리뷰 가져오기 설정으로 이동" }));
    await userEvent.click(await screen.findByRole("button", { name: "리뷰 내보내기로 이동" }));
    expect(await screen.findByText("과거 리뷰 가져오기 화면")).toBeInTheDocument();
  });

  it("capability panel: order live, review guided (SETUP_REQUIRED with no agent), reply off, inquiry pending", async () => {
    h.bridge = AGENT_DOWN;
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValueOnce(freshCapability()).mockResolvedValue(capabilityView());
    mockTestAndSyncSuccess();
    renderPage();
    await newAppPath();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    const panel = await screen.findByRole("status", { name: "연결 역량 결과" });
    expect(panel).toHaveTextContent("자격 증명 인증됨");
    expect(panel).toHaveTextContent("주문 조회");
    expect(panel).toHaveTextContent("연결됨");
    expect(panel).toHaveTextContent("설정 필요");
    expect(panel).toHaveTextContent("미활성화");
    expect(panel).toHaveTextContent("연동 준비 중");
  });

  it("REVIEW_IMPORT flips to GUIDED_CONFIRMATION once the local agent is paired (bridge flag on)", async () => {
    vi.stubEnv("VITE_ENABLE_AGENT_BRIDGE", "true");
    h.bridge = AGENT_PAIRED;
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValueOnce(freshCapability()).mockResolvedValue(capabilityView());
    mockTestAndSyncSuccess();
    renderPage();
    await newAppPath();
    await enterCredentials();
    await screen.findByRole("heading", { name: "주문 연결 완료" });
    const panel = await screen.findByRole("status", { name: "연결 역량 결과" });
    expect(panel).toHaveTextContent("작업 창에서 직접 진행");
    expect(panel).not.toHaveTextContent("설정 필요");
  });

  it("completion stands even if the capability read fails (panel omitted, never a fake verified)", async () => {
    vi.mocked(api.getConnectionCapabilityStrict).mockRejectedValue(new Error("backend down"));
    mockTestAndSyncSuccess();
    renderPage();
    await newAppPath();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "연결 역량 결과" })).toBeNull();
  });
});

describe("ConnectNaver — connection test and first sync are separated (distinct failure causes)", () => {
  it("test SUCCESS but first sync FAILED stays at the sync step; NO auto-retry until the seller clicks", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
    vi.mocked(api.manualSync).mockResolvedValue(syncRun("acc-1", { status: "FAILED" }));
    renderPage();
    await newAppPath();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "첫 주문 수집 중" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "주문 연결 완료" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/첫 주문 수집에 실패/);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(api.testConnection).toHaveBeenCalledTimes(1);
    expect(api.manualSync).toHaveBeenCalledTimes(1); // the initial attempt only — no auto-retry
  });

  it("retrying only the first sync after a failure completes the connection", async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
    vi.mocked(api.manualSync)
      .mockResolvedValueOnce(syncRun("acc-1", { status: "FAILED" }))
      .mockResolvedValue(syncRun("acc-1", { status: "SUCCESS" }));
    renderPage();
    await newAppPath();
    await enterCredentials();
    await userEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(api.manualSync).toHaveBeenCalledTimes(2);
    expect(api.storeCredential).toHaveBeenCalledTimes(1); // credential NOT re-registered on a sync retry
  });
});

describe("ConnectNaver — refresh recovery (secret-free step restore)", () => {
  it("restores a mid-issuance step after a page refresh WITHOUT re-choice and WITHOUT a stored secret", async () => {
    const first = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "처음 발급할게요" }));
    await userEvent.click(await screen.findByRole("button", { name: "애플리케이션이 없어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
    expect(await screen.findByRole("heading", { name: "애플리케이션 발급" })).toBeInTheDocument();

    first.unmount();
    renderPage();

    expect(await screen.findByRole("heading", { name: "애플리케이션 발급" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "처음 발급할게요" })).toBeNull();
    const raw = sessionStorage.getItem("naver_guided_connection_v1")!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["path", "phase"]);
  });
});

describe("ConnectNaver — StrictMode double-invocation is safe", () => {
  it("completed resume under StrictMode restores exactly once, with no test/sync", async () => {
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(capabilityView());
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/connect/naver"]}>
          <ConnectNaver />
        </MemoryRouter>
      </StrictMode>,
    );
    const headings = await screen.findAllByRole("heading", { name: "주문 연결 완료" });
    expect(headings).toHaveLength(1);
    expect(api.testConnection).not.toHaveBeenCalled();
    expect(api.manualSync).not.toHaveBeenCalled();
  });
});
