import axios, { isAxiosError } from "axios";
import type {
  AuthResponse,
  CapabilityView,
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
  ItemAnalysis,
  OrderSummaryResponse,
  ScheduleView,
  SellerAccountResponse,
  SyncJobView,
  SyncRunFilters,
  SyncRunView,
  UploadType,
  UserView,
} from "./types";
import {
  mockAuth,
  mockCapabilities,
  mockChannels,
  mockConnectionInfo,
  mockConnectionStatus,
  mockConnectorAlerts,
  mockCredentialTemplate,
  mockStoreCredential,
  mockTestConnection,
  mockDashboard,
  mockInbox,
  mockItemAnalysis,
  mockMe,
  mockOrders,
  mockSchedules,
  mockSellerAccounts,
  mockSyncJobs,
  mockSyncRuns,
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
};
