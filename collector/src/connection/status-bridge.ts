/**
 * Pure bridge from the connection-level `ConnectionStatus` to the run-level
 * `CollectorState` (`../status.ts`), so connection health can be surfaced through
 * the existing status surface WITHOUT running a browser. No I/O, no clock reads,
 * no writes — `connectionToStatusSnapshot` builds the `StatusRecord` payload but
 * never calls `writeStatus`.
 *
 * Enum impedance: the run-level `CollectorState` was designed for a single-store
 * run and has fewer concepts than `ConnectionStatus`. The bridge maps each
 * connection status to the CLOSEST existing run state and carries the precise
 * meaning in `reasonCategory` + a sanitized `detail`. No new run-level states are
 * invented. No mapping ever yields `LAST_SUCCESS` — that remains reserved for an
 * actual capture+upload (see `decideState`), which the connection layer never does.
 *
 * Sanitization: `detail` is a fixed Korean phrase per status (optionally plus a
 * fixed re-auth reason category). It never contains raw NAVER identity, the
 * fingerprint hash, the connectionId, or the profile name.
 */

import type { CollectorState, StatusRecord } from "../status";
import type { CollectorConnection, ConnectionStatus } from "./types";

/** Sanitized reason category mirroring the connection status (fixed labels). */
export type ConnectionStatusReasonCategory =
  | "pending-user-login"
  | "pending-account-selection"
  | "connected"
  | "export-ready"
  | "needs-reauth"
  | "account-mismatch"
  | "export-failed";

export interface ConnectionStatusBridge {
  collectorState: CollectorState;
  detail: string;
  reasonCategory: ConnectionStatusReasonCategory;
}

/** Connection status → closest existing run-level CollectorState. */
const STATE_MAP: Record<ConnectionStatus, CollectorState> = {
  // Onboarding-in-progress: non-success, non-failure → collecting-like.
  PENDING_USER_LOGIN: "COLLECTING",
  PENDING_ACCOUNT_SELECTION: "COLLECTING",
  // Connected / ready to export: usable, nothing captured yet → CONNECTED.
  CONNECTED: "CONNECTED",
  EXPORT_READY: "CONNECTED",
  // Re-auth needed: closest is the reconnect-required run state.
  NEEDS_REAUTH: "SESSION_EXPIRED",
  // Account mismatch blocks export and requires human action — the run-level
  // "action required" state is reused as the generic human-action signal.
  ACCOUNT_MISMATCH: "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA",
  // Export attempt failed (page unreachable, etc.) → a failed-like run state.
  EXPORT_FAILED: "DOWNLOAD_FAILED",
};

const REASON_MAP: Record<ConnectionStatus, ConnectionStatusReasonCategory> = {
  PENDING_USER_LOGIN: "pending-user-login",
  PENDING_ACCOUNT_SELECTION: "pending-account-selection",
  CONNECTED: "connected",
  EXPORT_READY: "export-ready",
  NEEDS_REAUTH: "needs-reauth",
  ACCOUNT_MISMATCH: "account-mismatch",
  EXPORT_FAILED: "export-failed",
};

const DETAIL_MAP: Record<ConnectionStatus, string> = {
  PENDING_USER_LOGIN: "사용자 로그인 대기 중",
  PENDING_ACCOUNT_SELECTION: "사용자의 스토어 선택 대기 중",
  CONNECTED: "연결됨; 내보내기 대기",
  EXPORT_READY: "내보내기 준비됨",
  NEEDS_REAUTH: "재인증 필요",
  ACCOUNT_MISMATCH: "선택된 스토어가 연결된 스토어와 다름; 내보내기 차단됨",
  EXPORT_FAILED: "내보내기 실패",
};

/**
 * Sanitized human-readable detail for a connection's current status. For
 * NEEDS_REAUTH the fixed re-auth reason category is appended (also a fixed label).
 * Never includes raw identity, the fingerprint hash, connectionId, or profileName.
 */
export function connectionStatusDetail(connection: CollectorConnection): string {
  const base = DETAIL_MAP[connection.connectionStatus];
  if (connection.connectionStatus === "NEEDS_REAUTH" && connection.reauthRequiredReason) {
    return `${base} (${connection.reauthRequiredReason})`;
  }
  return base;
}

/** Map a connection's status to the closest existing run-level CollectorState. */
export function connectionStatusToCollectorState(connection: CollectorConnection): CollectorState {
  return STATE_MAP[connection.connectionStatus];
}

/** Full bridge: run state + sanitized detail + fixed reason category. */
export function connectionStatusBridge(connection: CollectorConnection): ConnectionStatusBridge {
  return {
    collectorState: connectionStatusToCollectorState(connection),
    detail: connectionStatusDetail(connection),
    reasonCategory: REASON_MAP[connection.connectionStatus],
  };
}

/**
 * Build the `StatusRecord` payload the status writer WOULD persist for this
 * connection — without writing it. `lastCollectedAt` is intentionally omitted (the
 * connection layer performs no collection). Pure: `now` is passed in.
 */
export function connectionToStatusSnapshot(
  connection: CollectorConnection,
  now: string,
): StatusRecord {
  return {
    state: connectionStatusToCollectorState(connection),
    detail: connectionStatusDetail(connection),
    updatedAt: now,
  };
}
