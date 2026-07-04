/**
 * **Cloud API connector composition root** — the API-track peer of the Local Agent's browser-track root.
 *
 * In the two-track product architecture (see `docs/two-track-product-architecture.md`) the Local Agent owns
 * only BROWSER connectors (human-attended NAVER / ESM sessions on the seller's own device), and this Cloud
 * seam owns only API connectors (credentialed/token channels reached over an official API, e.g. Cafe24).
 * The split is by ownership, not just packaging: no Cafe24 credential is ever stored in — or constructed
 * from — the Local Agent; the production API port is injected HERE.
 *
 * Both roots drive the SAME {@link ConnectorOrchestrator} contract — each connection settled by one uniform
 * `ChannelConnector.ensureReady()`, in isolation, surfacing the common outcomes
 * (`READY` / `NEEDS_USER_ACTION` / `FAILED` / `SKIPPED`) and a GENERATED `SyncIntent` only when both
 * `READY` and `AVAILABLE` — so adding the API track changes no lifecycle, only which ports plug in.
 *
 * **Runtime-ready only when a production port is injected.** An API channel (Cafe24) is promoted to
 * `AVAILABLE` — and thus runnable + sync-intent-eligible — ONLY when its real {@link ApiConnectorPort} is
 * supplied to this seam; without it the channel stays `NOT_IMPLEMENTED` and settles `SKIPPED`. A non-API
 * (browser / discovery-required) descriptor handed to the Cloud seam is honestly `SKIPPED` — the Cloud does
 * not own it — never a throw and never a browser launch.
 *
 * **Pure/offline seam.** This module is the composition wiring ONLY: it constructs no server, scheduler,
 * database, HTTP client, or backend write, and performs no network call. The live token call + encrypted
 * token persistence live behind the injected {@link ApiConnectorPort} (its production implementation is a
 * separate, not-yet-existing slice). Everything crossing the boundary is a sanitized enum / boolean.
 */

import {
  ConnectorOrchestrator,
  type ConnectorStartupResult,
  type ConnectorShutdownReport,
  type ConnectorOrchestratorObserver,
} from "./connector-orchestrator";
import { createConnectorHandle, descriptorFor, type ConnectorHandle, type KnownChannel } from "./channel-registry";
import type { ApiConnectorPort } from "./api-connector";

// ── Sanitized API connection descriptors ──────────────────────────────────────────────────────────

/**
 * A sanitized Cloud API connection as it appears in the Cloud config: a connection id bound to a known
 * channel. Never a credential, token, `mall_id`/shop id, or callback payload. (Parsing/validation of the
 * raw Cloud config into these descriptors is out of scope for this offline seam — it arrives with the Cloud
 * service slice; this root takes already-validated descriptors.)
 */
export interface CloudApiConnectionDescriptor {
  connectionId: string;
  channel: KnownChannel;
}

/**
 * The production API ports injected into the Cloud seam, keyed by channel. Cafe24 is the first (and only)
 * API channel today: supply `cafe24Port` to make Cafe24 connections `AVAILABLE` + runnable; omit it to keep
 * Cafe24 `NOT_IMPLEMENTED` (it then settles `SKIPPED`). Adding an API channel adds one optional port here.
 */
export interface CloudApiConnectorPorts {
  cafe24Port?: ApiConnectorPort;
}

/** Resolve the injected production port for an API channel, or undefined when none was supplied. */
function apiPortFor(channel: KnownChannel, ports: CloudApiConnectorPorts): ApiConnectorPort | undefined {
  if (channel === "CAFE24") return ports.cafe24Port;
  return undefined;
}

// ── Handle building ────────────────────────────────────────────────────────────────────────────────

/**
 * Turn Cloud API descriptors into registry handles, preserving input order. The Cloud owns API connectors
 * ONLY:
 *  - an `API` channel WITH its injected production port → a runnable connector (promoted to `AVAILABLE`);
 *  - an `API` channel WITHOUT a port → a `SKIPPED` handle (`NOT_IMPLEMENTED`), never a fake connector;
 *  - any non-API channel (browser / discovery-required / unknown) → a `SKIPPED` handle carrying its real
 *    `implementationStatus` — the Cloud does not own it, so it is neither run nor a configuration error.
 * No browser service is ever referenced (the Cloud has none), so a browser descriptor never throws.
 */
export function buildCloudApiConnectorHandles(
  connections: readonly CloudApiConnectionDescriptor[],
  ports: CloudApiConnectorPorts,
): ConnectorHandle[] {
  return connections.map((c) => {
    const descriptor = descriptorFor(c.channel);
    // Cloud owns API connectors only — anything else is skipped honestly (not run, not an error).
    if (descriptor === undefined || descriptor.strategy !== "API") {
      return {
        status: "SKIPPED",
        channel: c.channel,
        connectionId: c.connectionId,
        implementationStatus: descriptor?.implementationStatus ?? "DISCOVERY_REQUIRED",
      };
    }
    const port = apiPortFor(c.channel, ports);
    // Runtime-ready only when the production port is injected; without it the API channel stays SKIPPED.
    return createConnectorHandle(c.channel, c.connectionId, port !== undefined ? { api: { port } } : {});
  });
}

// ── Composition root ─────────────────────────────────────────────────────────────────────────────────

/**
 * The Cloud MULTI-CHANNEL API startup root. Owns one {@link ConnectorOrchestrator} and the injected
 * production API ports; boots a set of API connections through it (each via a single `ensureReady()`),
 * surfaces the sanitized per-connection results, and shuts every started connector down cleanly. Boot
 * exactly once (the orchestrator enforces it). Holds no server/scheduler/db/network resource.
 */
export class CloudApiConnectorStartup {
  private readonly orchestrator: ConnectorOrchestrator;

  constructor(
    /** The production API ports; a channel is runnable only when its port is present. */
    private readonly ports: CloudApiConnectorPorts,
    observer?: ConnectorOrchestratorObserver,
  ) {
    this.orchestrator = new ConnectorOrchestrator(observer);
  }

  /**
   * Boot the Cloud API track: build a handle per connection (an API channel wired to its injected port,
   * everything else a `SKIPPED` handle) and drive them all through the orchestrator, in isolation and in
   * order. Returns one sanitized {@link ConnectorStartupResult} per connection. Generates but never
   * executes sync intents.
   */
  async boot(connections: readonly CloudApiConnectionDescriptor[]): Promise<ConnectorStartupResult[]> {
    return this.orchestrator.boot(buildCloudApiConnectorHandles(connections, this.ports));
  }

  /** Stop every started connector exactly once, isolated + idempotent. */
  async shutdown(): Promise<ConnectorShutdownReport> {
    return this.orchestrator.shutdown();
  }

  /** The connection ids currently held (would be stopped on shutdown). */
  managedConnectionIds(): string[] {
    return this.orchestrator.managedConnectionIds();
  }
}

/**
 * Build the production Cloud API startup root over the Connector Orchestrator. There is no lazy runtime to
 * realize (unlike the browser track's progressive service): the live wire lives entirely behind each
 * injected {@link ApiConnectorPort}. Supplying a channel's port makes it `AVAILABLE`; omitting it keeps the
 * channel `NOT_IMPLEMENTED`.
 */
export function createCloudApiConnectorStartup(
  ports: CloudApiConnectorPorts,
  observer?: ConnectorOrchestratorObserver,
): CloudApiConnectorStartup {
  return new CloudApiConnectorStartup(ports, observer);
}
