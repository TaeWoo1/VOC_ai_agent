// NAVER Guided Connection (B4) — bridge → session-detection adapter.
//
// Maps the paired Local Agent Bridge state to a DETECTED NAVER session signal, or `null` when detection
// is unavailable — in which case the caller falls back to the seller's attestation (`resolveNaverSession`).
// Pure and sanitized-in/sanitized-out: it reads ONLY the connection-state ENUM + pendingUserAction ENUM
// from the bridge snapshot — never a ref value, URL, account/store id, or any content. DOM-free, so it is
// unit-tested in the node-env Vitest setup.
import type { BridgeState } from "../bridge/bridgeClient";
import type { NaverSessionSignal } from "./types";

/**
 * The safest existing bridge signal for the wizard's readiness (`connection_lifecycle` / `auth_session`
 * category — `BridgeConnectionView.state`):
 *   • `ready`                       → `logged_in`
 *   • `human_reconnect_required`    → `reconnect_required`
 *   • `waiting_for_user` + `complete_manual_login` → `logged_out` (login needed)
 *   • `waiting_for_user` + `reauthorize_api_access` → `reconnect_required`
 *   • anything else (transient/paused/degraded/other waits) → `null` (neutral → attestation fallback)
 *
 * v1 scope: `connections[].ref` is opaque (the protocol carries no channel code), so a session state is
 * read only when there is EXACTLY ONE connection (the single-channel NAVER pilot). With zero or multiple
 * connections it returns `null` rather than guess which connection is NAVER — see the reported gap.
 */
export function bridgeSessionDetection(bridge: BridgeState): NaverSessionSignal | null {
  if (bridge.phase !== "paired" || !bridge.snapshot) return null;
  const conns = bridge.snapshot.connections;
  if (conns.length !== 1) return null;
  const conn = conns[0];
  if (!conn) return null;
  switch (conn.state) {
    case "ready":
      return "logged_in";
    case "human_reconnect_required":
      return "reconnect_required";
    case "waiting_for_user":
      if (conn.pendingUserAction === "complete_manual_login") return "logged_out";
      if (conn.pendingUserAction === "reauthorize_api_access") return "reconnect_required";
      return null;
    default:
      return null;
  }
}
