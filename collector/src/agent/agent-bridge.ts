/**
 * **Local Agent ↔ Bridge integration.** Owns a single {@link BridgeServer} as part of the real Local Agent
 * process (slice §B): the agent starts it exactly once, seeds the actual configured connections, feeds the
 * real `ConnectorOrchestrator` settled results into the bridge snapshot/events through the existing
 * observer seam, and closes it idempotently on shutdown. It never launches a browser and never inserts
 * transport code into marketplace connectors — the bridge only observes the settled/lifecycle seams.
 *
 * Single-instance: if the port is already bound (another agent/bridge is running), `listen()` reports
 * `skipped` so the agent keeps running without a competing bridge instead of crashing.
 */

import { BridgeServer } from "../bridge/bridge-server";
import { FilePairingStore } from "../bridge/pairing-store";
import { settleObserverToPort, refFor } from "../bridge/event-adapter";
import { ProjectionRegistry } from "../bridge/projection-session";
import { ProjectionEndpoint } from "../bridge/projection-endpoint";
import type { ProjectionSource } from "../bridge/projection-hub";
import type { AdapterFrame } from "../bridge/projection-adapter";
import type { ProjectionCapabilities } from "../bridge/projection-protocol";
import type { ConnectorOrchestratorObserver } from "../connector/connector-orchestrator";
import { log } from "../log";

/**
 * Optional Browser Projection V0 wiring (slice §B/§C). The agent supplies a `createSource` that builds the
 * projection source over its owned real Chrome/CDP page. It is an INJECTION SEAM: the default local-agent
 * boot leaves projection unmounted (no projectable page guaranteed); tests and the browser QA harness supply
 * a source (a fake, or a `ProjectionAdapter` over a real `CDPSession`). No transport code enters connectors.
 */
export interface AgentProjectionConfig {
  capabilities: ProjectionCapabilities;
  /** Opaque 16-hex initial target handle (never a URL/title). */
  initialTargetHandle: string;
  createSource: (onFrame: (f: AdapterFrame) => void) => ProjectionSource;
  onTargetSwitchRequested?: (targetHandle: string) => void;
  ticketTtlMs?: number;
  leaseIdleMs?: number;
}

export interface AgentBridgeConfig {
  port: number;
  allowedOrigins: string[];
  pairingFile: string;
  agentVersion: string;
  /** Stable per-agent salt so a raw connectionId never crosses the wire (only its 16-hex ref). */
  refSalt: string;
  autoApprovePairing?: boolean;
  now?: () => number;
  /** When present, mounts the SEPARATE projection transport alongside the G1 status channel. */
  projection?: AgentProjectionConfig;
}

export type AgentBridgeListenResult =
  | { ok: true; port: number }
  | { ok: false; skipped: true; reason: string };

export interface AgentBridge {
  /** Observer to compose into the Local Agent startup so settled results feed the bridge snapshot/events. */
  readonly observer: ConnectorOrchestratorObserver;
  /** Start listening on loopback. `skipped` on EADDRINUSE — a bridge already runs (single instance). */
  listen(): Promise<AgentBridgeListenResult>;
  /** Seed the actual configured connections (raw connectionId → opaque 16-hex ref) into the snapshot. */
  seed(connectionIds: readonly string[]): void;
  markAgentStarted(): void;
  markAgentStopping(): void;
  close(): Promise<void>;
  readonly active: boolean;
  /** Test-only access to the underlying server (snapshot inspection). */
  readonly server: BridgeServer;
}

export function createAgentBridge(cfg: AgentBridgeConfig): AgentBridge {
  const store = new FilePairingStore(cfg.pairingFile, { now: cfg.now ?? (() => Date.now()) });
  const now = cfg.now ?? (() => Date.now());
  const projection = cfg.projection
    ? new ProjectionEndpoint({
        registry: new ProjectionRegistry({ now, ticketTtlMs: cfg.projection.ticketTtlMs, leaseIdleMs: cfg.projection.leaseIdleMs }),
        capabilities: cfg.projection.capabilities,
        initialTargetHandle: cfg.projection.initialTargetHandle,
        createSource: cfg.projection.createSource,
        onTargetSwitchRequested: cfg.projection.onTargetSwitchRequested,
      })
    : undefined;
  const server = new BridgeServer({
    store,
    allowedOrigins: cfg.allowedOrigins,
    agentVersion: cfg.agentVersion,
    port: cfg.port,
    autoApprovePairing: cfg.autoApprovePairing,
    projection,
  });
  const settle = settleObserverToPort(server.events, cfg.refSalt);
  let active = false;

  return {
    server,
    observer: { onConnectionSettled: (r) => settle.onConnectionSettled(r) },
    async listen(): Promise<AgentBridgeListenResult> {
      try {
        const { port } = await server.listen();
        active = true;
        return { ok: true, port };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EADDRINUSE") {
          log("bridge_skipped_already_running", {});
          return { ok: false, skipped: true, reason: "already_running" };
        }
        log("bridge_listen_failed", { code: code ?? "unknown" });
        return { ok: false, skipped: true, reason: code ?? "listen_failed" };
      }
    },
    seed(connectionIds: readonly string[]): void {
      server.seedConnections(connectionIds.map((id) => refFor(id, cfg.refSalt)));
    },
    markAgentStarted(): void {
      if (active) server.events.agentLifecycle("started");
    },
    markAgentStopping(): void {
      if (active) server.events.agentLifecycle("stopping");
    },
    async close(): Promise<void> {
      if (active) {
        active = false;
        await server.close();
      }
    },
    get active(): boolean {
      return active;
    },
  };
}
