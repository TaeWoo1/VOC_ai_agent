/**
 * **Connector Orchestrator** — the multi-channel generalization of the device-local startup root. It
 * drives a mixed set of connections (API and browser, across NAVER / ESM / Cafe24 / future channels)
 * through ONE uniform operation each, in isolation, and generates a sync intent per connection WITHOUT
 * ever executing a sync.
 *
 * **Startup (per connection):** call the connector's {@link ChannelConnector.ensureReady} EXACTLY ONCE,
 * take its common outcome (`READY` / `NEEDS_USER_ACTION` / `FAILED` / `SKIPPED`), and then generate a
 * {@link SyncIntent} **only when the outcome is `READY` AND the channel's implementation is `AVAILABLE`**.
 * A `NOT_IMPLEMENTED` channel that happens to become ready still yields no intent; a `DISCOVERY_REQUIRED`
 * channel never even produces a connector (its handle is `SKIPPED`).
 *
 * **Two axes, kept separate.** The sync-intent gate is the operational `ImplementationStatus`
 * (`AVAILABLE`), NOT `CapabilityStatus` — capability rides along on the intent as the informational
 * data/schema/dedup verification posture only.
 *
 * **Per-connection isolation.** Each connection settles independently: a connector whose `ensureReady`
 * throws is reported `FAILED` (never aborts the others); a `SKIPPED` handle is reported and never held;
 * one connection's failed teardown never blocks the rest. Everything crossing the boundary is a sanitized
 * enum / boolean.
 *
 * **Relation to the existing stack.** The browser strategy adapts the *already-built* Progressive
 * Reconnect service (`ProgressiveServiceLike`) as its auth subcomponent — this orchestrator is the
 * channel-level peer of `LocalAgentStartup`, not a replacement for the progressive machine. It writes no
 * `CollectorState` / schema map / dedup verification; a booted connection is NOT a CONFIRMED capability.
 *
 * Pure/offline: type-only agent imports, no fs / http / browser / backend.
 */

import type { ChannelConnector, ConnectorStrategy, ConnectorReadyOutcome, ConnectorUserAction, ImplementationStatus, SyncIntent } from "./channel-connector";
import type { ConnectorHandle, KnownChannel } from "./channel-registry";
import type { AuthStatus, CapabilityStatus } from "../connection/sync-state";
/** `ReconnectPath` lives in the progressive-reconnect layer (browser-only); reused, not redefined. */
import type { ReconnectPath } from "../agent/progressive-reconnect";

/** The sanitized per-connection outcome of startup. Only enums / booleans — never raw data. */
export interface ConnectorStartupResult {
  connectionId: string;
  channel: KnownChannel;
  /** The connector's strategy, or null for a `SKIPPED` (no-connector) handle. */
  strategy: ConnectorStrategy | null;
  /** Operational readiness axis — the sync-intent gate. */
  implementationStatus: ImplementationStatus;
  /** The common readiness outcome (or `SKIPPED` for a no-connector handle). */
  outcome: ConnectorReadyOutcome;
  authStatus: AuthStatus;
  capabilityStatus: CapabilityStatus;
  /** Browser-only rung that resolved the attempt; null for API / skipped / failed. */
  reconnectPath: ReconnectPath | null;
  pendingUserAction: ConnectorUserAction | null;
  /** GENERATED, not executed. Non-null ONLY when `outcome === "READY"` and `implementationStatus === "AVAILABLE"`. */
  syncIntent: SyncIntent | null;
}

/** The sanitized outcome of a clean shutdown. */
export interface ConnectorShutdownReport {
  stoppedConnectionIds: string[];
  /** Connections whose teardown threw — surfaced, never silently dropped. */
  failedTeardownConnectionIds: string[];
}

/** Optional observer for the sanitized settle of each connection (e.g. a UI/notifier). */
export interface ConnectorOrchestratorObserver {
  onConnectionSettled(result: ConnectorStartupResult): void;
}

/**
 * Drives a set of {@link ConnectorHandle}s through startup + shutdown. Holds only the connectors it has
 * started (the shutdown set); skipped and failed connections are reported but never held.
 */
export class ConnectorOrchestrator {
  private readonly started = new Map<string, ChannelConnector>();
  private booted = false;

  constructor(private readonly observer?: ConnectorOrchestratorObserver) {}

  /**
   * Boot every handle in order, in isolation. Returns one sanitized result per handle. A `SKIPPED` handle
   * is reported and skipped; a `READY_TO_START` connector has `ensureReady()` called once and a sync
   * intent generated only when eligible — a throw is caught and reported `FAILED`, never propagated.
   */
  async boot(handles: readonly ConnectorHandle[]): Promise<ConnectorStartupResult[]> {
    if (this.booted) {
      throw new Error("ConnectorOrchestrator.boot: already booted (construct a new orchestrator to boot again)");
    }
    this.booted = true;
    const results: ConnectorStartupResult[] = [];
    for (const handle of handles) {
      results.push(handle.status === "SKIPPED" ? this.settleSkipped(handle) : await this.startOne(handle.connector, handle.implementationStatus));
    }
    return results;
  }

  /** Stop every started connector exactly once, in start order, isolated. Idempotent. */
  async shutdown(): Promise<ConnectorShutdownReport> {
    const entries = [...this.started];
    this.started.clear();
    const stoppedConnectionIds: string[] = [];
    const failedTeardownConnectionIds: string[] = [];
    for (const [id, connector] of entries) {
      try {
        await connector.stop();
        stoppedConnectionIds.push(id);
      } catch {
        // Isolation: one connection's teardown failure must not block the others' cleanup.
        failedTeardownConnectionIds.push(id);
      }
    }
    return { stoppedConnectionIds, failedTeardownConnectionIds };
  }

  /** The connection ids currently held (would be stopped on shutdown). */
  managedConnectionIds(): string[] {
    return [...this.started.keys()];
  }

  private settleSkipped(handle: Extract<ConnectorHandle, { status: "SKIPPED" }>): ConnectorStartupResult {
    const result: ConnectorStartupResult = {
      connectionId: handle.connectionId,
      channel: handle.channel,
      strategy: null,
      implementationStatus: handle.implementationStatus,
      outcome: "SKIPPED",
      authStatus: "UNKNOWN",
      capabilityStatus: "NEEDS_DISCOVERY",
      reconnectPath: null,
      pendingUserAction: null,
      syncIntent: null,
    };
    this.observer?.onConnectionSettled(result);
    return result;
  }

  private async startOne(connector: ChannelConnector, implementationStatus: ImplementationStatus): Promise<ConnectorStartupResult> {
    // Take ownership BEFORE the operation so shutdown always releases the connector, even on a partial run.
    this.started.set(connector.connectionId, connector);
    try {
      const ready = await connector.ensureReady(); // EXACTLY ONCE
      // Gate on BOTH the operational outcome and the implementation axis — never on CapabilityStatus.
      const eligible = ready.outcome === "READY" && implementationStatus === "AVAILABLE";
      const syncIntent = eligible ? connector.planSync() : null;
      const result: ConnectorStartupResult = {
        connectionId: connector.connectionId,
        channel: connector.channel,
        strategy: connector.strategy,
        implementationStatus,
        outcome: ready.outcome,
        authStatus: ready.authStatus,
        capabilityStatus: connector.capabilityStatus,
        reconnectPath: ready.reconnectPath,
        pendingUserAction: ready.pendingUserAction,
        syncIntent,
      };
      this.observer?.onConnectionSettled(result);
      return result;
    } catch {
      // Isolation: a throwing connector is reported FAILED and skipped — the boot continues. It is still
      // held so shutdown releases anything it may have partially opened.
      const result: ConnectorStartupResult = {
        connectionId: connector.connectionId,
        channel: connector.channel,
        strategy: connector.strategy,
        implementationStatus,
        outcome: "FAILED",
        authStatus: "UNKNOWN",
        capabilityStatus: "NEEDS_DISCOVERY",
        reconnectPath: null,
        pendingUserAction: null,
        syncIntent: null,
      };
      this.observer?.onConnectionSettled(result);
      return result;
    }
  }
}
