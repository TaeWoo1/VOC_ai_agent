/**
 * **Event adapter (pure).** Bridges the collector's existing sanitized enums/result types to the bridge's
 * transport-neutral event categories (slice §8). This is the "minimum transport-neutral event seam" the
 * slice calls for: mappers + a {@link BridgeEventPort} interface the runtime/observer can call at
 * execution time, WITHOUT moving any transport code into marketplace connectors.
 *
 * Every produced field is a safe scalar (enum/boolean/16-hex ref). Forbidden inputs (raw URL, selector,
 * coordinate, DOM text, credential, token, marketplace account id, personal data) have no path into any
 * payload here — the mappers only read the connector's already-sanitized enums, and `refFor` one-way-hashes
 * the connectionId so even the internal id never crosses the wire.
 */

import { createHash } from "node:crypto";
import type { ConnectorStartupResult } from "../connector/connector-orchestrator";
import type { ConnectorUserAction } from "../connector/channel-connector";
import type { LocalAgentState } from "../agent/local-agent-state";
import type {
  BridgeConnectionState,
  BridgeConnectionView,
  BridgeEventCategory,
  BridgePendingUserAction,
  BridgeCollectionResult,
  BridgeProgressBucket,
  BridgeEventPayload,
} from "./protocol";

function assertNever(x: never): never {
  throw new Error(`unexpected variant: ${String(x)}`);
}

/** One-way 16-hex opaque ref for a connection — never the raw connectionId/account/store identity. */
export function refFor(connectionId: string, salt: string): string {
  return createHash("sha256").update(`${salt} ${connectionId}`).digest("hex").slice(0, 16);
}

/** LocalAgentState (11) → the safe coarse BridgeConnectionState. Exhaustive. */
export function connectionStateFromLocalAgent(state: LocalAgentState): BridgeConnectionState {
  switch (state) {
    case "STOPPED": return "stopped";
    case "STARTING": return "starting";
    case "INSPECTING_SESSION": return "inspecting";
    case "READY": return "ready";
    case "PREPARING_RECONNECT": return "reconnecting";
    case "WAITING_FOR_CREDENTIAL_SELECTION": return "waiting_for_user";
    case "VERIFYING_LOGIN": return "verifying";
    case "HUMAN_RECONNECT_REQUIRED": return "human_reconnect_required";
    case "SYNCING": return "syncing";
    case "PAUSED": return "paused";
    case "DEGRADED": return "degraded";
    default: return assertNever(state);
  }
}

/** ConnectorUserAction (6) → the safe BridgePendingUserAction (1:1). Exhaustive. */
export function pendingActionFromConnector(action: ConnectorUserAction): BridgePendingUserAction {
  switch (action) {
    case "SELECT_SAVED_CREDENTIAL": return "select_saved_credential";
    case "ENTER_MISSING_USERNAME": return "enter_missing_username";
    case "COMPLETE_MANUAL_LOGIN": return "complete_manual_login";
    case "COMPLETE_ADDITIONAL_AUTHENTICATION": return "complete_additional_authentication";
    case "PROVIDE_API_CREDENTIAL": return "provide_api_credential";
    case "REAUTHORIZE_API_ACCESS": return "reauthorize_api_access";
    default: return assertNever(action);
  }
}

/**
 * Project a settled ConnectorStartupResult into a sanitized snapshot connection view. `browserOpen` is
 * false at settle time (a settle means the attempt resolved; live browser-open state arrives via events).
 */
export function connectionViewFromSettle(result: ConnectorStartupResult, salt: string): BridgeConnectionView {
  const state: BridgeConnectionState =
    result.outcome === "READY" ? "ready"
      : result.outcome === "NEEDS_USER_ACTION" ? "waiting_for_user"
      : result.outcome === "FAILED" ? "degraded"
      : "stopped"; // SKIPPED
  return {
    ref: refFor(result.connectionId, salt),
    state,
    pendingUserAction: result.pendingUserAction ? pendingActionFromConnector(result.pendingUserAction) : null,
    browserOpen: false,
  };
}

/** A single sanitized event to broadcast. */
export interface BridgeEvent {
  category: BridgeEventCategory;
  ref: string | null;
  payload: BridgeEventPayload;
}

/** Settle → the events a frontend needs (connection lifecycle + optional pending-action). Pure. */
export function eventsFromSettle(result: ConnectorStartupResult, salt: string): BridgeEvent[] {
  const view = connectionViewFromSettle(result, salt);
  const events: BridgeEvent[] = [
    { category: "connection_lifecycle", ref: view.ref, payload: { state: view.state } },
  ];
  if (view.pendingUserAction) {
    events.push({ category: "pending_user_action", ref: view.ref, payload: { pendingUserAction: view.pendingUserAction } });
  }
  if (result.outcome === "FAILED") {
    events.push({ category: "recoverable_failure", ref: view.ref, payload: { failure: "recoverable" } });
  }
  return events;
}

/**
 * **Transport-neutral event port.** The runtime/observer calls these at execution time; a transport (the
 * bridge server) implements the interface to broadcast to paired frontends. Nothing here references a
 * socket — so wiring it in never couples transport into marketplace connectors (slice §11).
 */
export interface BridgeEventPort {
  connectionState(ref: string, state: BridgeConnectionState): void;
  browserOpen(ref: string, open: boolean): void;
  pendingUserAction(ref: string, action: BridgePendingUserAction | null): void;
  collectionProgress(ref: string, progress: BridgeProgressBucket): void;
  collectionResult(ref: string, result: BridgeCollectionResult): void;
  recoverableFailure(ref: string, reasonCode?: string): void;
  terminalFailure(ref: string, reasonCode?: string): void;
  agentLifecycle(state: "started" | "stopping"): void;
}

/**
 * Adapt the existing ConnectorOrchestratorObserver seam onto a BridgeEventPort — so simply passing this
 * observer to the orchestrator emits sanitized settle events with no connector changes.
 */
export function settleObserverToPort(
  port: BridgeEventPort,
  salt: string,
): { onConnectionSettled(result: ConnectorStartupResult): void } {
  return {
    onConnectionSettled(result: ConnectorStartupResult): void {
      for (const ev of eventsFromSettle(result, salt)) {
        if (ev.category === "connection_lifecycle" && ev.payload.state) {
          port.connectionState(ev.ref ?? "", ev.payload.state);
        } else if (ev.category === "pending_user_action" && ev.payload.pendingUserAction) {
          port.pendingUserAction(ev.ref ?? "", ev.payload.pendingUserAction);
        } else if (ev.category === "recoverable_failure") {
          port.recoverableFailure(ev.ref ?? "", ev.payload.reasonCode);
        }
      }
    },
  };
}
