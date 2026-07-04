/**
 * **API channel connector** — the `API` strategy of {@link ChannelConnector}, for channels reached
 * through a credentialed/token API (e.g. Cafe24) rather than a human browser session.
 *
 * The actual wire (HTTP, OAuth refresh, key validation) is deliberately NOT implemented in this
 * architecture slice — no API channel is `AVAILABLE` yet (Cafe24 is `NOT_IMPLEMENTED`). The connector
 * talks only to an injected {@link ApiConnectorPort} seam: production wires a real client; tests inject a
 * fake. This keeps the strategy fully offline-testable and the readiness posture honest — the shape
 * exists, the live call does not.
 *
 * `ensureReady()` inspects the credential and, only if unhealthy-but-recoverable, refreshes ONCE. API
 * recovery has no browser `reconnectPath`, so it is always `null`. `planSync()` generates an intent
 * (mechanism `API_FETCH`); it never performs a fetch, upload, dedup, or status write.
 */

import type {
  ChannelConnector,
  EnsureReadyResult,
  ConnectorUserAction,
  SyncIntent,
} from "./channel-connector";
import type { AuthStatus, CapabilityStatus, CommerceChannel, ConnectorType } from "../connection/sync-state";

/**
 * The injected API auth seam. NO live call lives in this repo yet — production supplies a real client,
 * tests supply a fake. `inspect` is a cheap, non-mutating credential-validity check reporting only the
 * auth state; `refresh` is the at-most-once recovery (e.g. an OAuth refresh or a re-key prompt), invoked
 * only when inspection was unhealthy-but-recoverable. Capability is a DECLARED posture (from the
 * registry), not something an API round-trip decides — so the port never reports it.
 */
export interface ApiConnectorPort {
  inspect(): Promise<{ authStatus: AuthStatus }>;
  refresh(): Promise<{ recovered: boolean; authStatus: AuthStatus; userAction: ConnectorUserAction | null }>;
}

/** Auth states from which a single API refresh could plausibly recover. */
const API_RECOVERABLE: ReadonlySet<AuthStatus> = new Set<AuthStatus>(["RECONNECT_REQUIRED", "EXPIRED"]);

export class ApiChannelConnector implements ChannelConnector {
  readonly strategy = "API" as const;

  constructor(
    readonly channel: CommerceChannel,
    readonly connectionId: string,
    readonly connectorType: ConnectorType,
    readonly capabilityStatus: CapabilityStatus,
    private readonly port: ApiConnectorPort,
  ) {}

  async ensureReady(): Promise<EnsureReadyResult> {
    const { authStatus } = await this.port.inspect();
    if (authStatus === "CONNECTED") {
      return { outcome: "READY", authStatus, reconnectPath: null, pendingUserAction: null };
    }
    if (!API_RECOVERABLE.has(authStatus)) {
      return { outcome: "FAILED", authStatus, reconnectPath: null, pendingUserAction: null };
    }
    // Unhealthy but recoverable → one refresh.
    const refreshed = await this.port.refresh();
    if (refreshed.recovered) {
      return { outcome: "READY", authStatus: refreshed.authStatus, reconnectPath: null, pendingUserAction: null };
    }
    if (refreshed.userAction !== null) {
      return { outcome: "NEEDS_USER_ACTION", authStatus: refreshed.authStatus, reconnectPath: null, pendingUserAction: refreshed.userAction };
    }
    return { outcome: "FAILED", authStatus: refreshed.authStatus, reconnectPath: null, pendingUserAction: null };
  }

  planSync(): SyncIntent {
    return {
      channel: this.channel,
      connectionId: this.connectionId,
      connectorType: this.connectorType,
      mechanism: "API_FETCH",
      capabilityStatus: this.capabilityStatus,
    };
  }

  async stop(): Promise<void> {
    // No persistent resource to release for the API strategy (no held browser). Present for contract
    // symmetry + idempotent shutdown.
  }
}
