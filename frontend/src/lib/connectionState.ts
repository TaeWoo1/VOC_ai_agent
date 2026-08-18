// One vocabulary for "how is this channel connected" on the 채널 연결 hub — product assembly A5.
//
// Four words, and only these: 연결됨 · 연결 필요 · 재연결 필요 · 오류 (plus 연결 중 for a
// started-but-unfinished connect). Derived from the account's real connection status and the
// health read; never from capability or from what the catalog says a channel could do.

import type { ConnectionStatusView, SellerAccountResponse } from "./types";

export type ConnectionStateKey = "CONNECTED" | "NEEDS_CONNECT" | "PENDING" | "RECONNECT" | "ERROR";

export interface ConnectionState {
  key: ConnectionStateKey;
  label: string;
  /** Chip tone. */
  tone: "good" | "muted" | "warn" | "bad";
}

const STATES: Record<ConnectionStateKey, ConnectionState> = {
  CONNECTED: { key: "CONNECTED", label: "연결됨", tone: "good" },
  NEEDS_CONNECT: { key: "NEEDS_CONNECT", label: "연결 필요", tone: "muted" },
  PENDING: { key: "PENDING", label: "연결 중", tone: "warn" },
  RECONNECT: { key: "RECONNECT", label: "재연결 필요", tone: "bad" },
  ERROR: { key: "ERROR", label: "오류", tone: "warn" },
};

/** Health states that mean the credential itself no longer works. */
const REAUTH_HEALTH = new Set(["EXPIRED", "NEEDS_REAUTH", "DISCONNECTED"]);

export function connectionState(
  account: SellerAccountResponse | null,
  health: ConnectionStatusView | null,
): ConnectionState {
  if (!account) {
    return STATES.NEEDS_CONNECT;
  }
  if (account.connectionStatus === "PENDING") {
    return STATES.PENDING;
  }
  if (account.connectionStatus === "RECONNECT_REQUIRED" || (health && REAUTH_HEALTH.has(health.state))) {
    return STATES.RECONNECT;
  }
  if (health && (health.consecutiveFailures > 0 || !!health.lastError || health.state === "DEGRADED")) {
    return STATES.ERROR;
  }
  return STATES.CONNECTED;
}

/** What the row's primary button says for a state. Verbs, in seller language, one per state. */
export const CONNECTION_ACTION_LABEL: Record<ConnectionStateKey, string> = {
  CONNECTED: "연결 관리",
  NEEDS_CONNECT: "연결하기",
  PENDING: "연결 계속하기",
  RECONNECT: "다시 연결하기",
  ERROR: "확인하기",
};
