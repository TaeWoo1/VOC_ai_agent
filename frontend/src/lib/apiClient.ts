import axios, { isAxiosError } from "axios";
import type {
  AgentReportListItem,
  AgentReportView,
  ReportKind,
  AgentQuotaStatus,
  AnswerStyleRequest,
  AnswerStyleView,
  ReviewReplyTemplateView,
  ReviewReplyTemplatesView,
  SellerProfileRequest,
  SellerProfileView,
  KnowledgeSourceRequest,
  OrgKnowledgeRequest,
  OrgKnowledgeView,
  KnowledgeSourceView,
  OverviewResponse,
  ProactiveCaseListResponse,
  ProactiveSummaryView,
  ProductKnowledgeView,
  ProductReviewPage,
  ProductSignalsView,
  InquiryProductBindingView,
  ProductCatalogView,
  ProductSummaryView,
  CredentialDiagnosisView,
  AccountDashboardSummary,
  ArticleListResponse,
  AuthResponse,
  HelperDeviceView,
  PasswordResetConfigView,
  SocialExchangeResponse,
  SocialProvidersView,
  BackfillRequest,
  Cafe24CapabilityView,
  Cafe24ConnectStartView,
  CapabilityView,
  ChannelCapabilityOverview,
  ChannelResponse,
  ChannelReviewDetailView,
  TriageActionKind,
  TriageBehaviorEvent,
  ReviewDecisionContext,
  ReviewDecisionLogEntry,
  TriageCorrectionHistoryView,
  TriageCorrectionRequest,
  TriageCorrectionView,
  TriageEventView,
  ChannelReviewLocateRun,
  ChannelReviewPageView,
  ReviewTriageTier,
  ConnectionInfoView,
  ConnectionCapabilityView,
  NaverSetupView,
  CoupangSetupView,
  ConnectionStatusView,
  ConnectionTestResultView,
  ConnectorAlertView,
  CredentialIntakeRequest,
  CredentialReplaceRequest,
  CredentialReplaceResultView,
  CredentialTemplateView,
  DashboardSummaryResponse,
  IngestResult,
  InboxResponse,
  InquiryDetail,
  ReviewDetailResponse,
  GeneratedDraftView,
  InquiryReplyCapabilityView,
  PublishCapabilityView,
  PublishStatusView,
  ReplyDraftView,
  InquiryQueueResponse,
  InquiryRowsResponse,
  ItemAnalysis,
  ProposalResult,
  OperatorAttentionSummary,
  OperatorReplyWorkView,
  OperatorDismissedReplyWorkView,
  ReviewReplyWorkDismissalResponse,
  ReviewReplyWorkRestoreResponse,
  OperatorVocItemPage,
  OrderSummaryResponse,
  OperatorOutcomeName,
  ReviewReplyApprovalResponse,
  ReviewReplyApprovalStateName,
  ReviewReplyDraft,
  ReviewReplyOutcomeResponse,
  ReviewReplyPrep,
  GeneratedReviewDraftView,
  KnowledgeCandidateView,
  KnowledgeDocumentView,
  KnowledgeSummaryView,
  LearnedKnowledgeResponse,
  ReviewReplySubmissionRunResponse,
  ReviewExecutionView,
  ReviewAcquisitionReadinessResponse,
  ReviewAcquisitionRunResponse,
  TriageDecisionResponse,
  TriageDisposition,
  ScheduleView,
  SellerAccountResponse,
  ReviewImport,
  CreateReviewImportPlanRequest,
  DateRangeView,
  ReviewImportAttemptView,
  ReviewImportHealthView,
  ReviewImportLaunchView,
  ReviewImportPlanDetailView,
  ReviewImportPlanView,
  ReviewImportRangeSelectionView,
  ReviewImportSegmentView,
  ReviewOpsLoopSummary,
  SyncJobView,
  ChannelCoverageRowView,
  SyncRunFilters,
  SyncRunView,
  UploadType,
  UserView,
  WalkthroughContextView,
  WalkthroughHandshakeResult,
  ReviewIssueView,
  ReviewIssueDetailView,
  RepeatedIssueContext,
  OperationsHome,
  OpportunityView,
  OpportunityKind,
} from "./types";
import {
  mockAccountArticles,
  mockAccountAttention,
  mockAccountDashboard,
  mockAttentionItems,
  mockReplyWork,
  mockDismissReplyWork,
  mockDismissedReplyWork,
  mockRestoreReplyWork,
  mockAuth,
  mockCapabilities,
  mockCapabilityOverview,
  mockChannels,
  mockConnectionInfo,
  mockConnectionStatus,
  mockConnectorAlerts,
  mockCredentialTemplate,
  mockDecideReviewReplyApproval,
  mockRecordReviewReplyOutcome,
  mockReviewIssues,
  mockReviewIssueDetail,
  mockUpdateReviewIssue,
  mockReviewReplyPrep,
  mockSaveReviewReplyDraft,
  mockStartReviewReplySubmissionRun,
  mockStoreCredential,
  mockTestConnection,
  mockDashboard,
  mockInbox,
  mockItemAnalysis,
  mockMe,
  mockOrders,
  mockSchedules,
  mockSellerAccounts,
  mockReviewImports,
  mockSyncJobs,
  mockSyncRuns,
  mockVocItemTriage,
} from "./mocks";
import { visibleChannels } from "./productChannels";
import type { CustomerOperationsHome, OperationsCaseDetail, ResponsibilityView } from "./customerOperationsTypes";
import { captureApiError } from "./telemetry/sentry";

// Default to a SAME-ORIGIN relative base ("") so `/api/*` requests go through the Vite dev proxy (see
// vite.config.ts) to whatever backend the dev server targets. This removes the two failure modes that
// once cost a live run an hour (see loginError.ts): a stale absolute `VITE_API_BASE_URL` port, and a
// cross-origin CORS rejection between localhost/127.0.0.1. Set VITE_API_BASE_URL explicitly only for a
// deployment where the API is served from a different origin than the app.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const TOKEN_KEY = "sellerops_token";

const http = axios.create({ baseURL: BASE_URL, timeout: 8000 });

/**
 * How long a call that WAITS ON A MODEL may take, overriding the shared 8s.
 *
 * <p>Eight seconds is the right bound for a read: past it, something is wrong and saying so beats
 * spinning. It is the wrong bound for a request whose server-side work is a vendor round-trip.
 * Measured on the real Demo Org, 2026-09-03: review reply generations completed in 2.8s, 4.4s, 4.4s,
 * 5.1s, 6.8s, 9.7s, 11.5s and 14.1s. The four over eight seconds were aborted by this client while
 * the backend finished and SAVED the version — so the seller read 「초안을 만들지 못했습니다」 over a
 * draft that existed, and pressing the button again spent another model call on it.
 *
 * <p>It is per-request rather than a raised default, because loosening every read's failure detection
 * to accommodate the two calls that talk to a vendor is the wrong trade.
 */
const MODEL_TIMEOUT_MS = 60_000;

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Where an expired SellerOps session sends the seller: the login form, told why (`?expired=1`).
 * Exported so the login page and the tests agree on the one spelling.
 */
export const SESSION_EXPIRED_PATH = "/login?expired=1";

/**
 * In-session expiry of the seller's OWN SellerOps session (the JWT is 12h; a self-pilot day is longer).
 *
 * Before this handler a 401 mid-session looked like a broken backend: every `*Strict` read rejected and each
 * screen printed its own "불러오지 못했습니다" — the same failure the `getMe` fix (2026-07-26) closed for the
 * boot path but not for the hours after it. Self-Pilot Runtime v1: session expiry is a RECONNECT task, not an
 * error. A 401 on any authenticated call clears the stale token and sends the seller to the login form with
 * `?expired=1`, so the form can say "세션이 만료되었습니다" instead of the seller guessing.
 *
 * Deliberately narrow: only 401 (never 403 — that is a real authorization answer), only when a token was
 * present (an unauthenticated probe is not an expiry), never for the auth calls themselves (a wrong password or a
 * spent social-login code must stay a form/screen error, not a redirect loop). The redirect uses `location.assign` because the interceptor lives
 * outside the router; the token is cleared FIRST so `Protected` cannot bounce back in.
 */
export function isSessionExpiry(status: number | undefined, url: string | undefined, hadToken: boolean): boolean {
  if (status !== 401 || !hadToken) return false;
  // Every /api/auth/* call is a public one (login, sign-up, social code exchange, onboarding complete): a 401
  // there is that flow's own answer ("wrong password", "링크가 만료") and must render on that screen.
  return !(url ?? "").includes("/api/auth/");
}

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
    const url = (error as { config?: { url?: string } } | undefined)?.config?.url;
    if (isSessionExpiry(status, url, getToken() !== null)) {
      clearToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign(SESSION_EXPIRED_PATH);
      }
    }
    // Error monitoring (docs/service_readiness_v1.md §2-1): ≥ 500 / no answer is an incident; a no-op without Sentry.
    captureApiError(error);
    return Promise.reject(error);
  },
);

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Read-only GETs serve the seeded fixtures ONLY in the explicit mock build (`VITE_USE_MOCKS=true`).
 *
 * They used to also fall back to the fixtures on ANY error (401/403/500/timeout) — which meant a real
 * org whose read failed rendered the fixture org's NAVER/Cafe24 channels, reviews and orders with no
 * indication they were fake (Agent Interaction Model v2 §0 audit; the same reasoning `getMe` already
 * applied to sessions: a silent fallback fabricates DATA). An error now propagates and the screen says
 * it could not read — the honest failure.
 */
async function getOrMock<T>(path: string, mock: () => T): Promise<T> {
  if (USE_MOCKS) {
    return mock();
  }
  const { data } = await http.get<T>(path);
  return data;
}

/** `(issueId, kind)` is an opportunity's whole identity — the path says so. */
function opportunityPath(issueId: string, kind: OpportunityKind, action: string): string {
  return `/api/opportunities/${encodeURIComponent(issueId)}/${encodeURIComponent(kind)}/${action}`;
}

export const api = {
  async login(email: string, password: string): Promise<AuthResponse> {
    if (USE_MOCKS) {
      return mockAuth();
    }
    const { data } = await http.post<AuthResponse>("/api/auth/login", { email, password });
    return data;
  },

  async signup(input: {
    email: string;
    password: string;
    name: string;
    orgName: string;
    /** 필수 동의 — the backend refuses without it (docs/service_readiness_v1.md §2-4). */
    termsAccepted: boolean;
    marketingConsent: boolean;
  }): Promise<AuthResponse> {
    if (USE_MOCKS) {
      return mockAuth();
    }
    const { data } = await http.post<AuthResponse>("/api/auth/signup", input);
    return data;
  },

  // ── Social login (docs/auth_growth_instrumentation_v1.md §3). No mock fallback: with VITE_USE_MOCKS the
  // providers read answers "none", so the buttons simply do not render, and the code paths are unreachable.
  async socialProviders(): Promise<SocialProvidersView> {
    if (USE_MOCKS) {
      return { google: false, naver: false };
    }
    const { data } = await http.get<SocialProvidersView>("/api/auth/social/providers");
    return data;
  },

  /** Spend the one-time code from `/auth/callback?code=…` — the JWT (or the onboarding token) arrives in the body. */
  async socialExchange(code: string): Promise<SocialExchangeResponse> {
    const { data } = await http.post<SocialExchangeResponse>("/api/auth/social/exchange", { code });
    return data;
  },

  async socialOnboardingComplete(input: {
    onboardingToken: string;
    orgName: string;
    name: string;
    termsAccepted: boolean;
    marketingConsent: boolean;
  }): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>("/api/auth/social/onboarding/complete", input);
    return data;
  },

  /**
   * Whether this deployment exposes the demo entry at all (Pilot Runtime Foundation v1 §2).
   * One boolean, never an account. Under mocks there is no backend to ask and no fixture to open.
   */
  async demoEntryConfig(): Promise<{ enabled: boolean }> {
    if (USE_MOCKS) {
      return { enabled: false };
    }
    const { data } = await http.get<{ enabled: boolean }>("/api/auth/demo/config");
    return data;
  },

  // ── Password reset (docs/service_readiness_v1.md §2-2, §6). `config` decides whether the entry exists at all.
  async passwordResetConfig(): Promise<PasswordResetConfigView> {
    if (USE_MOCKS) {
      return { enabled: false, devOutbox: false };
    }
    const { data } = await http.get<PasswordResetConfigView>("/api/auth/password/config");
    return data;
  },

  /** Always resolves the same way — the server never says whether the address exists. */
  async forgotPassword(email: string): Promise<void> {
    await http.post("/api/auth/password/forgot", { email });
  },

  /** 401 = expired / used / unknown link; the page turns that into "다시 요청". */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await http.post("/api/auth/password/reset", { token, newPassword });
  },

  /**
   * Who the stored token belongs to — **no mock fallback, deliberately.**
   *
   * This is the one read where a silent fallback fabricates a SESSION. It used `getOrMock`, so a rejected token
   * returned a mock user, `AuthProvider` hydrated "successfully", and the app rendered as though signed in — with
   * every real read behind it failing. On 2026-07-26 that produced "계정을 불러오지 못했어요" on the import screen
   * for a seller whose actual problem was an expired session, and there was nothing on screen to suggest logging
   * in again.
   *
   * Failing here is what makes the session honest: `AuthProvider` clears the token and the seller sees the login
   * form, which is the true state. `VITE_USE_MOCKS` still works — an explicit demo mode is a choice, not a
   * fallback taken behind the user's back.
   */
  // ---- Helper Device Authentication v1 — the seller's session approves a helper, lists and revokes them.
  listHelperDevices: async (): Promise<HelperDeviceView[]> => {
    if (USE_MOCKS) return [];
    const { data } = await http.get<HelperDeviceView[]>("/api/helper-devices");
    return data;
  },
  /** The browser forwards the user code it got from its own paired helper; the session is the approval. */
  approveHelperDevice: async (userCode: string): Promise<void> => {
    await http.post("/api/helper-devices/approve", { userCode });
  },
  revokeHelperDevice: async (id: string): Promise<void> => {
    await http.delete(`/api/helper-devices/${encodeURIComponent(id)}`);
  },

  getMe: async (): Promise<UserView> => {
    if (USE_MOCKS) {
      return mockMe();
    }
    const { data } = await http.get<UserView>("/api/users/me");
    return data;
  },
  // Both channel reads return the product-visible catalog only (`lib/productChannels.ts`). The
  // backend already narrows `/api/channels` the same way; the client-side pass makes the demo
  // catalog and any silent mock fallback obey the same rule.
  getChannels: (): Promise<ChannelResponse[]> =>
    getOrMock("/api/channels", mockChannels).then(visibleChannels),
  // Strict variants for the Naver collection workflow (ChannelDetail): no silent
  // mock fallback, so a dead/wrong backend fails closed instead of rendering a
  // fake "CONNECTED" page. The global VITE_USE_MOCKS demo escape hatch is still
  // honored. Mirrors the getChannelCapabilities fail-closed pattern below.
  async getChannelsStrict(): Promise<ChannelResponse[]> {
    if (USE_MOCKS) {
      return visibleChannels(mockChannels());
    }
    const { data } = await http.get<ChannelResponse[]>("/api/channels");
    return visibleChannels(data);
  },
  async getSellerAccountsStrict(): Promise<SellerAccountResponse[]> {
    if (USE_MOCKS) {
      return mockSellerAccounts();
    }
    const { data } = await http.get<SellerAccountResponse[]>("/api/seller-accounts");
    return data;
  },
  async getConnectionStatusStrict(accountId: string): Promise<ConnectionStatusView> {
    if (USE_MOCKS) {
      return mockConnectionStatus(accountId);
    }
    const { data } = await http.get<ConnectionStatusView>(
      `/api/seller-accounts/${accountId}/connection-status`,
    );
    return data;
  },
  /**
   * Why this account's stored credential can or cannot be opened right now.
   *
   * NO mock fallback and no swallowing: a diagnosis that guessed would be worse than none, because
   * the whole point is to stop sending sellers to re-do OAuth for problems that were server-side
   * configuration. Reads no secret material and makes no channel call.
   */
  async getCredentialDiagnosis(accountId: string): Promise<CredentialDiagnosisView> {
    const { data } = await http.get<CredentialDiagnosisView>(
      `/api/seller-accounts/${accountId}/credential-diagnosis`,
    );
    return data;
  },
  // Read-only NAVER guided-connection capability result (wizard completion screen). GET — the
  // backend derives it from persisted state (credential presence + latest order-sync outcome) with
  // NO live provider call. NO mock fallback: a dead backend must never render a fake "verified"
  // capability (fail closed). The response is fully sanitized (no token, id, order id, or personal
  // data); the seller's identity is only the `identityConfirmed` boolean.
  async getConnectionCapabilityStrict(accountId: string): Promise<ConnectionCapabilityView> {
    const { data } = await http.get<ConnectionCapabilityView>(
      `/api/seller-accounts/${accountId}/connection-capability`,
    );
    return data;
  },
  // Deployment-global NAVER setup facts (advertised call IP(s)) for the issuance tutorial — available
  // WITHOUT an account so the guided walkthrough can show them during first-time connection. Read-only
  // GET, no account scope, no secret (the advertised IP is a value the seller registers publicly).
  async getNaverSetup(): Promise<NaverSetupView> {
    const { data } = await http.get<NaverSetupView>("/api/connect/naver/setup");
    return data;
  },
  // Deployment-global Coupang setup facts (advertised calling IP(s)) for the connection surface —
  // available WITHOUT an account so a first-time seller sees the prerequisite before connecting.
  // Read-only GET, no account scope, no secret (the advertised IP is a value the seller registers publicly).
  async getCoupangSetup(): Promise<CoupangSetupView> {
    const { data } = await http.get<CoupangSetupView>("/api/connect/coupang/setup");
    return data;
  },
  // Walkthrough environment-identity: the read-only runtime context (walkthrough mode only; a 404 in
  // production/normal mode means "not a walkthrough runtime"). No DB write, no secret.
  async getWalkthroughContext(): Promise<WalkthroughContextView> {
    const { data } = await http.get<WalkthroughContextView>("/api/walkthrough/context");
    return data;
  },
  // Operator-tab handshake — proves this tab is bound to the bootstrapped run + origin. No DB write.
  async walkthroughHandshake(req: {
    walkthroughRunId: string;
    tabNonce: string;
    origin: string;
  }): Promise<WalkthroughHandshakeResult> {
    const { data } = await http.post<WalkthroughHandshakeResult>("/api/walkthrough/handshake", req);
    return data;
  },
  // Read-only masked connection-info (credential metadata) for one seller account
  // (ChannelDetail). Returns NEVER a secret — only the masked CredentialMetadata.
  // A 404 means "no credential on file" (an expected state), so it resolves to
  // null rather than throwing; any other failure fails closed (throws) so the page
  // can show "불러오지 못했습니다" distinct from "등록된 연결 정보 없음". Honors the
  // VITE_USE_MOCKS demo escape hatch.
  async getConnectionInfoStrict(accountId: string): Promise<ConnectionInfoView | null> {
    if (USE_MOCKS) {
      return mockConnectionInfo(accountId);
    }
    try {
      const { data } = await http.get<ConnectionInfoView>(
        `/api/seller-accounts/${accountId}/credentials`,
      );
      return data;
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 404) {
        return null;
      }
      throw e;
    }
  },
  // Read-only credential FIELD SHAPE for a channel (ChannelDetail's 연결에 필요한
  // 정보 block): channel-scoped reference data, NEVER a value/secret. A 404 means
  // the channel needs no API template (manual / file-upload / not-yet-integrated)
  // — an expected state, so it resolves to null and the block is simply omitted;
  // any other failure fails closed (throws) so the page can show a calm error.
  // Honors the VITE_USE_MOCKS demo escape hatch; mirrors getConnectionInfoStrict.
  async getCredentialTemplateStrict(channelCode: string): Promise<CredentialTemplateView | null> {
    if (USE_MOCKS) {
      return mockCredentialTemplate(channelCode);
    }
    try {
      const { data } = await http.get<CredentialTemplateView>(
        `/api/channels/${channelCode}/credential-template`,
      );
      return data;
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 404) {
        return null;
      }
      throw e;
    }
  },
  // Mutating: write-only credential intake (ChannelDetail's 연결 정보 입력 form).
  // POSTs the operator's typed connection info to the backend, which validates it
  // against the channel template, encrypts it, and answers with masked metadata.
  // The response body (masked metadata incl. encryptionKeyId) is deliberately NOT
  // consumed — success is re-established by the caller re-reading
  // getConnectionInfoStrict. In demo mode there is no backend, so it records a
  // masked optimistic view locally (never the typed secrets) so the subsequent
  // re-read reflects the save. Resolves void in both modes.
  async storeCredential(accountId: string, request: CredentialIntakeRequest): Promise<void> {
    if (USE_MOCKS) {
      mockStoreCredential(accountId, request);
      return;
    }
    await http.post(`/api/seller-accounts/${accountId}/credentials`, request);
  },
  // Mutating-intent: a manual, explicit auth/connectivity check for the stored
  // credential (ChannelDetail's "연결 확인" button). POSTs to the backend, which
  // runs an auth-only provider check (no collection/sync/ingestion) and answers
  // with a safe result DTO — status/checkedAt/message/reasonCode only, never a
  // token, secret, or provider body. The body IS the result here (unlike
  // storeCredential, which discards its masked-metadata body), so it is consumed
  // and returned. Demo mode returns a channel-truthful canned result.
  async testConnection(accountId: string): Promise<ConnectionTestResultView> {
    if (USE_MOCKS) {
      return mockTestConnection(accountId);
    }
    const { data } = await http.post<ConnectionTestResultView>(
      `/api/seller-accounts/${accountId}/test-connection`,
    );
    return data;
  },
  // Mutating: atomic guided-renewal credential REPLACE. POSTs the NEW credential
  // secrets + the operator-confirmed new token expiry to the backend, which captures
  // the OLD credential in memory, upserts the new one in place (account/order/cursor
  // untouched), re-tests the connection + ordersheets access, and — on SUCCESS keeps
  // the new credential + resumes the schedule, on FAILURE restores the OLD credential
  // (rollback, the existing connection is never destroyed). The body IS the result
  // (safe {status, reasonCode, message} only — never a token/secret/provider body), so
  // it is consumed and returned. No mock fallback: a dead backend must fail closed, so
  // the renewal never claims a fake success. Secrets flow straight from the masked form
  // to this call and never enter a reducer/event/storage.
  async replaceCredential(
    accountId: string,
    request: CredentialReplaceRequest,
  ): Promise<CredentialReplaceResultView> {
    const { data } = await http.post<CredentialReplaceResultView>(
      `/api/seller-accounts/${accountId}/credentials/replace`,
      request,
    );
    return data;
  },
  // Operator-confirmation of the credential's exact expiry date (when WING's 유효기간 could not be read).
  // Sends ONLY the date — no secret — to a dedicated endpoint (the credential intake rejects secret-less
  // updates by design). Never an estimate. No mock fallback: a dead backend fails closed.
  async confirmCredentialExpiry(accountId: string, tokenExpiresAt: string): Promise<void> {
    await http.post(`/api/seller-accounts/${accountId}/credentials/expiry`, { tokenExpiresAt });
  },
  // Mutating-intent: begin the Cafe24 OAuth connect flow. NO mock fallback — this
  // requires a live backend, and a dead endpoint must fail closed (never a fake
  // success). The caller redirects the browser to authorizationUrl. The response
  // carries only the pending account + consent URL: no code, state, token, or secret.
  /** The account's stable opaque slot (and whether a credential is already stored against it). No secret. */
  async getAccountSessionSlot(accountId: string): Promise<{ accountSlot: string; credentialPresent: boolean }> {
    const { data } = await http.get<{ accountSlot: string; credentialPresent: boolean }>(
      `/api/seller-accounts/${accountId}/session-slot`,
    );
    return data;
  },
  /**
   * **Ask for a one-shot authorization to hand a just-issued Coupang credential to the vault.**
   *
   * The seller presses first; this is what their press does. The backend binds the authorization it returns to
   * this org, this seller, this account, this channel and this run, gives it minutes to live, and lets it be
   * spent once — so what comes back is a capability for a single write, not an identity.
   *
   * It carries no secret in either direction, and the id it returns must never be logged or put in a URL: it
   * goes straight to the local agent over the Action Window, which forwards it in one request header.
   */
  async authorizeCoupangCredentialHandoff(
    accountSlot: string,
    runId: string,
  ): Promise<{ authorizationId: string; expiresInMs: number }> {
    const { data } = await http.post<{ authorizationId: string; expiresInMs: number }>(
      "/api/agent/credential-handoff/authorize",
      { accountSlot, channelCode: "COUPANG", runId },
    );
    return data;
  },
  async startCafe24Connect(mallId: string): Promise<Cafe24ConnectStartView> {
    const { data } = await http.post<Cafe24ConnectStartView>("/api/connect/cafe24/start", {
      mallId,
    });
    return data;
  },
  // Read-only first-connection capability check. NO mock fallback — the tutorial must never
  // render a fake "verified" from a dead backend (fail closed). POST because the check performs
  // a live token refresh with single-use rotation. The response is fully sanitized (no mall id,
  // token, code/state, board name, or personal data).
  async getCafe24Capability(accountId: string): Promise<Cafe24CapabilityView> {
    const { data } = await http.post<Cafe24CapabilityView>(
      `/api/connect/cafe24/${accountId}/capability`,
    );
    return data;
  },
  // Strict variant for the connection-alert list (Alerts page): no silent mock
  // fallback, so a dead backend fails closed instead of rendering fake alerts.
  // Honors the VITE_USE_MOCKS demo escape hatch. Read-only; mirrors the other
  // *Strict reads.
  async getConnectorAlertsStrict(): Promise<ConnectorAlertView[]> {
    if (USE_MOCKS) {
      return mockConnectorAlerts();
    }
    const { data } = await http.get<ConnectorAlertView[]>("/api/connector-alerts");
    return data;
  },
  // Mutating: mark a connector alert as 확인 처리 (seen). No mock network call —
  // in demo mode there is no backend, so it resolves with null and the page
  // updates local state. In real mode it POSTs and returns the updated (now
  // acknowledged) view so the page can reconcile against the server timestamp.
  // Acknowledging only records that the operator saw the alert; it does not
  // resolve the underlying connection issue.
  async acknowledgeConnectorAlert(id: string): Promise<ConnectorAlertView | null> {
    if (USE_MOCKS) {
      return null;
    }
    const { data } = await http.post<ConnectorAlertView>(`/api/connector-alerts/${id}/acknowledge`);
    return data;
  },
  /**
   * What each seller-visible channel can currently say, per data type.
   *
   * <p>Strict: this read decides whether a screen may write 「문의가 없습니다」, and a silent mock
   * behind that sentence is the false calm the coverage enum exists to refuse. Org-scoped from the
   * JWT server-side; there is no parameter to get wrong.
   */
  async getChannelCoverageStrict(): Promise<ChannelCoverageRowView[]> {
    const { data } = await http.get<ChannelCoverageRowView[]>("/api/channels/coverage");
    return data;
  },
  async getSyncRunsStrict(filters: SyncRunFilters = {}): Promise<SyncRunView[]> {
    if (USE_MOCKS) {
      return mockSyncRuns();
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    const { data } = await http.get<SyncRunView[]>(`/api/sync-runs${query ? `?${query}` : ""}`);
    return data;
  },
  getChannelStatus: (): Promise<ChannelResponse[]> =>
    getOrMock("/api/dashboard/channel-status", mockChannels).then(visibleChannels),
  getSellerAccounts: (): Promise<SellerAccountResponse[]> =>
    getOrMock("/api/seller-accounts", mockSellerAccounts),
  getDashboardSummary: (): Promise<DashboardSummaryResponse> =>
    getOrMock("/api/dashboard/summary", mockDashboard),
  getInbox: (): Promise<InboxResponse> => getOrMock("/api/inbox", mockInbox),
  // Strict variant for the integrated inbox (Inbox page): no silent mock
  // fallback, so a dead backend fails closed instead of rendering a fake feed of
  // inquiries/reviews. Honors the VITE_USE_MOCKS demo escape hatch. Mirrors the
  // other *Strict reads.
  async getInboxStrict(params: { type?: "INQUIRY" | "REVIEW"; limit?: number } = {}): Promise<InboxResponse> {
    if (USE_MOCKS) {
      return mockInbox(params);
    }
    const query = new URLSearchParams();
    if (params.type) query.set("type", params.type);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const suffix = query.toString();
    const { data } = await http.get<InboxResponse>(`/api/inbox${suffix ? `?${suffix}` : ""}`);
    return data;
  },
  // Stored rule-based per-item analysis (read-only) for the org. Enrichment over
  // the inbox feed, not an essential read: the Inbox page treats a failure here
  // as fail-soft (renders the feed with no analysis areas), while the inbox feed
  // itself stays fail-closed via getInboxStrict. Honors the VITE_USE_MOCKS escape
  // hatch. There is no run trigger in the UI this slice — rows appear only after
  // POST /api/item-analysis/run is invoked out-of-band.
  async getItemAnalysisStrict(): Promise<ItemAnalysis[]> {
    if (USE_MOCKS) {
      return mockItemAnalysis();
    }
    const { data } = await http.get<ItemAnalysis[]>("/api/item-analysis");
    return data;
  },
  // Inbox-scoped variant: fetch analyses ONLY for the feed rows currently on
  // screen, so the inbox never pulls the whole org-wide analysis list (which
  // grows into the thousands after connector backfills). Same fail-soft contract
  // as getItemAnalysisStrict — the Inbox page treats a failure as enrichment-only.
  // Empty input short-circuits (no request). Honors the VITE_USE_MOCKS escape
  // hatch (returns the same seeded mock list; the page joins by id, so extra
  // mock rows are simply unused).
  async lookupItemAnalysisStrict(
    items: { sourceType: string; sourceId: string }[],
  ): Promise<ItemAnalysis[]> {
    if (USE_MOCKS) {
      return mockItemAnalysis();
    }
    if (items.length === 0) {
      return [];
    }
    const { data } = await http.post<ItemAnalysis[]>("/api/item-analysis/lookup", { items });
    return data;
  },

  // --- Seller inquiry workflow (OPEN queue → detail → proposal → PROPOSED) ---
  // All three are strict and have NO mock fallback: the workflow must never render
  // a fabricated queue, detail, or PROPOSED state, so a dead/wrong backend fails
  // closed (throws) and the page shows an honest error/retry.

  // Paged, org-scoped work queue. Defaults to the OPEN phase. Sanitized rows only
  // (title, no details/body/author).
  async getInquiryQueueStrict(
    params: { phase?: string; page?: number; size?: number } = {},
  ): Promise<InquiryQueueResponse> {
    const search = new URLSearchParams();
    if (params.phase) {
      search.set("phase", params.phase);
    }
    if (params.page != null) {
      search.set("page", String(params.page));
    }
    if (params.size != null) {
      search.set("size", String(params.size));
    }
    const query = search.toString();
    const { data } = await http.get<InquiryQueueResponse>(
      `/api/inquiries${query ? `?${query}` : ""}`,
    );
    return data;
  },
  /**
   * The customer's inquiries as ROWS (Query Accuracy v1) — the same read the conversation's 「최근 문의」
   * makes. The home brief uses it to NAME the work that is waiting instead of restating a count
   * (Working Context v1 §2); `order=OLDEST` is the one criterion this product has for urgency, and the
   * rows carry it visibly in their own receipt times.
   */
  async getInquiryRowsStrict(
    params: {
      status?: string;
      order?: string;
      limit?: number;
      channel?: string;
      q?: string;
      /** The product an inquiry is BOUND to — the axis a doorway from 상품 uses. */
      productId?: string;
      /** One exact inquiry, for a deep link naming a row that is not on the current page. */
      inquiryId?: string;
      /** Which page of `limit` rows, 0-based. Absent = the first, exactly as before. */
      page?: number;
    } = {},
  ): Promise<InquiryRowsResponse> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") search.set(key, String(value));
    }
    const query = search.toString();
    const { data } = await http.get<InquiryRowsResponse>(`/api/inquiries/rows${query ? `?${query}` : ""}`);
    return data;
  },
  // Seller-only detail for one work item: exposes title/details (never author),
  // and the attached proposal once PROPOSED. A 404 (foreign/unknown id) throws.
  /**
   * ONE review, exactly (Agent Object v1) — the same read the conversation's review anchor stands on.
   * Used by the review card to re-read the customer's sentence after a reload, where it was stripped.
   */
  async getReviewDetailStrict(reviewId: string): Promise<ReviewDetailResponse> {
    const { data } = await http.get<ReviewDetailResponse>(`/api/reviews/${reviewId}`);
    return data;
  },
  async getInquiryDetailStrict(workItemId: string): Promise<InquiryDetail> {
    const { data } = await http.get<InquiryDetail>(`/api/inquiries/${workItemId}`);
    return data;
  },
  /**
   * Bind this inquiry to a canonical product the seller picked.
   *
   * `override` is required only to replace an attribution the CHANNEL made; without it that case is
   * a 409 carrying `code: "SOURCE_BINDING_EXISTS"`, which the caller turns into a second question
   * rather than a silent overwrite. Nothing here proposes a product — the id comes from the seller's
   * own search.
   */
  async bindInquiryProduct(
    workItemId: string,
    productId: string,
    override = false,
  ): Promise<InquiryProductBindingView> {
    const { data } = await http.post<InquiryProductBindingView>(
      `/api/inquiries/${encodeURIComponent(workItemId)}/product`,
      { productId, override },
    );
    return data;
  },

  // Mutating: seller-initiated proposal generation (OPEN → PROPOSED). No mock.
  // The caller classifies 404 (unavailable) / 409 (phase changed) / 503
  // (generation unavailable) from the thrown axios error.
  async generateInquiryProposal(workItemId: string): Promise<ProposalResult> {
    const { data } = await http.post<ProposalResult>(`/api/inquiries/${workItemId}/proposal`);
    return data;
  },

  /**
   * Whether this deployment can post an inquiry reply at all, and for which channels.
   *
   * Read BEFORE any send control is rendered, never after. On the default configuration it answers
   * `{executionEnabled: false, replyAdapterChannelCodes: []}` and the reply UI shows the manual
   * hand-off — a screen that offered "등록" and then discovered the send path was off would have
   * promised the seller something the backend fails closed on.
   */
  async getInquiryPublishCapability(): Promise<PublishCapabilityView> {
    const { data } = await http.get<PublishCapabilityView>(`/api/inquiry-publish/capability`);
    return data;
  },

  /**
   * The audited transport per channel — what is KNOWN, as opposed to what is currently WIRED.
   *
   * `NEEDS_VERIFICATION` means nobody has finished reading that vendor's contract. It is not a "no",
   * and a screen that renders it as one is inventing a limitation.
   */
  async getInquiryReplyTransports(): Promise<InquiryReplyCapabilityView[]> {
    const { data } = await http.get<InquiryReplyCapabilityView[]>(`/api/inquiry-publish/transports`);
    return data;
  },

  /**
   * Generate an AI reply draft, grounded in the seller's own product knowledge where there is any.
   *
   * It appends a version rather than replacing one, so a regenerate never overwrites what the seller
   * was reading — and, because a new version has a new fingerprint, any approval bound to the
   * previous one can no longer be spent. It reaches no marketplace.
   */
  async generateInquiryDraft(workItemId: string): Promise<GeneratedDraftView> {
    const { data } = await http.post<GeneratedDraftView>(`/api/inquiries/${workItemId}/draft/generate`,
      undefined, { timeout: MODEL_TIMEOUT_MS });
    return data;
  },

  /**
   * Save a new append-only reply-draft version. `baseVersion` is the version being edited from (`0`
   * for the first save); a stale base is a 409, which is the seller's own draft having moved under
   * them rather than an error to swallow.
   */
  async saveInquiryReplyDraft(
    workItemId: string,
    request: { title: string; comments: string; baseVersion: number },
  ): Promise<ReplyDraftView> {
    const { data } = await http.put<ReplyDraftView>(`/api/inquiries/${workItemId}/draft`, request);
    return data;
  },

  /**
   * **The only marketplace WRITE the product has**, and the only client call that reaches it.
   *
   * `commandId` is the idempotency key of THIS confirm — generated once per press, so a retry after a
   * timeout cannot become a second reply. `expectedFingerprint` is the exact draft the seller read;
   * a mismatch is a 409, which means the draft changed after they reviewed it and the approval no
   * longer describes what would be sent.
   */
  async confirmInquiryPublish(
    workItemId: string,
    request: { commandId: string; expectedFingerprint: string },
  ): Promise<PublishStatusView> {
    const { data } = await http.post<PublishStatusView>(
      `/api/inquiries/${workItemId}/confirm-publish`,
      request,
    );
    return data;
  },

  /** Verify-only: re-query the channel's own status and advance on 처리완료. NEVER resends. */
  async verifyInquiryPublish(workItemId: string): Promise<PublishStatusView> {
    const { data } = await http.post<PublishStatusView>(`/api/inquiries/${workItemId}/verify`);
    return data;
  },

  /**
   * Resume a publish that was confirmed but not delivered — a retry dispatches only from
   * ACTION_PENDING; an abandoned DISPATCHING is recovered to DELIVERY_UNKNOWN and verified, never
   * resent, because a delivery nobody observed is ambiguous and a resend would be a second reply.
   */
  async resumeInquiryPublish(workItemId: string): Promise<PublishStatusView> {
    const { data } = await http.post<PublishStatusView>(`/api/inquiries/${workItemId}/resume`);
    return data;
  },

  getOrdersSummary: (): Promise<OrderSummaryResponse> =>
    getOrMock("/api/orders/summary", mockOrders),
  // Strict variant for the order/sales dashboard (Orders page): no silent mock
  // fallback, so a dead backend fails closed instead of rendering demo numbers.
  // Honors the VITE_USE_MOCKS demo escape hatch (filters are ignored in demo
  // mode). Optional from/to (ISO date) + channelId filter; defaults server-side
  // to the last 7 days / all channels. Mirrors the other *Strict reads.
  async getOrdersSummaryStrict(
    params: { from?: string; to?: string; channelId?: string } = {},
  ): Promise<OrderSummaryResponse> {
    if (USE_MOCKS) {
      return mockOrders();
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        search.set(key, value);
      }
    }
    const query = search.toString();
    const { data } = await http.get<OrderSummaryResponse>(
      `/api/orders/summary${query ? `?${query}` : ""}`,
    );
    return data;
  },
  getSyncJobs: (): Promise<SyncJobView[]> => getOrMock("/api/sync-jobs", mockSyncJobs),
  // Strict variant for the upload-history list (Upload page): no silent mock
  // fallback, so a dead backend fails closed instead of showing fake "최근 업로드
  // 내역". Honors the VITE_USE_MOCKS demo escape hatch. Mirrors the other *Strict
  // reads.
  async getSyncJobsStrict(): Promise<SyncJobView[]> {
    if (USE_MOCKS) {
      return mockSyncJobs();
    }
    const { data } = await http.get<SyncJobView[]>("/api/sync-jobs");
    return data;
  },

  async registerFileChannel(channelId: string, alias: string): Promise<SellerAccountResponse> {
    const { data } = await http.post<SellerAccountResponse>(
      "/api/seller-accounts/file-channel",
      { channelId, alias },
    );
    return data;
  },

  // Mutating: start an official-API channel connection — find-or-create the PENDING API-mode seller
  // account the guided-connection wizard attaches credentials to. Idempotent server-side (re-entering
  // returns the existing account, never downgrading a settled one), and it records the account only:
  // no secret, no live provider call. No mock fallback — like registerFileChannel it requires a live
  // backend and must fail closed (never a fake account) so the wizard cannot proceed against nothing.
  async createApiChannelAccount(channelId: string): Promise<SellerAccountResponse> {
    const { data } = await http.post<SellerAccountResponse>(
      "/api/seller-accounts/api-channel",
      { channelId },
    );
    return data;
  },

  // Mutating: no mock fallback. Requires a live backend; surfaces errors to the UI.
  async uploadFile(channelId: string, uploadType: UploadType, file: File): Promise<IngestResult> {
    const form = new FormData();
    form.append("channelId", channelId);
    form.append("uploadType", uploadType);
    form.append("file", file);
    const { data } = await http.post<IngestResult>("/api/uploads", form);
    return data;
  },

  // --- NAVER Initial Review Import (V1). All strict (mutating or feature-scoped): surface errors to the UI. ---
  async createReviewImportPlan(req: CreateReviewImportPlanRequest): Promise<ReviewImportPlanDetailView> {
    const { data } = await http.post<ReviewImportPlanDetailView>("/api/imports/reviews/plans", req);
    return data;
  },
  async listReviewImportPlans(accountId?: string): Promise<ReviewImportPlanView[]> {
    const query = accountId ? `?accountId=${accountId}` : "";
    const { data } = await http.get<ReviewImportPlanView[]>(`/api/imports/reviews/plans${query}`);
    return data;
  },
  async getReviewImportPlan(planId: string): Promise<ReviewImportPlanDetailView> {
    const { data } = await http.get<ReviewImportPlanDetailView>(`/api/imports/reviews/plans/${planId}`);
    return data;
  },
  async splitReviewImportSegment(segmentId: string, children: DateRangeView[]): Promise<ReviewImportSegmentView[]> {
    const { data } = await http.post<ReviewImportSegmentView[]>(
      `/api/imports/reviews/segments/${segmentId}/split`,
      { children },
    );
    return data;
  },
  async mergeReviewImportSegments(planId: string, segmentIds: string[]): Promise<ReviewImportSegmentView> {
    const { data } = await http.post<ReviewImportSegmentView>(
      `/api/imports/reviews/plans/${planId}/merge`,
      { segmentIds },
    );
    return data;
  },
  async markReviewImportSegmentMissing(segmentId: string): Promise<ReviewImportSegmentView> {
    const { data } = await http.post<ReviewImportSegmentView>(`/api/imports/reviews/segments/${segmentId}/missing`);
    return data;
  },
  // The PRODUCT path: the seller chooses how far back to import, then each month is one guided Action Window
  // run. They never handle a file. `launchRef` is an opaque single-use authorization — never rendered, only
  // handed to the local agent.
  //
  // What starting from `startMonth` would create, WITHOUT creating it: the period and how many monthly exports
  // it becomes. Both come from the server — "today" is its clock, and the count has to be the one the planner
  // will really produce.
  async previewReviewImportRange(accountId: string, startMonth: string): Promise<ReviewImportRangeSelectionView> {
    const { data } = await http.get<ReviewImportRangeSelectionView>(
      `/api/imports/reviews/plans/range-preview?accountId=${accountId}&startMonth=${startMonth}`,
    );
    return data;
  },
  // Create the plan the seller confirmed. This replaced a guided range-DISCOVERY run: the 2026-07-25 live run
  // established that NAVER's review calendar restricts nothing, so how far back to import is the seller's own
  // decision and needs no marketplace window.
  async selectReviewImportRange(accountId: string, startMonth: string): Promise<ReviewImportPlanDetailView> {
    const { data } = await http.post<ReviewImportPlanDetailView>("/api/imports/reviews/plans/selected-range", {
      sellerAccountId: accountId,
      startMonth,
    });
    return data;
  },
  async launchNextReviewImportSegment(planId: string): Promise<ReviewImportLaunchView> {
    const { data } = await http.post<ReviewImportLaunchView>(
      `/api/imports/reviews/plans/${planId}/launches/next-segment`,
    );
    return data;
  },
  /**
   * **"Get this account's new reviews" — one call, and no plan on screen.**
   *
   * The conversation lane used to stitch this itself: list the plans, create one from the first of the
   * current month if none was open, extend, then ask for the next segment. The month it guessed had
   * nothing to do with what the account had already covered, which is how a seller ended up abandoning a
   * plan, typing dates and merging segments to ask a question the product could answer. The server derives
   * the period from this account's verified coverage instead.
   */
  async launchNextReviewImportForAccount(accountId: string): Promise<ReviewImportLaunchView> {
    const { data } = await http.post<ReviewImportLaunchView>(
      `/api/imports/reviews/plans/next-launch?accountId=${encodeURIComponent(accountId)}`,
    );
    return data;
  },
  async launchReviewImportSegment(segmentId: string): Promise<ReviewImportLaunchView> {
    const { data } = await http.post<ReviewImportLaunchView>(
      `/api/imports/reviews/segments/${segmentId}/launch`,
    );
    return data;
  },
  // Carry an existing plan forward to cover the period that has arrived since it was last extended,
  // up to today. Idempotent on the server; returns the refreshed plan (a COMPLETED plan reopens to
  // ACTIVE with the new PENDING segment as its next). The repeated loop's incremental step.
  async extendReviewImportPlan(planId: string): Promise<ReviewImportPlanDetailView> {
    const { data } = await http.post<ReviewImportPlanDetailView>(
      `/api/imports/reviews/plans/${planId}/extend`,
    );
    return data;
  },
  // The loop's completion result + change summary for one account, derived at read time.
  async getReviewOpsLoopSummary(accountId: string, referenceDate?: string): Promise<ReviewOpsLoopSummary> {
    const ref = referenceDate ? `&referenceDate=${referenceDate}` : "";
    const { data } = await http.get<ReviewOpsLoopSummary>(
      `/api/review-ops/loop-summary?accountId=${accountId}${ref}`,
    );
    return data;
  },
  async expireReviewImportLaunch(launchRef: string): Promise<ReviewImportLaunchView> {
    const { data } = await http.post<ReviewImportLaunchView>(
      `/api/imports/reviews/launches/${launchRef}/expire`,
    );
    return data;
  },

  // The FALLBACK path (파일로 가져오기): only for when a guided run is unavailable. Not the default.
  async importReviewImportSegment(
    segmentId: string,
    scopeConfirmed: boolean,
    file: File,
  ): Promise<ReviewImportAttemptView> {
    const form = new FormData();
    form.append("scopeConfirmed", String(scopeConfirmed));
    form.append("file", file);
    const { data } = await http.post<ReviewImportAttemptView>(
      `/api/imports/reviews/segments/${segmentId}/import`,
      form,
    );
    return data;
  },
  async getReviewImportSegmentAttempts(segmentId: string): Promise<ReviewImportAttemptView[]> {
    const { data } = await http.get<ReviewImportAttemptView[]>(
      `/api/imports/reviews/segments/${segmentId}/attempts`,
    );
    return data;
  },
  async getReviewImportHealth(accountId: string): Promise<ReviewImportHealthView> {
    const { data } = await http.get<ReviewImportHealthView>(
      `/api/imports/reviews/health?accountId=${accountId}`,
    );
    return data;
  },
  async abandonReviewImportPlan(planId: string): Promise<ReviewImportPlanView> {
    const { data } = await http.post<ReviewImportPlanView>(`/api/imports/reviews/plans/${planId}/abandon`);
    return data;
  },

  // --- Scheduled collection (Phase 3B Slice 7) ---

  getSchedules: (accountId: string): Promise<ScheduleView[]> =>
    getOrMock(`/api/seller-accounts/${accountId}/schedule`, mockSchedules),
  getConnectionStatus: (accountId: string): Promise<ConnectionStatusView> =>
    getOrMock(`/api/seller-accounts/${accountId}/connection-status`, mockConnectionStatus),
  // No silent mock fallback: an empty capability list means "default-allowed",
  // so falling back to [] on a dead backend would invert the gating. Failures
  // must surface so the page can fail closed instead.
  async getChannelCapabilities(channelCode: string): Promise<CapabilityView[]> {
    if (USE_MOCKS) {
      return mockCapabilities(channelCode);
    }
    const { data } = await http.get<CapabilityView[]>(`/api/channels/${channelCode}/capabilities`);
    return data;
  },
  getSyncRuns: (filters: SyncRunFilters = {}): Promise<SyncRunView[]> => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return getOrMock(`/api/sync-runs${query ? `?${query}` : ""}`, mockSyncRuns);
  },

  // Mutating collection controls: no mock fallback; errors surface to the UI.
  async putSchedule(
    accountId: string,
    body: { dataType: string; intervalMinutes: number; enabled: boolean },
  ): Promise<ScheduleView> {
    const { data } = await http.put<ScheduleView>(`/api/seller-accounts/${accountId}/schedule`, body);
    return data;
  },

  async manualSync(accountId: string, dataType: string): Promise<SyncRunView> {
    const { data } = await http.post<SyncRunView>(`/api/seller-accounts/${accountId}/sync`, { dataType });
    return data;
  },

  async retryRun(runId: string): Promise<SyncRunView> {
    const { data } = await http.post<SyncRunView>(`/api/sync-runs/${runId}/retry`);
    return data;
  },

  // --- Operator dashboard + backfill ---

  // Channel-generic capability overview (in-code connector capabilities + honest
  // unsupported scopes). No silent mock fallback: a dead backend must fail closed
  // rather than render fake CONFIRMED badges. Honors the VITE_USE_MOCKS escape hatch.
  async getChannelCapabilityOverview(channelCode: string): Promise<ChannelCapabilityOverview> {
    if (USE_MOCKS) {
      return mockCapabilityOverview(channelCode);
    }
    const { data } = await http.get<ChannelCapabilityOverview>(
      `/api/channels/${channelCode}/capabilities/overview`,
    );
    return data;
  },
  // Per-account dashboard summary over an explicit [from, to] window (KST dates).
  // Fail-closed read so a dead backend never renders demo numbers as real.
  async getAccountDashboard(
    accountId: string,
    range: { from: string; to: string },
  ): Promise<AccountDashboardSummary> {
    if (USE_MOCKS) {
      return mockAccountDashboard(accountId, range);
    }
    const search = new URLSearchParams({ from: range.from, to: range.to });
    const { data } = await http.get<AccountDashboardSummary>(
      `/api/seller-accounts/${accountId}/dashboard?${search.toString()}`,
    );
    return data;
  },
  // Metadata-only article drill-down for one type (REVIEW / INQUIRY), paginated.
  async getAccountArticles(
    accountId: string,
    params: { type: string; page?: number; size?: number },
  ): Promise<ArticleListResponse> {
    if (USE_MOCKS) {
      return mockAccountArticles(params.type, params.page ?? 0, params.size ?? 20);
    }
    const search = new URLSearchParams({ type: params.type });
    if (params.page != null) {
      search.set("page", String(params.page));
    }
    if (params.size != null) {
      search.set("size", String(params.size));
    }
    const { data } = await http.get<ArticleListResponse>(
      `/api/seller-accounts/${accountId}/articles?${search.toString()}`,
    );
    return data;
  },
  // Mutating: operator-initiated bounded date-window backfill (one data type). No
  // mock fallback; errors surface to the UI.
  async backfill(accountId: string, request: BackfillRequest): Promise<SyncRunView> {
    const { data } = await http.post<SyncRunView>(
      `/api/seller-accounts/${accountId}/backfill`,
      request,
    );
    return data;
  },
  // The org's most recent REVIEW imports, newest first — the seller's own record of what their
  // exports and uploads brought. Fail-closed like the attention reads: a dead backend must surface as
  // an error, never as "아직 가져온 기록이 없어요", which would read as reassurance.
  //
  // The server filters to review imports IN THE QUERY and limits after, so this is the newest N
  // review imports rather than the review imports inside the newest N jobs.
  async getReviewImportsStrict(limit?: number): Promise<ReviewImport[]> {
    // Demo mode is a coherent fixture world, not a broken one: without this the rail is the only
    // panel on /operations that renders an error, which reads as a bug rather than as a demo.
    if (USE_MOCKS) {
      return mockReviewImports(limit);
    }
    const search = limit == null ? "" : `?limit=${limit}`;
    const { data } = await http.get<ReviewImport[]>(`/api/imports/reviews${search}`);
    return data;
  },
  // Channel-generic operator attention signals over an explicit [from, to] window.
  // Fail-closed read so a dead backend never renders demo action items as real.
  async getAccountAttention(
    accountId: string,
    range: { from: string; to: string },
  ): Promise<OperatorAttentionSummary> {
    if (USE_MOCKS) {
      return mockAccountAttention(accountId, range);
    }
    const search = new URLSearchParams({ from: range.from, to: range.to });
    const { data } = await http.get<OperatorAttentionSummary>(
      `/api/seller-accounts/${accountId}/attention?${search.toString()}`,
    );
    return data;
  },
  // 내 답변 작업: the operator's OWN committed reply work + a bounded recently-reported record.
  // Deliberately NOT window-scoped — a commitment is theirs until finished or abandoned, so this
  // read must survive a reload, a window change and a new session. Fail-closed like the others.
  async getReplyWork(
    accountId: string,
    /**
     * `productId` narrows the to-do to one product — the 리뷰 surface scoped by a doorway from 상품.
     * It is asked of the SERVER rather than filtered here because this surface's rows carry no product
     * identifier: a fence scans the serialized page for one, and `productName` is a display name that
     * two products can share.
     */
    limits?: { todoLimit?: number; recentLimit?: number; productId?: string },
  ): Promise<OperatorReplyWorkView> {
    if (USE_MOCKS) {
      return mockReplyWork(accountId);
    }
    const search = new URLSearchParams();
    if (limits?.todoLimit != null) search.set("todoLimit", String(limits.todoLimit));
    if (limits?.recentLimit != null) search.set("recentLimit", String(limits.recentLimit));
    if (limits?.productId) search.set("productId", limits.productId);
    const qs = search.toString();
    const { data } = await http.get<OperatorReplyWorkView>(
      `/api/seller-accounts/${accountId}/reply-work${qs ? `?${qs}` : ""}`,
    );
    return data;
  },
  // 제외한 작업: one page of the reviews the operator has set aside, so they can restore one. NOT
  // window-scoped (a set-aside review stays reachable at any age), paged with `hasMore` ("더 보기")
  // rather than a hard cap. Fail-closed and coverage-guarded like the reply-work read.
  async getDismissedReplyWork(
    accountId: string,
    params?: { page?: number; size?: number },
  ): Promise<OperatorDismissedReplyWorkView> {
    if (USE_MOCKS) {
      return mockDismissedReplyWork(accountId, params);
    }
    const search = new URLSearchParams();
    if (params?.page != null) search.set("page", String(params.page));
    if (params?.size != null) search.set("size", String(params.size));
    const qs = search.toString();
    const { data } = await http.get<OperatorDismissedReplyWorkView>(
      `/api/seller-accounts/${accountId}/reply-work/dismissed${qs ? `?${qs}` : ""}`,
    );
    return data;
  },
  // Drill-down: the metadata-only rows behind one attention signal (by signal type)
  // over the same [from, to] window, paginated. Fail-closed, like the summary read.
  async getAttentionItems(
    accountId: string,
    params: {
      type: string;
      from: string;
      to: string;
      // Optional classification facet: a stored category, or "unclassified" for rows nothing
      // has analyzed. Omitted means no narrowing. Sent verbatim — the server validates it and
      // answers an unrecognised value with a 400 rather than an empty page, so this must not
      // pre-filter or silently drop one.
      category?: string;
      page?: number;
      size?: number;
    },
  ): Promise<OperatorVocItemPage> {
    if (USE_MOCKS) {
      return mockAttentionItems(accountId, params, params.page ?? 0, params.size ?? 20);
    }
    const search = new URLSearchParams({ type: params.type, from: params.from, to: params.to });
    if (params.category != null) {
      search.set("category", params.category);
    }
    if (params.page != null) {
      search.set("page", String(params.page));
    }
    if (params.size != null) {
      search.set("size", String(params.size));
    }
    const { data } = await http.get<OperatorVocItemPage>(
      `/api/seller-accounts/${accountId}/attention/items?${search.toString()}`,
    );
    return data;
  },
  // Mutating: record the operator's decision about one drill-down row.
  //
  // Honors VITE_USE_MOCKS like the reads beside it, but takes NO getOrMock fallback: a
  // dead backend must fail loudly here. The distinction is the one product scope already
  // draws — mock data is allowed in an explicitly separated demo mode, never as a silent
  // degradation of a real one. Without the demo branch the mixed rows would render controls
  // where every click errors, which looks more broken than no control at all.
  //
  // `actionRef` is the opaque handle the drill-down handed out; it is round-tripped, never
  // parsed. It is percent-encoded because it is a server-minted token interpolated into a
  // path: today's `review:<uuid>` needs only the colon escaped, and the backend receives
  // the identical decoded string either way — but the contract says the ref is opaque and
  // its format will grow, so encoding is the only form that stays correct without betting
  // on the alphabet.
  //
  // `commandId` is the caller's idempotency key and must be STABLE across retries of the
  // same user action (see VocItemTriageControl): a fresh id per retry would append a
  // second identical decision to the audit trail instead of replaying the first. Reusing
  // one for a DIFFERENT decision is a 409 — that is the caller's bug, not a state to
  // recover from.
  //
  // The caller classifies the thrown axios error: 400 (bad ref/disposition), 404 (not
  // addressable from this account), 409 (commandId reused for another decision).
  async recordVocItemTriage(
    accountId: string,
    actionRef: string,
    body: { commandId: string; disposition: TriageDisposition },
  ): Promise<TriageDecisionResponse> {
    if (USE_MOCKS) {
      return mockVocItemTriage(actionRef, body.disposition);
    }
    const { data } = await http.post<TriageDecisionResponse>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/triage`,
      body,
    );
    return data;
  },

  /**
   * The same decision, addressed by the review alone.
   *
   * No `actionRef`: the path already names the review, and a ref that decodes to the same id would be
   * a second address for one object. Idempotency is unchanged — same `commandId` contract, same
   * replay/409 semantics — because the write underneath is the same one.
   */
  async recordReviewDecision(
    reviewId: string,
    body: { commandId: string; disposition: TriageDisposition },
  ): Promise<TriageDecisionResponse> {
    if (USE_MOCKS) {
      return mockVocItemTriage(`review:${reviewId}`, body.disposition);
    }
    const { data } = await http.post<TriageDecisionResponse>(
      `/api/reviews/${encodeURIComponent(reviewId)}/decision`,
      body,
    );
    return data;
  },

  // --- Review response preparation ------------------------------------------------
  //
  // All three round-trip `actionRef` percent-encoded, for the reason recordVocItemTriage
  // states: it is opaque, and its format will grow.

  // Everything the preparation panel needs for one review, in one read.
  //
  // Fail-closed, like both attention reads: no getOrMock fallback. A silent fall back here
  // would be worse than on a list — it would show the operator a suggested reply, a draft,
  // and a copy button belonging to a review that is not the one in front of them.
  async getReviewReplyPrep(accountId: string, actionRef: string): Promise<ReviewReplyPrep> {
    if (USE_MOCKS) {
      return mockReviewReplyPrep(actionRef);
    }
    const { data } = await http.get<ReviewReplyPrep>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply`,
    );
    return data;
  },

  // Save one append-only draft version.
  //
  // PUT, and `baseVersion` — not a command id — is what makes a retry safe: an exact
  // re-send of the same content on the same base inserts nothing and returns the head. A
  // stale base is a 409 the caller must re-base on rather than retry.
  //
  // The caller classifies the thrown axios error: 400 (blank/over-long body, missing
  // base), 404 (not addressable from this account), 409 (stale base, review not
  // RESPONSE_NEEDED, or a draft frozen by a standing approval).
  async saveReviewReplyDraft(
    accountId: string,
    actionRef: string,
    body: { body: string; baseVersion: number },
  ): Promise<ReviewReplyDraft> {
    if (USE_MOCKS) {
      return mockSaveReviewReplyDraft(actionRef, body.body, body.baseVersion);
    }
    const { data } = await http.put<ReviewReplyDraft>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply/draft`,
      body,
    );
    return data;
  },

  // Grounded Review Drafting v1: write ONE new draft version from the seller's own knowledge.
  //
  // No body — the review is the URL and the composer reads everything else. It writes an
  // append-only version through the same path a typed save uses, spends at most one model call
  // against the org's daily AI budget, approves nothing and reaches no marketplace. 409 when the
  // review is not RESPONSE_NEEDED, when an approval stands (the freeze), or when this deployment
  // has no composer wired.
  async generateReviewReplyDraft(accountId: string, actionRef: string): Promise<GeneratedReviewDraftView> {
    const { data } = await http.post<GeneratedReviewDraftView>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply/draft/generate`,
      {},
      { timeout: MODEL_TIMEOUT_MS },
    );
    return data;
  },

  // --- Knowledge Sources & Acquisition v1 -----------------------------------------
  //
  // How knowledge gets IN. Every call here writes into the corpora that already exist and is read
  // back by the retrieval that already exists; none of them sends, approves or reaches a channel.

  // Bring in one document the seller already has. Multipart, because they have a file.
  async importKnowledgeDocument(input: {
    scope: "PRODUCT" | "ORG";
    productId?: string | null;
    sourceType?: string | null;
    orgType?: string | null;
    file: File;
  }): Promise<KnowledgeDocumentView> {
    const form = new FormData();
    form.append("file", input.file);
    const params = new URLSearchParams({ scope: input.scope });
    if (input.productId) params.set("productId", input.productId);
    if (input.sourceType) params.set("sourceType", input.sourceType);
    if (input.orgType) params.set("orgType", input.orgType);
    const { data } = await http.post<KnowledgeDocumentView>(
      `/api/knowledge/documents?${params.toString()}`,
      form,
      // Reading a PDF is server-side work, not a database read: the shared 8s bound is the wrong one.
      { timeout: MODEL_TIMEOUT_MS, headers: { "Content-Type": "multipart/form-data" } },
    );
    return data;
  },

  // Every document, or one product's. The product screen passes an id so it does not read a
  // three-hundred-product company's material to list one product's two files.
  async getKnowledgeDocuments(productId?: string): Promise<KnowledgeDocumentView[]> {
    const { data } = await http.get<KnowledgeDocumentView[]>(
      productId
        ? `/api/knowledge/documents?productId=${encodeURIComponent(productId)}`
        : "/api/knowledge/documents",
    );
    return data;
  },

  // What reviewnary knows, as numbers — the 「알고 있는 정보」 line.
  async getKnowledgeSummary(): Promise<KnowledgeSummaryView> {
    const { data } = await http.get<KnowledgeSummaryView>("/api/knowledge/summary");
    return data;
  },

  // What reviewnary learned from the company's operating history, per source and per channel.
  async getLearnedKnowledge(): Promise<LearnedKnowledgeResponse> {
    const { data } = await http.get<LearnedKnowledgeResponse>("/api/knowledge/learned");
    return data;
  },

  // Read the seller's own channel history now (bounded READ) and learn from it. Never writes to a channel.
  async learnFromHistory(): Promise<LearnedKnowledgeResponse> {
    const { data } = await http.post<LearnedKnowledgeResponse>("/api/knowledge/learned/bootstrap");
    return data;
  },

  // Retire or restore. The row stays, so citations that stood on it still resolve.
  async setKnowledgeDocumentActive(sourceId: string, active: boolean): Promise<KnowledgeDocumentView> {
    const { data } = await http.post<KnowledgeDocumentView>(
      `/api/knowledge/documents/${encodeURIComponent(sourceId)}/active?active=${active}`,
    );
    return data;
  },

  async getKnowledgeCandidates(): Promise<KnowledgeCandidateView[]> {
    const { data } = await http.get<KnowledgeCandidateView[]>("/api/knowledge/candidates");
    return data;
  },

  // Look through this seller's own past answers for sentences they keep writing. A count, not a
  // judgement: deterministic, idempotent, and it promotes nothing.
  async proposeKnowledgeCandidates(): Promise<KnowledgeCandidateView[]> {
    const { data } = await http.post<KnowledgeCandidateView[]>("/api/knowledge/candidates/propose");
    return data;
  },

  async acceptKnowledgeCandidate(
    candidateId: string,
    body: {
      title?: string;
      content?: string;
      sourceType?: string;
      orgType?: string;
      /** The 규격 the seller chose, so the one write that closes the ask carries it too. */
      variantId?: string | null;
    },
  ): Promise<KnowledgeCandidateView> {
    const { data } = await http.post<KnowledgeCandidateView>(
      `/api/knowledge/candidates/${encodeURIComponent(candidateId)}/accept`,
      body,
    );
    return data;
  },

  async dismissKnowledgeCandidate(candidateId: string): Promise<KnowledgeCandidateView> {
    const { data } = await http.post<KnowledgeCandidateView>(
      `/api/knowledge/candidates/${encodeURIComponent(candidateId)}/dismiss`,
    );
    return data;
  },

  // Approve the current draft, or withdraw a standing approval.
  //
  // POST with a client-minted `commandId`, unlike the draft PUT beside it. The difference
  // is what a retry must be idempotent against: a draft save carries its own content, so a
  // re-send is recognisable by that content, whereas "approve" carries almost nothing —
  // two approvals of the same version are indistinguishable without a key, and a retried
  // timeout must not append a second decision to the trail. So `commandId` must be STABLE
  // across retries of one user action and fresh for a new one, exactly as on triage.
  //
  // `baseVersion` is the version being approved (required for APPROVED, null for
  // WITHDRAWN). It is what stops approving a version the operator never saw.
  //
  // Returns the CURRENT state, which may not be the one asked for on a replay. It
  // deliberately does NOT carry the approved body — the caller re-reads the prep view for
  // that, so there is exactly one way to obtain copyable text rather than two that could
  // disagree.
  async decideReviewReplyApproval(
    accountId: string,
    actionRef: string,
    body: { commandId: string; state: ReviewReplyApprovalStateName; baseVersion: number | null },
  ): Promise<ReviewReplyApprovalResponse> {
    if (USE_MOCKS) {
      return mockDecideReviewReplyApproval(actionRef, body.state, body.baseVersion);
    }
    const { data } = await http.post<ReviewReplyApprovalResponse>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply/approval`,
      body,
    );
    return data;
  },

  // v1.6: start a GUIDED Action Window reply-submission run — mint a single-use `submissionRef`
  // bound to the current approved head. No body: the run is always bound to the review's current
  // approval. Still no send behind it: the operator posts the reply themselves; SellerOps guides
  // and observes. Fail-closed like the reads above. 409 when not RESPONSE_NEEDED or nothing approved.
  async startReviewReplySubmissionRun(
    accountId: string,
    actionRef: string,
  ): Promise<ReviewReplySubmissionRunResponse> {
    if (USE_MOCKS) {
      return mockStartReviewReplySubmissionRun(actionRef);
    }
    const { data } = await http.post<ReviewReplySubmissionRunResponse>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply/submission-run`,
      {},
    );
    return data;
  },

  // v2 channel-capability completion: EXECUTE an approved Cafe24 review reply through the backend's
  // review comment adapter — the ONE marketplace WRITE of the review lane. `commandId` is minted per
  // press; `expectedFingerprint` binds the write to the approved head the seller read. 409 when the
  // approval moved or the fingerprint no longer matches; 4xx when this deployment cannot execute.
  // Never retried by the client; an ambiguous result is read back with `getReviewReplyExecution`.
  async executeReviewReply(
    accountId: string,
    actionRef: string,
    body: { commandId: string; expectedFingerprint: string },
  ): Promise<ReviewExecutionView> {
    const { data } = await http.post<ReviewExecutionView>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply/execute`,
      body,
    );
    return data;
  },

  // Read-back of the execution row (both the API lane and the NAVER guided lane's observed states).
  // Null when nothing has been recorded for this review yet.
  async getReviewReplyExecution(accountId: string, actionRef: string): Promise<ReviewExecutionView | null> {
    try {
      const { data } = await http.get<ReviewExecutionView>(
        `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply/execution`,
      );
      return data;
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }
  },

  // v2: mint a single-use `acquisitionRef` for a Coupang WING review read run (Action Window
  // `START_RUN(REVIEW_ACQUISITION)`). COUPANG only server-side; the ref carries no review identity.
  // Which store this account IS (Coupang 업체코드) — a non-secret fact about the account, never a
  // credential. Answers with the readiness it changed, so a screen that just supplied the missing piece
  // learns whether anything else is still missing without a second call.
  async setStoreIdentity(accountId: string, storeIdentity: string): Promise<ReviewAcquisitionReadinessResponse> {
    const { data } = await http.put<ReviewAcquisitionReadinessResponse>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/store-identity`,
      { storeIdentity },
    );
    return data;
  },

  // Can this account start a screen read at all — the three preconditions the mint enforces, asked
  // without minting. No marketplace request is made by this call, on this path or behind it.
  async getReviewAcquisitionReadiness(accountId: string): Promise<ReviewAcquisitionReadinessResponse> {
    const { data } = await http.get<ReviewAcquisitionReadinessResponse>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/review-acquisition-readiness`,
    );
    return data;
  },

  async startReviewAcquisitionRun(accountId: string): Promise<ReviewAcquisitionRunResponse> {
    const { data } = await http.post<ReviewAcquisitionRunResponse>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/review-acquisition-runs`,
      {},
    );
    return data;
  },

  // v1.6: record the operator's report about their own manual post — a LOCAL, operator-reported,
  // explicitly UNVERIFIED fact, never a channel claim. `commandId` is the client idempotency key
  // (stable across retries of one report, fresh for a new one); `submissionRef` is the single-use
  // binding; `operatorOutcome` is what the operator reports; `awRunRef` is the opaque guided-run id,
  // ABSENT when the seller posted manually with no guided run.
  // The response carries no body. 409 when the binding is spent, stale, or the review is not
  // RESPONSE_NEEDED.
  // 작업에서 제외: set one review aside from the 내 답변 작업 to-do. Writes NOTHING about the reply —
  // no draft change, no outcome, no completion. Idempotent on commandId; the review re-enters on its
  // own once re-marked 대응 필요 or a new draft is saved.
  async dismissReplyWork(
    accountId: string,
    actionRef: string,
    body: { commandId: string },
  ): Promise<ReviewReplyWorkDismissalResponse> {
    if (USE_MOCKS) {
      return mockDismissReplyWork(actionRef);
    }
    const { data } = await http.post<ReviewReplyWorkDismissalResponse>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply-work/dismiss`,
      body,
    );
    return data;
  },
  // 복원: bring one set-aside review back onto the 내 답변 작업 to-do. Writes NOTHING about the reply —
  // no draft change, no disposition change, no outcome, no completion. Idempotent on commandId; it
  // outranks (never deletes) the dismissal it reverses.
  async restoreReplyWork(
    accountId: string,
    actionRef: string,
    body: { commandId: string },
  ): Promise<ReviewReplyWorkRestoreResponse> {
    if (USE_MOCKS) {
      return mockRestoreReplyWork(actionRef);
    }
    const { data } = await http.post<ReviewReplyWorkRestoreResponse>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply-work/restore`,
      body,
    );
    return data;
  },
  async recordReviewReplyOutcome(
    accountId: string,
    actionRef: string,
    body: {
      commandId: string;
      submissionRef: string;
      operatorOutcome: OperatorOutcomeName;
      /** Omitted for a MANUAL post: production may not mint a run identity for a run that did not happen. */
      awRunRef?: string;
    },
  ): Promise<ReviewReplyOutcomeResponse> {
    if (USE_MOCKS) {
      return mockRecordReviewReplyOutcome(actionRef, body.submissionRef, body.operatorOutcome, body.awRunRef);
    }
    const { data } = await http.post<ReviewReplyOutcomeResponse>(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(actionRef)}/reply/outcome`,
      body,
    );
    return data;
  },

  // --- Review Issue Memory ---------------------------------------------------
  //
  // STRICT: no mock FALLBACK. These endpoints answer "has something changed in
  // what customers are telling you", and seeded data standing in for a failed
  // read would be a fabricated answer to that question. A dead backend still
  // fails here, loudly — that rule is unchanged.
  //
  // The explicit `VITE_USE_MOCKS` demo switch IS now honored, which it was not
  // before. The original reason for excluding it was that "the operator cannot
  // tell the difference"; the v2 shell renders a permanent, non-dismissible demo
  // notice whenever that flag is on, so they can. The distinction that matters is
  // preserved: opting into a demo is a choice, silently substituting seeded data
  // for a broken read is not.

  /**
   * One page of ONE product's reviews — the door behind the 상품 screen's 리뷰 figure.
   *
   * STRICT, and deliberately not the window read (`/api/reviews/recent`): that one is scoped to the
   * seller-visible channels, and the figure this list stands under is not. A door that opened a
   * narrower set than the number it was pressed on would be a broken promise, so the server answers
   * with the figure's own predicate and this client asks for nothing more.
   */
  async getProductReviews(
    productId: string,
    options: { page?: number; size?: number } = {},
  ): Promise<ProductReviewPage> {
    const params = new URLSearchParams();
    if (options.page != null) params.set("page", String(options.page));
    if (options.size != null) params.set("size", String(options.size));
    const qs = params.toString();
    const { data } = await http.get<ProductReviewPage>(
      `/api/products/${encodeURIComponent(productId)}/reviews${qs ? `?${qs}` : ""}`,
    );
    return data;
  },

  /**
   * The working list, or the 중요하지 않음 list when `dismissed` is true. Two calls rather than one
   * merged list, so issues the operator set aside never reappear among the ones asking for attention.
   */
  async getReviewIssuesStrict(
    options: { referenceDate?: string; dismissed?: boolean } = {},
  ): Promise<ReviewIssueView[]> {
    const params = new URLSearchParams();
    if (options.referenceDate) {
      params.set("referenceDate", options.referenceDate);
    }
    if (options.dismissed) {
      params.set("dismissed", "true");
    }
    if (USE_MOCKS) {
      return mockReviewIssues(options.dismissed === true);
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    const { data } = await http.get<ReviewIssueView[]>(`/api/review-issues${query}`);
    return data;
  },

  async getReviewIssueDetailStrict(
    issueId: string,
    referenceDate?: string,
  ): Promise<ReviewIssueDetailView> {
    if (USE_MOCKS) {
      return mockReviewIssueDetail(issueId);
    }
    const query = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
    const { data } = await http.get<ReviewIssueDetailView>(
      `/api/review-issues/${encodeURIComponent(issueId)}${query}`,
    );
    return data;
  },

  /**
   * Where a repeated problem repeats, against what, and what this company has already written about
   * it — the Repeated Issue workspace's second read.
   *
   * <b>Never mocked, deliberately.</b> A mock here would invent a denominator: a made-up 「리뷰 300건
   * 중 12건」 is a claim about a seller's catalogue that no row supports, and it is exactly the number
   * a person would act on. A failed read renders nothing rather than a fixture.
   */
  /**
   * Operations Home's one read — what to check now, org-wide and bounded.
   *
   * <b>Never mocked.</b> A fixture here would invent a seller's morning: a made-up 「확인 필요 4건」 is
   * the number a person acts on first, and it would be the first thing they saw. A failed read leaves
   * the areas unrendered and the conversation below untouched.
   */
  async getOperationsHomeStrict(): Promise<OperationsHome> {
    const { data } = await http.get<OperationsHome>("/api/operations/home");
    return data;
  },

  /**
   * 「고객 운영 관리」 (Responsibility Runtime v1) — the job, its recent checks, and whether this organisation may take
   * it on at all. Never mocked: a fixture here would claim a job is running for a seller who never delegated one.
   */
  async getCustomerOperations(): Promise<ResponsibilityView> {
    const { data } = await http.get<ResponsibilityView>("/api/responsibilities/customer-operations");
    return data;
  },
  async activateCustomerOperations(): Promise<ResponsibilityView> {
    const { data } = await http.post<ResponsibilityView>("/api/responsibilities/customer-operations/activate");
    return data;
  },
  async pauseCustomerOperations(): Promise<ResponsibilityView> {
    const { data } = await http.post<ResponsibilityView>("/api/responsibilities/customer-operations/pause");
    return data;
  },
  async resumeCustomerOperations(): Promise<ResponsibilityView> {
    const { data } = await http.post<ResponsibilityView>("/api/responsibilities/customer-operations/resume");
    return data;
  },
  async stopCustomerOperations(): Promise<ResponsibilityView> {
    const { data } = await http.post<ResponsibilityView>("/api/responsibilities/customer-operations/stop");
    return data;
  },
  /**
   * One customer-operations case, and the three things a seller may do on it: teach the missing knowledge, rewrite
   * the prepared draft, correct the recommendation. Never mocked — a fixture here would invent a seller's case.
   */
  async getOperationsCase(caseId: string): Promise<OperationsCaseDetail> {
    const { data } = await http.get<OperationsCaseDetail>(`/api/responsibilities/customer-operations/cases/${caseId}`);
    return data;
  },
  // One review photo of a case, as a data: URL — the endpoint needs the bearer token (a plain <img> cannot send it)
  // and the app's image policy admits data: but not blob:.
  async getOperationsCaseMedia(caseId: string, ordinal: number): Promise<string> {
    const response = await http.get<ArrayBuffer>(
      `/api/responsibilities/customer-operations/cases/${caseId}/media/${ordinal}`,
      { responseType: "arraybuffer" },
    );
    const type = String(response.headers["content-type"] ?? "image/jpeg").split(";")[0];
    const bytes = new Uint8Array(response.data);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return `data:${type};base64,${btoa(binary)}`;
  },
  /**
   * Saves the seller's knowledge, then re-investigates and re-drafts the case on the server — two model calls in
   * sequence before the response. Under the ordinary 8s ceiling the save succeeded while the screen said it failed
   * (Past Answer Prefill browser proof, 2026-09-19: the server answered in ~17s), and a seller who then pressed again
   * would have saved the same knowledge twice. So it carries two model budgets.
   */
  async teachOperationsCase(caseId: string, input: { content: string; scope: string }): Promise<OperationsCaseDetail> {
    const { data } = await http.post<OperationsCaseDetail>(
      `/api/responsibilities/customer-operations/cases/${caseId}/teach`,
      input,
      { timeout: 2 * MODEL_TIMEOUT_MS },
    );
    return data;
  },
  async editOperationsCaseDraft(
    caseId: string,
    input: { body: string; remember: boolean; scope: string },
  ): Promise<OperationsCaseDetail> {
    const { data } = await http.post<OperationsCaseDetail>(
      `/api/responsibilities/customer-operations/cases/${caseId}/draft`,
      input,
    );
    return data;
  },
  async correctOperationsCase(
    caseId: string,
    input: { correctedActionType: string | null; note: string; remember: boolean; scope: string },
  ): Promise<OperationsCaseDetail> {
    const { data } = await http.post<OperationsCaseDetail>(
      `/api/responsibilities/customer-operations/cases/${caseId}/correction`,
      input,
    );
    return data;
  },

  /** The Home's three exception areas. A failed read draws nothing — never a clear morning. */
  async getCustomerOperationsHome(): Promise<CustomerOperationsHome> {
    const { data } = await http.get<CustomerOperationsHome>("/api/responsibilities/customer-operations/home");
    return data;
  },

  /**
   * The pilot's return-visit signal — 「이 조직이 오늘 홈을 열었다」, and nothing else.
   *
   * <b>Fire and forget, and that is the design.</b> It is awaited by nobody, its failure is swallowed
   * by the caller, and the page never shows that it happened. A measurement that can delay or break a
   * seller's morning is a measurement that will one day break a seller's morning, and the number it
   * protects — how many days they came back — is not worth one broken screen.
   *
   * Sends no body: the organisation comes from the bearer token and the day from the server's clock in
   * Asia/Seoul. There is nothing here for a request to claim about who, when, or from where.
   */
  async recordHomeOpened(): Promise<void> {
    await http.post("/api/usage/home-opened");
  },

  async getRepeatedIssueContextStrict(
    issueId: string,
    referenceDate?: string,
  ): Promise<RepeatedIssueContext> {
    const query = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
    const { data } = await http.get<RepeatedIssueContext>(
      `/api/review-issues/${encodeURIComponent(issueId)}/repeat-context${query}`,
    );
    return data;
  },

  /** 확인 필요 → 조치 중. The note is the operator's own record of what they are doing. */
  /**
   * Improvement opportunities (Opportunity Engine v1) — derived from the issue memory on every read,
   * scoped to a product or an issue when asked. Never mocked: there is no seeded fixture for a derived
   * object, and a screen that showed one would be promising a suggestion no evidence produced.
   */
  async getOpportunitiesStrict(options: {
    productId?: string | null;
    issueId?: string | null;
    includeDismissed?: boolean;
  } = {}): Promise<OpportunityView[]> {
    const params = new URLSearchParams();
    if (options.productId) params.set("productId", options.productId);
    if (options.issueId) params.set("issueId", options.issueId);
    if (options.includeDismissed) params.set("includeDismissed", "true");
    const query = params.toString();
    const { data } = await http.get<OpportunityView[]>(`/api/opportunities${query ? `?${query}` : ""}`);
    return data;
  },

  // ---- Agentic Report v1 -----------------------------------------------------------------------

  /**
   * The cadence's current report — the stored one, or the period's first generation.
   *
   * <b>A model call's budget, because on a period's first open it IS one.</b> "열기 = 읽기" is true
   * from the second open onward; the first one builds the edition, and building it narrates. Measured
   * on the demo org 2026-09-06: the backend logged `narrated=true … ms=15533` in the same second the
   * screen said 「리포트를 불러오지 못했습니다」 — the report existed, and the default 8s ceiling had
   * already given up on it. It self-heals on reload (0.005s off the snapshot), which is exactly why
   * it survived: every seller meets it once, on the open that is supposed to introduce the feature.
   */
  async getCurrentAgentReport(kind: ReportKind): Promise<AgentReportView> {
    const { data } = await http.get<AgentReportView>(`/api/agent-reports/current?kind=${kind}`,
      { timeout: MODEL_TIMEOUT_MS });
    return data;
  },

  async getAgentReport(id: string): Promise<AgentReportView> {
    const { data } = await http.get<AgentReportView>(`/api/agent-reports/${encodeURIComponent(id)}`);
    return data;
  },

  async listAgentReports(kind: ReportKind): Promise<AgentReportListItem[]> {
    const { data } = await http.get<AgentReportListItem[]>(`/api/agent-reports?kind=${kind}`);
    return data;
  },

  /**
   * A newer reading as a NEW version — explicit, never on open.
   *
   * Always narrates, by definition, so the ceiling above applies here with no "first time" about it:
   * under the default this control could only ever report failure over a version it had just written.
   */
  async regenerateAgentReport(kind: ReportKind, periodStart?: string | null): Promise<AgentReportView> {
    const params = new URLSearchParams({ kind });
    if (periodStart) params.set("periodStart", periodStart);
    const { data } = await http.post<AgentReportView>(`/api/agent-reports/regenerate?${params.toString()}`, {},
      { timeout: MODEL_TIMEOUT_MS });
    return data;
  },

  async acceptOpportunity(issueId: string, kind: OpportunityKind): Promise<OpportunityView> {
    const { data } = await http.post<OpportunityView>(opportunityPath(issueId, kind, "accept"), {});
    return data;
  },

  async dismissOpportunity(issueId: string, kind: OpportunityKind): Promise<OpportunityView> {
    const { data } = await http.post<OpportunityView>(opportunityPath(issueId, kind, "dismiss"), {});
    return data;
  },

  async restoreOpportunity(issueId: string, kind: OpportunityKind): Promise<OpportunityView> {
    const { data } = await http.post<OpportunityView>(opportunityPath(issueId, kind, "restore"), {});
    return data;
  },

  async updateOpportunityDraft(
    issueId: string,
    kind: OpportunityKind,
    draft: { title: string; body: string },
  ): Promise<OpportunityView> {
    const { data } = await http.put<OpportunityView>(opportunityPath(issueId, kind, "draft"), draft);
    return data;
  },

  async startReviewIssueAction(issueId: string, note?: string): Promise<ReviewIssueView> {
    if (USE_MOCKS) {
      return mockUpdateReviewIssue(issueId, { lifecycleState: "ACTING", lifecycleLabelKo: "조치 중" });
    }
    const { data } = await http.post<ReviewIssueView>(
      `/api/review-issues/${encodeURIComponent(issueId)}/acting`,
      { note: note ?? null },
    );
    return data;
  },

  /**
   * 조치 중 → 개선 확인 중. There is deliberately no "mark resolved" call: 해결됨 is
   * reachable only from here after enough quiet weeks, so the conclusion rests on
   * observed evidence rather than on someone asserting it.
   */
  async markReviewIssueRemediated(issueId: string, note?: string): Promise<ReviewIssueView> {
    if (USE_MOCKS) {
      return mockUpdateReviewIssue(issueId, {
        lifecycleState: "VERIFYING",
        lifecycleLabelKo: "개선 확인 중",
      });
    }
    const { data } = await http.post<ReviewIssueView>(
      `/api/review-issues/${encodeURIComponent(issueId)}/remediated`,
      { note: note ?? null },
    );
    return data;
  },

  async dismissReviewIssue(issueId: string): Promise<ReviewIssueView> {
    if (USE_MOCKS) {
      return mockUpdateReviewIssue(issueId, { dismissed: true });
    }
    const { data } = await http.post<ReviewIssueView>(
      `/api/review-issues/${encodeURIComponent(issueId)}/dismiss`,
      {},
    );
    return data;
  },

  async restoreReviewIssue(issueId: string): Promise<ReviewIssueView> {
    if (USE_MOCKS) {
      return mockUpdateReviewIssue(issueId, { dismissed: false });
    }
    const { data } = await http.post<ReviewIssueView>(
      `/api/review-issues/${encodeURIComponent(issueId)}/restore`,
      {},
    );
    return data;
  },

  /**
   * One page of a connected channel's review record. NO mock fallback, deliberately: a dead backend
   * rendering invented reviews would be the one failure a seller cannot detect — they have no other
   * copy of what buyers wrote to check it against.
   */
  async getChannelReviewsStrict(
    accountId: string,
    params: {
      sort?: "attention" | "newest" | "lowest";
      /** Narrow to one triage tier. Absent means the whole record, which is the default. */
      tier?: ReviewTriageTier;
      page?: number;
      size?: number;
    } = {},
  ): Promise<ChannelReviewPageView> {
    const query = new URLSearchParams();
    if (params.sort) query.set("sort", params.sort);
    if (params.tier) query.set("tier", params.tier);
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.size !== undefined) query.set("size", String(params.size));
    const { data } = await http.get<ChannelReviewPageView>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/channel-reviews${
        query.toString() ? `?${query}` : ""
      }`,
    );
    return data;
  },

  /**
   * One review in full, addressed by the review alone — the read the Decision Workspace opens on.
   *
   * Org-scoped from the JWT. The account segment the sibling below carries was never the
   * authorization (that is `(reviewId, orgId)`); all it did was make the address unreachable for a
   * review no account acquired — every manual upload, every seller-center export. No mock fallback:
   * a silent fallback here would show a seller a decision belonging to a review that is not theirs.
   */
  async getReviewWorkspace(reviewId: string): Promise<ChannelReviewDetailView> {
    const { data } = await http.get<ChannelReviewDetailView>(
      `/api/reviews/${encodeURIComponent(reviewId)}/workspace`,
    );
    return data;
  },

  /** The same review at the channel record's own account-scoped address. No mock fallback, as above. */
  async getChannelReviewStrict(accountId: string, reviewId: string): Promise<ChannelReviewDetailView> {
    const { data } = await http.get<ChannelReviewDetailView>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/channel-reviews/${encodeURIComponent(reviewId)}`,
    );
    return data;
  },

  /**
   * The seller pressed `[쿠팡에서 보기]`: mint the single-use binding their Local Agent will spend.
   *
   * A POST because it mints state — nothing is submitted to any marketplace by this call, or by the run it
   * starts. It returns no locate target: the agent resolves that itself, so what identifies the review never
   * passes through this browser.
   */
  async startChannelReviewLocateRun(accountId: string, reviewId: string): Promise<ChannelReviewLocateRun> {
    const { data } = await http.post<ChannelReviewLocateRun>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/channel-reviews/${encodeURIComponent(reviewId)}/locate-runs`,
      {},
    );
    return data;
  },

  // ── Review triage feedback (RUBRIC v2 §13.7) ────────────────────────────────────────────────
  //
  // Records; never changes a tier, hides a row, marks anything done, or touches a marketplace.

  /**
   * The seller's own judgment for one review — one of the three tiers. Strong evidence; supersedes
   * their previous answer and keeps it in the trail.
   *
   * Org-scoped: what a seller thinks about their own record is not addressed through an account, and
   * is never sent anywhere.
   */
  async correctReviewTriage(reviewId: string, request: TriageCorrectionRequest): Promise<TriageCorrectionView> {
    const { data } = await http.post<TriageCorrectionView>(
      `/api/reviews/${encodeURIComponent(reviewId)}/triage-feedback/correction`,
      request,
    );
    return data;
  },

  /**
   * 되돌리기 — the seller takes their correction back. The review reads as the system's judgment
   * alone again; the row and its trail are kept server-side.
   */
  async withdrawReviewTriageCorrection(reviewId: string): Promise<void> {
    await http.delete(`/api/reviews/${encodeURIComponent(reviewId)}/triage-feedback/correction`);
  },

  /**
   * What stands behind one review — repeated problems, what else said the same, what is written down.
   *
   * A SECOND read, deliberately separate from the one that opens the screen: none of it is needed to
   * answer a customer, so it must not be able to delay or fail the panel that does.
   */
  async getReviewDecisionContext(reviewId: string): Promise<ReviewDecisionContext> {
    const { data } = await http.get<ReviewDecisionContext>(
      `/api/reviews/${encodeURIComponent(reviewId)}/decision-context`,
    );
    return data;
  },

  /** What has already been decided about this review, newest first. Read from existing trails only. */
  async getReviewDecisionLog(reviewId: string): Promise<ReviewDecisionLogEntry[]> {
    const { data } = await http.get<ReviewDecisionLogEntry[]>(
      `/api/reviews/${encodeURIComponent(reviewId)}/decision-log`,
    );
    return data;
  },

  /** The review's correction trail, oldest first — what the seller said and when they changed it. */
  async getReviewCorrectionHistory(reviewId: string): Promise<TriageCorrectionHistoryView[]> {
    const { data } = await http.get<TriageCorrectionHistoryView[]>(
      `/api/reviews/${encodeURIComponent(reviewId)}/triage-feedback/correction/history`,
    );
    return data;
  },

  /** The seller acted on the review. Append-only; nothing is sent anywhere. */
  async recordReviewTriageAction(reviewId: string, kind: TriageActionKind): Promise<void> {
    await http.post(`/api/reviews/${encodeURIComponent(reviewId)}/triage-feedback/actions`, { kind });
  },

  /**
   * Silver, batched. Best-effort: a failure here is swallowed by the caller, because a trace of
   * navigation is not worth an error the seller has to read.
   */
  async recordChannelReviewTriageBehavior(accountId: string, events: TriageBehaviorEvent[]): Promise<void> {
    if (events.length === 0) return;
    await http.post(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/channel-reviews/triage-feedback/behavior`,
      { events },
    );
  },

  /** The review's recorded events, oldest first, in the contract's vocabulary. Read-only. */
  async getChannelReviewTriageEvents(accountId: string, reviewId: string): Promise<TriageEventView[]> {
    const { data } = await http.get<TriageEventView[]>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/channel-reviews/${encodeURIComponent(reviewId)}/triage-feedback/events`,
    );
    return data;
  },

  /* ── Demo Core Experience v1 (2026-08-24) ─────────────────────────────────────────── */

  /**
   * The whole Overview screen in one read — KPIs, series, channel breakdown, exclusions, insights.
   *
   * Strict, and deliberately not mock-backed. A dashboard that silently renders demo numbers when the
   * backend is unreachable is the one screen where a fallback is indistinguishable from the product
   * working, and every number here is one a seller would act on.
   */
  // --- Proactive Operations Agent (「AI가 먼저 확인한 일」) ---
  // Fail-SOFT by design, and only here: the proactive section is an addition to a screen that
  // already works. If this read fails the seller still has their full inquiry queue and review list,
  // so a thrown error would take a working page down to show that an optional section is missing.
  // Every OTHER read in this workflow stays strict.
  async getProactiveCases(limit = 20): Promise<ProactiveCaseListResponse> {
    const { data } = await http.get<ProactiveCaseListResponse>(
      `/api/proactive/cases?limit=${encodeURIComponent(String(limit))}`,
    );
    return data;
  },
  async getProactiveSummary(): Promise<ProactiveSummaryView> {
    const { data } = await http.get<ProactiveSummaryView>("/api/proactive/summary");
    return data;
  },
  // Records the first time a person looked at a prepared case. Fire-and-forget from the UI: a
  // telemetry write must never stand between a seller and the work they just clicked on.
  async markProactiveCaseOpened(caseId: string): Promise<void> {
    await http.post(`/api/proactive/cases/${encodeURIComponent(caseId)}/opened`, {});
  },

  async getOverviewStrict(days?: number): Promise<OverviewResponse> {
    const suffix = days && days > 0 ? `?days=${days}` : "";
    const { data } = await http.get<OverviewResponse>(`/api/dashboard/overview${suffix}`);
    return data;
  },

  /** Product candidates for a seller's own words, or the first page when `q` is empty. */
  /**
   * The 상품 screen's page: the heaviest work first, and the org's real total.
   *
   * A different question from `searchProductsStrict`, which resolves a seller's own words and whose
   * empty-query head is alphabetical — right for a resolver, and how the screen came to show ten
   * products by name over a catalogue of 308.
   */
  async getProductCatalogStrict(limit = 20): Promise<ProductCatalogView> {
    const { data } = await http.get<ProductCatalogView>(`/api/products/catalog?limit=${limit}`);
    return data;
  },

  async searchProductsStrict(q?: string, limit = 30): Promise<ProductSummaryView[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (q && q.trim()) params.set("q", q.trim());
    const { data } = await http.get<ProductSummaryView[]>(`/api/products?${params.toString()}`);
    return data;
  },

  /** One product's signals and coverage verdicts — the light read a list row needs. */
  async getProductSignalsStrict(productId: string): Promise<ProductSignalsView> {
    const { data } = await http.get<ProductSignalsView>(
      `/api/products/${encodeURIComponent(productId)}/signals`,
    );
    return data;
  },

  /** Identity, listings, variants, facts, signals — and the coverage rows that qualify all of them. */
  async getProductKnowledgeStrict(productId: string): Promise<ProductKnowledgeView> {
    const { data } = await http.get<ProductKnowledgeView>(
      `/api/products/${encodeURIComponent(productId)}/knowledge`,
    );
    return data;
  },

  /** The seller's own knowledge documents for one product. */
  async listProductKnowledgeSources(productId: string): Promise<KnowledgeSourceView[]> {
    const { data } = await http.get<KnowledgeSourceView[]>(
      `/api/products/${encodeURIComponent(productId)}/knowledge/sources`,
    );
    return data;
  },

  async createProductKnowledgeSource(
    productId: string,
    request: KnowledgeSourceRequest,
  ): Promise<KnowledgeSourceView> {
    const { data } = await http.post<KnowledgeSourceView>(
      `/api/products/${encodeURIComponent(productId)}/knowledge/sources`,
      request,
    );
    return data;
  },

  async updateProductKnowledgeSource(
    sourceId: string,
    request: KnowledgeSourceRequest,
  ): Promise<KnowledgeSourceView> {
    const { data } = await http.put<KnowledgeSourceView>(
      `/api/products/knowledge/sources/${encodeURIComponent(sourceId)}`,
      request,
    );
    return data;
  },

  async deleteProductKnowledgeSource(sourceId: string): Promise<void> {
    await http.delete(`/api/products/knowledge/sources/${encodeURIComponent(sourceId)}`);
  },

  /**
   * The company's own operating rules — 배송, 취소, 교환/환불, 증빙, 공통 CS.
   *
   * Org-scoped from the token; no org id is ever sent. These are the rules an answer may be
   * grounded in when the inquiry resolves to no product, which is most of a real backlog.
   */
  async listOrgKnowledge(): Promise<OrgKnowledgeView[]> {
    const { data } = await http.get<OrgKnowledgeView[]>("/api/org-knowledge/sources");
    return data;
  },

  async createOrgKnowledge(request: OrgKnowledgeRequest): Promise<OrgKnowledgeView> {
    const { data } = await http.post<OrgKnowledgeView>("/api/org-knowledge/sources", request);
    return data;
  },

  async updateOrgKnowledge(
    sourceId: string,
    request: OrgKnowledgeRequest,
  ): Promise<OrgKnowledgeView> {
    const { data } = await http.put<OrgKnowledgeView>(
      `/api/org-knowledge/sources/${encodeURIComponent(sourceId)}`,
      request,
    );
    return data;
  },

  async deleteOrgKnowledge(sourceId: string): Promise<void> {
    await http.delete(`/api/org-knowledge/sources/${encodeURIComponent(sourceId)}`);
  },

  /**
   * AI 답변 스타일 — read the org's wording profile, or the shipped defaults when it has none.
   *
   * Org-scoped from the token; no org id is ever sent, and there is no list route because there is
   * nothing to list.
   */
  async getAnswerStyle(): Promise<AnswerStyleView> {
    const { data } = await http.get<AnswerStyleView>("/api/answer-style");
    return data;
  },

  /** Save the whole form. The backend refuses a style that reaches for a fact, and says which. */
  async saveAnswerStyle(request: AnswerStyleRequest): Promise<AnswerStyleView> {
    const { data } = await http.put<AnswerStyleView>("/api/answer-style", request);
    return data;
  },

  /**
   * 리뷰 답변 문구 — every review reply template with its effective wording, in the order the
   * product decides between them. Org-scoped from the token, like the answer style.
   */
  async getReviewReplyTemplates(): Promise<ReviewReplyTemplatesView> {
    const { data } = await http.get<ReviewReplyTemplatesView>("/api/review-reply-templates");
    return data;
  },

  /** Save one template's wording. The backend refuses blank/over-long text and says why. */
  async saveReviewReplyTemplate(key: string, body: string): Promise<ReviewReplyTemplateView> {
    const { data } = await http.put<ReviewReplyTemplateView>(
      `/api/review-reply-templates/${encodeURIComponent(key)}`,
      { body },
    );
    return data;
  },

  /** 기본값 복원 — removes the override so reviewnary's wording applies again. */
  async resetReviewReplyTemplate(key: string): Promise<ReviewReplyTemplateView> {
    const { data } = await http.delete<ReviewReplyTemplateView>(
      `/api/review-reply-templates/${encodeURIComponent(key)}`,
    );
    return data;
  },

  /** 회사 정보 — org-scoped from the token, like the answer style. */
  async getSellerProfile(): Promise<SellerProfileView> {
    const { data } = await http.get<SellerProfileView>("/api/seller-profile");
    return data;
  },

  /** Save the summary. Blank clears; over-length or unsafe text is refused with the reason. */
  async saveSellerProfile(request: SellerProfileRequest): Promise<SellerProfileView> {
    const { data } = await http.put<SellerProfileView>("/api/seller-profile", request);
    return data;
  },

  /** Today's Agent budget for this org. Read-only; asking never spends any of it. */
  async getAgentQuotaStrict(): Promise<AgentQuotaStatus> {
    const { data } = await http.get<AgentQuotaStatus>("/api/agent/quota");
    return data;
  },
};
