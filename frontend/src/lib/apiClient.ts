import axios, { isAxiosError } from "axios";
import type {
  AccountDashboardSummary,
  ArticleListResponse,
  AuthResponse,
  BackfillRequest,
  Cafe24ConnectStartView,
  CapabilityView,
  ChannelCapabilityOverview,
  ChannelResponse,
  ConnectionInfoView,
  ConnectionStatusView,
  ConnectionTestResultView,
  ConnectorAlertView,
  CredentialIntakeRequest,
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
  ReviewImportSegmentView,
  SyncJobView,
  SyncRunFilters,
  SyncRunView,
  UploadType,
  UserView,
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

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
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

  getMe: (): Promise<UserView> => getOrMock("/api/users/me", mockMe),
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
  // The PRODUCT path: one click authorizes one guided Action Window run. The seller never handles a file.
  // `launchRef` is an opaque single-use authorization — never rendered, only handed to the local agent.
  async startReviewImportDiscovery(accountId: string): Promise<ReviewImportLaunchView> {
    const { data } = await http.post<ReviewImportLaunchView>(
      `/api/imports/reviews/launches/discovery?accountId=${accountId}`,
    );
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
      return mockCapabilities();
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
};
