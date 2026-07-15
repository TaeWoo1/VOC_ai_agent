/**
 * **Local Agent Bridge — wire protocol (G1).** The sanitized contract shared between the SellerOps
 * frontend and the local agent's loopback bridge. Pure types + a few pure helpers; no I/O.
 *
 * G1 scope is **pairing + observability only** (slice `docs/slices/local-agent-bridge.md` §0.5). There
 * are NO marketplace-workflow / browser-control / click / credential commands here by design.
 *
 * **Sanitization invariant (slice §8.3).** Every value that crosses this boundary is an enum, a boolean,
 * a coarse bucket, a protocol/version scalar, or a 16-hex opaque id. Never a raw URL, selector, coordinate,
 * DOM text, credential, pairing secret, ticket, cookie, token, marketplace account id, or personal data.
 */

/** Bump on any breaking change to the envelopes/commands/events below. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** Feature flags the agent advertises so the frontend can degrade gracefully. */
export type BridgeCapability = "pairing" | "events" | "snapshot" | "revoke";

export const AGENT_CAPABILITIES: readonly BridgeCapability[] = ["pairing", "events", "snapshot", "revoke"];

/**
 * The unauthenticated health/presence payload (`GET /bridge/health`). Deliberately the MINIMUM needed to
 * bootstrap: only "a compatible agent is present" + the protocol/version. It carries NO pairing state, no
 * account/connection/marketplace/personal data — pairing and connection detail require the approved origin
 * and an authenticated session (slice §E).
 */
export interface BridgeHealth {
  ok: true;
  service: "sellerops-local-agent";
  agentVersion: string;
  protocolVersion: number;
}

/** The runtime lifecycle of one commerce connection, projected to a safe coarse enum for the frontend. */
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

/** Coarse progress bucket — never a precise count or timestamp (slice §8.3). */
export type BridgeProgressBucket = "none" | "started" | "in_progress" | "settling";

/** Coarse result of a collection attempt — never a precise row count. */
export type BridgeCollectionResult = "no_change" | "new_data" | "partial" | "unknown";

/** The sanitized snapshot the agent sends on connect and on request. */
export interface BridgeSnapshot {
  agentVersion: string;
  protocolVersion: number;
  capabilities: readonly BridgeCapability[];
  /** Event categories actually wired to a real runtime seam right now (slice §C). */
  supportedEvents: readonly BridgeEventCategory[];
  /** One entry per managed commerce connection, keyed only by a 16-hex opaque id. */
  connections: readonly BridgeConnectionView[];
}

export interface BridgeConnectionView {
  /** 16-hex opaque id — NOT the raw connectionId/account/store identity. */
  ref: string;
  state: BridgeConnectionState;
  /** True while a human action (login/2FA/account select) is required — the action category, not its content. */
  pendingUserAction: BridgePendingUserAction | null;
  /** Whether a browser window is currently open for this connection. */
  browserOpen: boolean;
}

/** The human-action categories (safe subset mirrored from the connector's ConnectorUserAction). */
export type BridgePendingUserAction =
  | "select_saved_credential"
  | "enter_missing_username"
  | "complete_manual_login"
  | "complete_additional_authentication"
  | "provide_api_credential"
  | "reauthorize_api_access";

/** The semantic event categories the frontend consumes (slice §8.2). */
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

/**
 * **Capability truthfulness (slice §C).** Which event categories are actually WIRED to a real Local Agent
 * runtime seam today, versus reserved in the schema for later (Browser Projection / live collection). The
 * agent advertises `SUPPORTED_EVENT_CATEGORIES` in the hello/snapshot so the frontend never treats a
 * reserved category as live. The runtime must not emit a reserved category as real progress.
 */
export const SUPPORTED_EVENT_CATEGORIES: readonly BridgeEventCategory[] = [
  "bridge_status", // transport up/down (frontend-observed)
  "agent_lifecycle", // agent started/stopping (CLI seam)
  "capability", // hello/snapshot
  "connection_lifecycle", // settled ConnectorStartupResult → coarse state
  "pending_user_action", // settled result's pendingUserAction
  "recoverable_failure", // settled outcome FAILED
];

export const RESERVED_EVENT_CATEGORIES: readonly BridgeEventCategory[] = [
  "browser_lifecycle", // no reliable browser-open/close seam at the settle observer (reserved for G2)
  "auth_session", // no streaming auth/session seam (authStatus is only in the settled snapshot)
  "collection_progress", // no execution-time progress seam (syncIntent is generated, never executed)
  "collection_result",
  "terminal_failure",
];

/** A server→client message. `event` carries a sanitized category payload; `snapshot`/`hello` are lifecycle. */
export type ServerMessage =
  | { type: "hello"; protocolVersion: number; agentVersion: string; capabilities: readonly BridgeCapability[]; supportedEvents: readonly BridgeEventCategory[] }
  | { type: "snapshot"; snapshot: BridgeSnapshot }
  | { type: "event"; category: BridgeEventCategory; ref: string | null; payload: BridgeEventPayload }
  | { type: "incompatible_version"; agentProtocolVersion: number }
  | { type: "error"; code: BridgeErrorCode };

/** A client→server message. G1 allows ONLY these (slice §0.5) — no workflow/browser/click commands. */
export type ClientMessage =
  | { type: "request_snapshot" }
  | { type: "ping" };

/** Sanitized event payload — a small bag of safe scalars only. */
export interface BridgeEventPayload {
  state?: BridgeConnectionState;
  pendingUserAction?: BridgePendingUserAction;
  browserOpen?: boolean;
  progress?: BridgeProgressBucket;
  result?: BridgeCollectionResult;
  /** A coarse failure category — never a stack, URL, or message with content. */
  failure?: "recoverable" | "terminal";
  reasonCode?: string;
}

export type BridgeErrorCode =
  | "unpaired"
  | "bad_origin"
  | "bad_ticket"
  | "incompatible_version"
  /** `POST /bridge/pair/request` 503: this agent has no human channel able to show the approval code, so
   *  pairing fails closed. Additive — an older frontend simply renders it as a generic failure. */
  | "approval_unavailable"
  /** `POST /bridge/pair/request` 403: a human WAS shown the request and refused it. Distinct from
   *  `approval_unavailable` so the frontend can say "거부됨" instead of "연결할 수 없음". */
  | "approval_declined"
  | "internal";

/** Response of `POST /bridge/pair/request`. `requestId`/`confirmationCode` are short-lived, NOT the secret. */
export interface PairRequestResponse {
  requestId: string;
  /** Short, human-verifiable code shown on BOTH the frontend and the agent confirmation page. */
  confirmationCode: string;
  /** Agent-owned local confirmation page (loopback). Carries only the short requestId, never a secret. */
  confirmUrl: string;
}

/** Response of `POST /bridge/pair/poll`. The long-lived `pairingToken` is returned once here (body, never URL). */
export type PairPollResponse =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "paired"; pairingToken: string };

/** Response of `POST /bridge/ws-ticket`. Short-lived single-use ticket for exactly one WS handshake. */
export type WsTicketResponse =
  | { ticket: string; expiresInMs: number }
  | { error: "incompatible_version"; agentProtocolVersion: number }
  | { error: "unpaired" };

/** Pure: are two protocol versions compatible? G1 is a single major version — exact match. */
export function isProtocolCompatible(clientVersion: number, agentVersion: number): boolean {
  return Number.isInteger(clientVersion) && clientVersion === agentVersion;
}
