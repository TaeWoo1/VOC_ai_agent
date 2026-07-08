/**
 * Frontend mirror of the Local Agent Bridge wire protocol
 * (`collector/src/bridge/protocol.ts`). Per Frontend Spec §17.1 this is a **temporary hand-kept mirror**
 * of the agent's contract until a generated/shared contract exists — keep the two in sync on any change.
 *
 * Everything here is a sanitized scalar/enum (slice §8.3): no raw URL, selector, coordinate, DOM text,
 * credential, token, marketplace account id, or personal data ever crosses this boundary.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

export type BridgeConnectionState =
  | "starting"
  | "inspecting"
  | "ready"
  | "reconnecting"
  | "waiting_for_user"
  | "verifying"
  | "human_reconnect_required"
  | "syncing"
  | "paused"
  | "degraded"
  | "stopped";

export type BridgePendingUserAction =
  | "select_saved_credential"
  | "enter_missing_username"
  | "complete_manual_login"
  | "complete_additional_authentication"
  | "provide_api_credential"
  | "reauthorize_api_access";

export type BridgeProgressBucket = "none" | "started" | "in_progress" | "settling";
export type BridgeCollectionResult = "no_change" | "new_data" | "partial" | "unknown";

export interface BridgeConnectionView {
  ref: string;
  state: BridgeConnectionState;
  pendingUserAction: BridgePendingUserAction | null;
  browserOpen: boolean;
}

export interface BridgeSnapshot {
  agentVersion: string;
  protocolVersion: number;
  capabilities: string[];
  /** Event categories actually wired to a real runtime seam right now (slice §C). */
  supportedEvents: BridgeEventCategory[];
  connections: BridgeConnectionView[];
}

export interface BridgeHealth {
  ok: true;
  service: "sellerops-local-agent";
  agentVersion: string;
  protocolVersion: number;
}

export type BridgeEventCategory =
  | "bridge_status"
  | "agent_lifecycle"
  | "connection_lifecycle"
  | "browser_lifecycle"
  | "auth_session"
  | "pending_user_action"
  | "collection_progress"
  | "collection_result"
  | "recoverable_failure"
  | "terminal_failure"
  | "capability";

export interface BridgeEventPayload {
  state?: BridgeConnectionState;
  pendingUserAction?: BridgePendingUserAction;
  browserOpen?: boolean;
  progress?: BridgeProgressBucket;
  result?: BridgeCollectionResult;
  failure?: "recoverable" | "terminal";
  reasonCode?: string;
}

export type ServerMessage =
  | { type: "hello"; protocolVersion: number; agentVersion: string; capabilities: string[]; supportedEvents: BridgeEventCategory[] }
  | { type: "snapshot"; snapshot: BridgeSnapshot }
  | { type: "event"; category: BridgeEventCategory; ref: string | null; payload: BridgeEventPayload }
  | { type: "incompatible_version"; agentProtocolVersion: number }
  | { type: "error"; code: string };

export type PairPollResponse =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "paired"; pairingToken: string };
