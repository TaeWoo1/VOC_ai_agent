import axios, { isAxiosError } from "axios";
import type {
  AccountDashboardSummary,
  ArticleListResponse,
  AuthResponse,
  BackfillRequest,
  Cafe24CapabilityView,
  Cafe24ConnectStartView,
  CapabilityView,
  ChannelCapabilityOverview,
  ChannelResponse,
  ChannelReviewDetailView,
  ChannelReviewLocateRun,
  ChannelReviewPageView,
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
  InquiryQueueResponse,
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
  ReviewReplySubmissionRunResponse,
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
  SyncRunFilters,
  SyncRunView,
  UploadType,
  UserView,
  WalkthroughContextView,
  WalkthroughHandshakeResult,
  ReviewIssueView,
  ReviewIssueDetailView,
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

// Default to a SAME-ORIGIN relative base ("") so `/api/*` requests go through the Vite dev proxy (see
// vite.config.ts) to whatever backend the dev server targets. This removes the two failure modes that
// once cost a live run an hour (see loginError.ts): a stale absolute `VITE_API_BASE_URL` port, and a
// cross-origin CORS rejection between localhost/127.0.0.1. Set VITE_API_BASE_URL explicitly only for a
// deployment where the API is served from a different origin than the app.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const TOKEN_KEY = "sellerops_token";

const http = axios.create({ baseURL: BASE_URL, timeout: 8000 });

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Read-only GETs fall back to seeded mocks so the UI never shows a blank screen.
async function getOrMock<T>(path: string, mock: () => T): Promise<T> {
  if (USE_MOCKS) {
    return mock();
  }
  try {
    const { data } = await http.get<T>(path);
    return data;
  } catch {
    return mock();
  }
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
  }): Promise<AuthResponse> {
    if (USE_MOCKS) {
      return mockAuth();
    }
    const { data } = await http.post<AuthResponse>("/api/auth/signup", input);
    return data;
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
  getMe: async (): Promise<UserView> => {
    if (USE_MOCKS) {
      return mockMe();
    }
    const { data } = await http.get<UserView>("/api/users/me");
    return data;
  },
  getChannels: (): Promise<ChannelResponse[]> => getOrMock("/api/channels", mockChannels),
  // Strict variants for the Naver collection workflow (ChannelDetail): no silent
  // mock fallback, so a dead/wrong backend fails closed instead of rendering a
  // fake "CONNECTED" page. The global VITE_USE_MOCKS demo escape hatch is still
  // honored. Mirrors the getChannelCapabilities fail-closed pattern below.
  async getChannelsStrict(): Promise<ChannelResponse[]> {
    if (USE_MOCKS) {
      return mockChannels();
    }
    const { data } = await http.get<ChannelResponse[]>("/api/channels");
    return data;
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
    getOrMock("/api/dashboard/channel-status", mockChannels),
  getSellerAccounts: (): Promise<SellerAccountResponse[]> =>
    getOrMock("/api/seller-accounts", mockSellerAccounts),
  getDashboardSummary: (): Promise<DashboardSummaryResponse> =>
    getOrMock("/api/dashboard/summary", mockDashboard),
  getInbox: (): Promise<InboxResponse> => getOrMock("/api/inbox", mockInbox),
  // Strict variant for the integrated inbox (Inbox page): no silent mock
  // fallback, so a dead backend fails closed instead of rendering a fake feed of
  // inquiries/reviews. Honors the VITE_USE_MOCKS demo escape hatch. Mirrors the
  // other *Strict reads.
  async getInboxStrict(): Promise<InboxResponse> {
    if (USE_MOCKS) {
      return mockInbox();
    }
    const { data } = await http.get<InboxResponse>("/api/inbox");
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
  // Seller-only detail for one work item: exposes title/details (never author),
  // and the attached proposal once PROPOSED. A 404 (foreign/unknown id) throws.
  async getInquiryDetailStrict(workItemId: string): Promise<InquiryDetail> {
    const { data } = await http.get<InquiryDetail>(`/api/inquiries/${workItemId}`);
    return data;
  },
  // Mutating: seller-initiated proposal generation (OPEN → PROPOSED). No mock.
  // The caller classifies 404 (unavailable) / 409 (phase changed) / 503
  // (generation unavailable) from the thrown axios error.
  async generateInquiryProposal(workItemId: string): Promise<ProposalResult> {
    const { data } = await http.post<ProposalResult>(`/api/inquiries/${workItemId}/proposal`);
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
    limits?: { todoLimit?: number; recentLimit?: number },
  ): Promise<OperatorReplyWorkView> {
    if (USE_MOCKS) {
      return mockReplyWork(accountId);
    }
    const search = new URLSearchParams();
    if (limits?.todoLimit != null) search.set("todoLimit", String(limits.todoLimit));
    if (limits?.recentLimit != null) search.set("recentLimit", String(limits.recentLimit));
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

  /** 확인 필요 → 조치 중. The note is the operator's own record of what they are doing. */
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
    params: { sort?: "newest" | "lowest"; page?: number; size?: number } = {},
  ): Promise<ChannelReviewPageView> {
    const query = new URLSearchParams();
    if (params.sort) query.set("sort", params.sort);
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.size !== undefined) query.set("size", String(params.size));
    const { data } = await http.get<ChannelReviewPageView>(
      `/api/seller-accounts/${encodeURIComponent(accountId)}/channel-reviews${
        query.toString() ? `?${query}` : ""
      }`,
    );
    return data;
  },

  /** One review in full. No mock fallback, as above. */
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
};
