// @vitest-environment jsdom
// ConnectNaver page integration: proves the wiring the unit tests can't — the read-only capability resume,
// the (Local-Agent-free) three-path fork, and the imperative register→test→sync chain, all against a real
// (mocked) backend boundary. Pins: the Client Secret reaches ONLY api.storeCredential; the order connection
// completes with NO Local Agent; the bridge affects only REVIEW_IMPORT; and — critically — a page load
// (refresh / re-entry) is READ-ONLY: it NEVER re-runs the connection test or the first sync.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
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

// Stub the guided walkthrough (its live pairing/host/branch internals are covered by its own suite). Here it
// exposes drivers so the PAGE flow can be exercised: the runtime-observed branch + completion, and the
// failure-only text fallback. This is what makes guided-first testable at the page level without a live agent.
vi.mock("../components/guidedConnection/NaverIssuanceGuidedWalkthrough", () => ({
  NaverIssuanceGuidedWalkthrough: ({ dispatch }: { dispatch: (e: { type: string; branch?: string; mode?: string }) => void }) => (
    <div data-testid="guided-walkthrough-stub">
      <button
        type="button"
        onClick={() => {
          dispatch({ type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "existing" });
          dispatch({ type: "ISSUANCE_COMPLETE" });
        }}
      >
        stub: 기존앱 안내 완료
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "new" });
          dispatch({ type: "ISSUANCE_COMPLETE" });
        }}
      >
        stub: 신규앱 안내 완료
      </button>
      <button type="button" onClick={() => dispatch({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" })}>
        stub: 텍스트 fallback
      </button>
    </div>
  ),
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
    getNaverSetup: vi.fn(),
    getWalkthroughContext: vi.fn(),
    walkthroughHandshake: vi.fn(),
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
/** A first sync currently RUNNING → resume/observe the in-progress screen and poll for the outcome. */
const runningCapability = (accountId = "acc-1") =>
  capabilityView(accountId, { credentialPresent: true, identityConfirmed: false, firstSyncStatus: "RUNNING", overall: "NEEDS_ATTENTION", reason: "SYNC_IN_PROGRESS" });
/** A first sync that ended in FAILED (as seen by the poll). */
const failedSyncCapability = (accountId = "acc-1") =>
  capabilityView(accountId, { credentialPresent: true, identityConfirmed: false, firstSyncStatus: "FAILED", overall: "NEEDS_ATTENTION", reason: "SYNC_FAILED" });

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
  // Deployment-global setup: default none advertised (the tutorial then shows generic guidance).
  vi.mocked(api.getNaverSetup).mockResolvedValue({ advertisedEgressIps: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers(); // isolate any test that opted into fake timers
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connect/naver"]}>
      <ConnectNaver />
    </MemoryRouter>,
  );
}

// GUIDED-FIRST: no stored key → the page enters the guided walkthrough directly (no path fork). The runtime
// OBSERVES the store's application list to branch. New app → the runtime saw an empty store → issued hand-off
// → begin entry. (The walkthrough is stubbed; these buttons stand in for the runtime-observed completion.)
async function newAppPath() {
  await userEvent.click(await screen.findByRole("button", { name: "stub: 신규앱 안내 완료" }));
  await userEvent.click(await screen.findByRole("button", { name: /발급된 정보를 입력/ }));
}
// Existing app: the runtime observed an existing app → return straight to existing-credential entry.
async function guidedExisting() {
  await userEvent.click(await screen.findByRole("button", { name: "stub: 기존앱 안내 완료" }));
}
async function enterCredentials(secret = SECRET) {
  await userEvent.type(await screen.findByLabelText(/Client ID/), "app-id-1");
  await userEvent.type(screen.getByLabelText(/Client Secret/), secret);
  await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));
}

describe("ConnectNaver — Local-Agent-free order connection", () => {
  it("fetches deployment-global setup (advertised call IP) on load, so the issuance tutorial can show it", async () => {
    // H1 regression: the advertised IP must be delivered via a NON-account-scoped read available at
    // issuance time — not the completion-gated capability view — or the tutorial never shows it.
    vi.mocked(api.getNaverSetup).mockResolvedValue({ advertisedEgressIps: ["203.0.113.10"] });
    renderPage();
    await waitFor(() => expect(api.getNaverSetup).toHaveBeenCalled());
  });

  it("a setup fetch failure fails safe (no crash; tutorial falls back to generic guidance)", async () => {
    vi.mocked(api.getNaverSetup).mockRejectedValue(new Error("setup unavailable"));
    renderPage();
    // The page still loads to the guided walkthrough despite the setup read failing.
    expect(await screen.findByTestId("guided-walkthrough-stub")).toBeInTheDocument();
  });

  it("with the local agent DOWN, the whole order connection still completes (no readiness gate)", async () => {
    h.bridge = AGENT_DOWN;
    mockTestAndSyncSuccess();
    renderPage();
    // Guided-first: no path-choice fork, no login/readiness gate — straight into the guided walkthrough.
    expect(await screen.findByTestId("guided-walkthrough-stub")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "처음 발급할게요" })).toBeNull();
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

  it("capability read fails on load → fail-safe to guided entry; never a false completion, never an auto-sync", async () => {
    vi.mocked(api.getConnectionCapabilityStrict).mockRejectedValue(new Error("backend down"));
    renderPage();
    expect(await screen.findByTestId("guided-walkthrough-stub")).toBeInTheDocument();
    expect(api.testConnection).not.toHaveBeenCalled();
    expect(api.manualSync).not.toHaveBeenCalled();
  });
});

describe("ConnectNaver — text fallback (Local Agent unavailable) is fail-safe, then reaches the static checklist", () => {
  it("an UNDETERMINED-branch text fallback ASKS have/new (never silently a new app); 'have' → existing entry", async () => {
    mockTestAndSyncSuccess();
    renderPage();
    // Guided couldn't determine existing-vs-new (agent unavailable) → the text fallback must NOT assume new.
    await userEvent.click(await screen.findByRole("button", { name: "stub: 텍스트 fallback" }));
    // It asks (the self-declare fork), NOT the new-app issuance checklist.
    expect(await screen.findByRole("button", { name: "이미 애플리케이션이 있어요" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "애플리케이션 발급" })).toBeNull();
    // An existing-app seller reaches their reuse entry (with secret recovery) — never a forced second app.
    await userEvent.click(screen.getByRole("button", { name: "이미 애플리케이션이 있어요" }));
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
  });

  it("choosing to issue a new app from the fallback fork opens the static checklist + the official center in a NEW TAB", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "stub: 텍스트 fallback" }));
    await userEvent.click(await screen.findByRole("button", { name: "처음 발급할게요" }));
    await userEvent.click(await screen.findByRole("button", { name: "애플리케이션이 없어요" }));
    await userEvent.click(await screen.findByRole("button", { name: /계정·스토어를 선택/ }));
    expect(await screen.findByRole("heading", { name: "애플리케이션 발급" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(3);

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await userEvent.click(screen.getByRole("button", { name: /API 센터 열기/ }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("commerce.naver.com"), "_blank", "noopener,noreferrer");
    expect(screen.getByRole("button", { name: "발급을 완료했어요" })).toBeInTheDocument();
    openSpy.mockRestore();
  });
});

describe("ConnectNaver — reuse an existing connection / application (§discovery)", () => {
  it("existing app (runtime-observed): guided returns to existing entry → enter the key → completed (never a new app)", async () => {
    mockTestAndSyncSuccess();
    renderPage();
    await guidedExisting();
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
    // The post-guided input copy, not a guided/text choice.
    expect(screen.getByText("방금 복사한 애플리케이션 ID와 시크릿을 입력해 주세요.")).toBeInTheDocument();
    await enterCredentials();
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "발급을 완료했어요" })).toBeNull();
  });
});

describe("ConnectNaver — credential recovery when the Secret is lost (§flow 4) — reissue, never delete", () => {
  it("Secret lost: existing entry → 'secret not found' → recovery (never a forced new app)", async () => {
    renderPage();
    await guidedExisting();
    await userEvent.click(await screen.findByRole("button", { name: "시크릿을 찾지 못했어요" }));
    expect(await screen.findByRole("heading", { name: "시크릿 재확인 필요" })).toBeInTheDocument();
  });

  it("recovery offers NO app-delete; re-obtaining the Secret returns to existing entry", async () => {
    renderPage();
    await guidedExisting();
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
    await screen.findByTestId("guided-walkthrough-stub");
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
  it("restores the post-guided existing-entry step after a page refresh WITHOUT re-choice and WITHOUT a stored secret", async () => {
    const first = renderPage();
    // existing_credential_entry (reached after the guided walk) is a restorable, secret-free step.
    await guidedExisting();
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();

    first.unmount();
    renderPage();

    // Restored verbatim (phase+path) — no guided re-entry, and the transient guided phase is never resurfaced.
    expect(await screen.findByRole("heading", { name: "기존 연결 정보 입력" })).toBeInTheDocument();
    expect(screen.queryByTestId("guided-walkthrough-stub")).toBeNull();
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

describe("ConnectNaver — first-sync progress + resume (NAVER First Sync Progress + Resume UX v1)", () => {
  const POLL = 5000;
  // Flush the multi-hop async mount (resolve → capability resume) under fake timers — a single 0-advance
  // only drains one hop, so pump a few cycles until the resumed state settles.
  const settle = async () => {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(1);
  };

  it("refresh while a first sync is RUNNING → resume OBSERVING (no test/sync POST), poll → completed", async () => {
    vi.useFakeTimers();
    try {
      // Capability: RUNNING on the resume read + first poll, then SUCCESS.
      vi.mocked(api.getConnectionCapabilityStrict)
        .mockResolvedValueOnce(runningCapability())
        .mockResolvedValueOnce(runningCapability())
        .mockResolvedValue(capabilityView());
      renderPage();
      await settle(); // flush mount resolve + resume

      // In-progress screen restored from the RUNNING snapshot — NOT completed, and nothing was re-triggered.
      expect(screen.getByRole("heading", { name: "첫 주문 수집 중" })).toBeInTheDocument();
      expect(screen.getByText(/경과 시간/)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "주문 연결 완료" })).toBeNull();
      expect(api.testConnection).not.toHaveBeenCalled();
      expect(api.manualSync).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(POLL); // poll 1: still RUNNING
      expect(screen.queryByRole("heading", { name: "주문 연결 완료" })).toBeNull();
      await vi.advanceTimersByTimeAsync(POLL); // poll 2: SUCCESS → completed

      expect(screen.getByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
      // The whole resume + poll cycle made ZERO test/sync POSTs — the exact duplicate-sync fix.
      expect(api.testConnection).not.toHaveBeenCalled();
      expect(api.manualSync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resume observing → poll returns FAILED → error + explicit retry CTA (no auto new sync)", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.getConnectionCapabilityStrict)
        .mockResolvedValueOnce(runningCapability())
        .mockResolvedValue(failedSyncCapability());
      renderPage();
      await settle();
      expect(screen.getByRole("heading", { name: "첫 주문 수집 중" })).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(POLL); // poll → FAILED
      expect(screen.getByRole("alert")).toHaveTextContent(/첫 주문 수집에 실패/);
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
      expect(api.manualSync).not.toHaveBeenCalled(); // failure surfaced by the poll, not a new sync
    } finally {
      vi.useRealTimers();
    }
  });

  it("initial first sync returns RUNNING (coalesced) → progress screen, then poll → completed (one manualSync)", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.getConnectionCapabilityStrict)
        .mockResolvedValueOnce(savedKeyIncompleteCapability()) // resume → connection-test CTA
        .mockResolvedValue(capabilityView()); // poll → SUCCESS
      vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
      vi.mocked(api.manualSync).mockResolvedValue(syncRun("acc-1", { status: "RUNNING" })); // coalesced
      renderPage();
      await settle();

      // Native click (userEvent's internal delays deadlock under fake timers) + flush the test→sync chain.
      await act(async () => {
        screen.getByRole("button", { name: "연결 확인" }).click();
        await settle();
      });

      // Coalesced RUNNING is NOT treated as success — the progress screen shows and one sync was fired.
      expect(screen.getByRole("heading", { name: "첫 주문 수집 중" })).toBeInTheDocument();
      expect(screen.getByText(/경과 시간/)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "주문 연결 완료" })).toBeNull();
      expect(api.manualSync).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(POLL); // poll → SUCCESS → completed
      expect(screen.getByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
      expect(api.manualSync).toHaveBeenCalledTimes(1); // the poll never starts a second sync
    } finally {
      vi.useRealTimers();
    }
  });

  it("polling past the timeout → stalled screen with a re-check that only polls (never a new sync)", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(runningCapability()); // always RUNNING
      renderPage();
      await settle();
      expect(screen.getByRole("heading", { name: "첫 주문 수집 중" })).toBeInTheDocument();

      // Advance past the 12-min poll timeout → stalled screen (no new sync ever created).
      await vi.advanceTimersByTimeAsync(13 * 60_000);
      expect(screen.getByText(/새 수집을 만들지 않고/)).toBeInTheDocument();
      const recheck = screen.getByRole("button", { name: "진행 상태 다시 확인" });

      // Re-check re-enters polling on the SAME run; still no manualSync/testConnection POST.
      // Re-check RESUMES polling the SAME run — with the sync now settled, the next poll completes it. That
      // it reaches completion proves the re-check re-polled; and it NEVER started a new sync. (Flush the click
      // in its own act first so the re-opened poll interval is scheduled BEFORE we advance the clock.)
      vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(capabilityView());
      await act(async () => {
        recheck.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3 * POLL);
      });
      expect(screen.getByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
      expect(api.manualSync).not.toHaveBeenCalled();
      expect(api.testConnection).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("initial sync request dropped mid-run but the job is RUNNING → observe (no spurious failure), poll → completed", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.getConnectionCapabilityStrict)
        .mockResolvedValueOnce(savedKeyIncompleteCapability()) // resume → connection-test CTA
        .mockResolvedValueOnce(runningCapability()) // catch-path disambiguation: job is actually RUNNING
        .mockResolvedValue(capabilityView()); // poll → SUCCESS
      vi.mocked(api.testConnection).mockResolvedValue({ sellerAccountId: "acc-1", status: "SUCCESS", checkedAt: "", message: "", reasonCode: null });
      vi.mocked(api.manualSync).mockRejectedValue(new Error("gateway timeout")); // held request cut by infra
      renderPage();
      await settle();

      await act(async () => {
        screen.getByRole("button", { name: "연결 확인" }).click();
        await settle();
      });

      // The dropped request did NOT surface as a failure — the job is RUNNING, so we observe instead.
      expect(screen.getByRole("heading", { name: "첫 주문 수집 중" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(api.manualSync).toHaveBeenCalledTimes(1); // and it is never re-fired

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3 * POLL); // poll → SUCCESS → completed
      });
      expect(screen.getByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
      expect(api.manualSync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("double-click on the connection-test CTA fires exactly one test + one sync (client single-flight)", async () => {
    vi.mocked(api.getConnectionCapabilityStrict).mockResolvedValue(savedKeyIncompleteCapability());
    // Terminal SUCCESS so no polling is needed — this test is purely about the double-click guard.
    mockTestAndSyncSuccess();
    renderPage();
    const btn = await screen.findByRole("button", { name: "연결 확인" });
    // Two rapid clicks before the first chain settles — the guard must collapse them to one run.
    await Promise.all([userEvent.click(btn), userEvent.click(btn)]);
    expect(await screen.findByRole("heading", { name: "주문 연결 완료" })).toBeInTheDocument();
    expect(api.testConnection).toHaveBeenCalledTimes(1);
    expect(api.manualSync).toHaveBeenCalledTimes(1);
  });
});

describe("ConnectNaver — walkthrough environment binding (VITE_WALKTHROUGH_MODE)", () => {
  const RUN = "wt-test-1234";
  const ORIGIN = window.location.origin;

  function walkthroughContext(over: Record<string, unknown> = {}) {
    return {
      walkthroughRunId: RUN,
      gitCommit: "abc1234",
      frontendOrigin: ORIGIN,
      backendOrigin: "http://127.0.0.1:18090",
      dbAlias: "naver_walkthrough",
      schedulerEnabled: false,
      naverConnectorEnabled: true,
      baseline: { credentials: 0, syncJobs: 0, channelOrders: 0, naverAccounts: 0 },
      startedAt: "2026-08-01T00:00:00Z",
      ...over,
    };
  }
  function enterWalkthrough(urlRun: string | null) {
    vi.stubEnv("VITE_WALKTHROUGH_MODE", "true");
    vi.stubEnv("VITE_WALKTHROUGH_RUN_ID", RUN);
    window.history.pushState({}, "", `/connect/naver${urlRun ? `?walkthroughRun=${urlRun}` : ""}`);
  }
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("exact-run URL + matching context + handshake → banner + wizard reachable, NO page-load account write", async () => {
    enterWalkthrough(RUN);
    vi.mocked(api.getWalkthroughContext).mockResolvedValue(walkthroughContext());
    vi.mocked(api.walkthroughHandshake).mockResolvedValue({ runMatched: true, originMatched: true, timestamp: "t" });
    renderPage();
    expect(await screen.findByRole("note", { name: "Disposable NAVER Walkthrough" })).toHaveTextContent(RUN.slice(0, 8));
    // Gate opened → the guided wizard is reachable, and NO account was bootstrapped just by loading.
    expect(await screen.findByTestId("guided-walkthrough-stub")).toBeInTheDocument();
    // The handshake sent the run id from the TAB'S URL (not the /context echo) + this tab's origin.
    expect(api.walkthroughHandshake).toHaveBeenCalledWith(
      expect.objectContaining({ walkthroughRunId: RUN, origin: window.location.origin }),
    );
    expect(screen.queryByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeNull();
    expect(api.createApiChannelAccount).not.toHaveBeenCalled();
    expect(api.testConnection).not.toHaveBeenCalled();
    expect(api.manualSync).not.toHaveBeenCalled();
  });

  it("missing URL run id → MISMATCH screen, wizard + handshake blocked", async () => {
    enterWalkthrough(null);
    vi.mocked(api.getWalkthroughContext).mockResolvedValue(walkthroughContext());
    renderPage();
    expect(await screen.findByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeInTheDocument();
    expect(screen.queryByTestId("guided-walkthrough-stub")).toBeNull();
    expect(api.walkthroughHandshake).not.toHaveBeenCalled();
    expect(api.createApiChannelAccount).not.toHaveBeenCalled();
  });

  it("wrong URL run id (stale/different run) → MISMATCH, no handshake, no bootstrap", async () => {
    enterWalkthrough("wt-STALE-999");
    vi.mocked(api.getWalkthroughContext).mockResolvedValue(walkthroughContext());
    renderPage();
    expect(await screen.findByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeInTheDocument();
    expect(api.walkthroughHandshake).not.toHaveBeenCalled();
  });

  it("backend context run id differs (different backend) → MISMATCH", async () => {
    enterWalkthrough(RUN);
    vi.mocked(api.getWalkthroughContext).mockResolvedValue(walkthroughContext({ walkthroughRunId: "wt-OTHER-BACKEND" }));
    renderPage();
    expect(await screen.findByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeInTheDocument();
  });

  it("origin mismatch (context frontendOrigin differs) → MISMATCH", async () => {
    enterWalkthrough(RUN);
    vi.mocked(api.getWalkthroughContext).mockResolvedValue(walkthroughContext({ frontendOrigin: "http://127.0.0.1:5173" }));
    renderPage();
    expect(await screen.findByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeInTheDocument();
  });

  it("handshake does not match (backend rejects the tab) → MISMATCH", async () => {
    enterWalkthrough(RUN);
    vi.mocked(api.getWalkthroughContext).mockResolvedValue(walkthroughContext());
    vi.mocked(api.walkthroughHandshake).mockResolvedValue({ runMatched: false, originMatched: true, timestamp: "t" });
    renderPage();
    expect(await screen.findByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeInTheDocument();
    expect(screen.queryByTestId("guided-walkthrough-stub")).toBeNull();
  });

  it("context endpoint 404/unreachable → MISMATCH (never a silent proceed)", async () => {
    enterWalkthrough(RUN);
    vi.mocked(api.getWalkthroughContext).mockRejectedValue(new Error("404"));
    renderPage();
    expect(await screen.findByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeInTheDocument();
    // Banner still renders (walkthrough mode) even when the context is unknown.
    expect(screen.getByRole("note", { name: "Disposable NAVER Walkthrough" })).toBeInTheDocument();
  });
});
