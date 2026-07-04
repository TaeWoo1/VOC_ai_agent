/**
 * **Browser channel connector** — the `BROWSER` strategy of {@link ChannelConnector}, which ADAPTS the
 * existing Progressive Reconnect service as its auth subcomponent.
 *
 * It wraps a {@link ProgressiveServiceLike} (the exact structural interface the composition service and
 * `LocalAgentStartup` already speak) for ONE connection and exposes the single {@link ensureReady}
 * operation:
 *
 *  - If `autoReconnectConsent` was not granted it does NOT touch the service at all — it returns `SKIPPED`
 *    with the manual-login action (no launch).
 *  - Otherwise it runs the progressive ladder ONCE via `service.start(connection)` (launch + inspect the
 *    session + at most one automatic reconnect, per the policy's own consent gates), then maps the
 *    resulting snapshot + drained one-shot user actions onto the common {@link EnsureReadyResult}. There
 *    is no separate pre-flight inspect — launching a browser IS how a browser session is inspected.
 *
 * `planSync()` generates the sync intent (it never exports/uploads); `stop()` closes the live browser.
 * Agent-layer types are `type`-only imports, so no Playwright is pulled in at runtime; the connector is
 * fully exercised with a fake `ProgressiveServiceLike`.
 */

import type {
  ChannelConnector,
  EnsureReadyResult,
  ConnectorReadyOutcome,
  ConnectorUserAction,
  SyncIntent,
} from "./channel-connector";
import { connectorActionFromUserAction } from "./channel-connector";
import type { ProgressiveServiceLike, ProgressiveSnapshot } from "../agent/local-agent-startup";
import type { ProgressiveReconnectConnection } from "../agent/progressive-reconnect";
import type { LocalAgentState } from "../agent/local-agent-state";
import type { AuthStatus, CapabilityStatus, CommerceChannel, ConnectorType } from "../connection/sync-state";

/**
 * Map a settled `LocalAgentState` (the progressive machine's phase) onto the channel-agnostic
 * {@link AuthStatus}. Total over the enum — a new `LocalAgentState` is a compile error here.
 */
export function authStatusFromLocalAgentState(state: LocalAgentState): AuthStatus {
  switch (state) {
    case "READY":
    case "SYNCING":
      return "CONNECTED";
    case "PREPARING_RECONNECT":
    case "WAITING_FOR_CREDENTIAL_SELECTION":
    case "VERIFYING_LOGIN":
    case "HUMAN_RECONNECT_REQUIRED":
    case "DEGRADED":
      return "RECONNECT_REQUIRED";
    case "STOPPED":
    case "STARTING":
    case "INSPECTING_SESSION":
    case "PAUSED":
      return "UNKNOWN";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** Derive the common ready outcome + surfaced action from a settled snapshot + the drained one-shot actions. */
function outcomeFromSnapshot(snapshot: ProgressiveSnapshot, drained: readonly ConnectorUserAction[]): {
  outcome: ConnectorReadyOutcome;
  pendingUserAction: ConnectorUserAction | null;
} {
  if (snapshot.localAgentState === "READY") {
    return { outcome: "READY", pendingUserAction: null };
  }
  const surfaced: ConnectorUserAction | null =
    (snapshot.pendingUserAction !== null ? connectorActionFromUserAction(snapshot.pendingUserAction) : null) ??
    (drained.length > 0 ? drained[drained.length - 1]! : null);
  if (surfaced !== null) {
    return { outcome: "NEEDS_USER_ACTION", pendingUserAction: surfaced };
  }
  if (snapshot.localAgentState === "HUMAN_RECONNECT_REQUIRED") {
    return { outcome: "NEEDS_USER_ACTION", pendingUserAction: "COMPLETE_MANUAL_LOGIN" };
  }
  return { outcome: "FAILED", pendingUserAction: null };
}

export class BrowserChannelConnector implements ChannelConnector {
  readonly strategy = "BROWSER" as const;

  constructor(
    readonly channel: CommerceChannel,
    readonly connectionId: string,
    readonly connectorType: ConnectorType,
    readonly capabilityStatus: CapabilityStatus,
    private readonly service: ProgressiveServiceLike,
    private readonly connection: ProgressiveReconnectConnection,
  ) {}

  async ensureReady(): Promise<EnsureReadyResult> {
    if (!this.connection.autoReconnectConsent) {
      // No automatic-reconnect grant → do not launch/attempt at all; the human must log in manually.
      return {
        outcome: "SKIPPED",
        authStatus: "RECONNECT_REQUIRED",
        reconnectPath: null,
        pendingUserAction: "COMPLETE_MANUAL_LOGIN",
      };
    }
    const snapshot = await this.service.start(this.connection);
    const drained = this.service.drainUserActionRequests(this.connectionId).map(connectorActionFromUserAction);
    const { outcome, pendingUserAction } = outcomeFromSnapshot(snapshot, drained);
    return {
      outcome,
      authStatus: authStatusFromLocalAgentState(snapshot.localAgentState),
      reconnectPath: snapshot.reconnectPath,
      pendingUserAction,
    };
  }

  planSync(): SyncIntent {
    return {
      channel: this.channel,
      connectionId: this.connectionId,
      connectorType: this.connectorType,
      mechanism: "BROWSER_EXPORT",
      capabilityStatus: this.capabilityStatus,
    };
  }

  async stop(): Promise<void> {
    await this.service.stop(this.connectionId);
  }
}
