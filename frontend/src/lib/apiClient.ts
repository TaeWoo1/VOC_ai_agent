import axios from "axios";
import type {
  AuthResponse,
  ChannelResponse,
  DashboardSummaryResponse,
  IngestResult,
  InboxResponse,
  OrderSummaryResponse,
  SellerAccountResponse,
  SyncJobView,
  UploadType,
  UserView,
} from "./types";
import {
  mockAuth,
  mockChannels,
  mockDashboard,
  mockInbox,
  mockMe,
  mockOrders,
  mockSellerAccounts,
  mockSyncJobs,
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
  getChannelStatus: (): Promise<ChannelResponse[]> =>
    getOrMock("/api/dashboard/channel-status", mockChannels),
  getSellerAccounts: (): Promise<SellerAccountResponse[]> =>
    getOrMock("/api/seller-accounts", mockSellerAccounts),
  getDashboardSummary: (): Promise<DashboardSummaryResponse> =>
    getOrMock("/api/dashboard/summary", mockDashboard),
  getInbox: (): Promise<InboxResponse> => getOrMock("/api/inbox", mockInbox),
  getOrdersSummary: (): Promise<OrderSummaryResponse> =>
    getOrMock("/api/orders/summary", mockOrders),
  getSyncJobs: (): Promise<SyncJobView[]> => getOrMock("/api/sync-jobs", mockSyncJobs),

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
};
