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
import type { ApprovalPresenter } from "../bridge/approval-presenter";
import { settleObserverToPort, refFor } from "../bridge/event-adapter";
import { ProjectionRegistry } from "../bridge/projection-session";
import { ProjectionEndpoint } from "../bridge/projection-endpoint";
import type { ProjectionSource } from "../bridge/projection-hub";
import type { AdapterFrame } from "../bridge/projection-adapter";
import type { ProjectionCapabilities } from "../bridge/projection-protocol";
import { ActionWindowEndpoint } from "../bridge/action-window-endpoint";
import { ActionWindowEngine } from "../action-window/engine";
import { ActionWindowSession, type ProbeDriver } from "../action-window/session";
import { createPersistentRunSession, findResumableRun, resumePersistedRunSession } from "../action-window/run-lifecycle";
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

/**
 * Optional Action Window session hosting (R2B). When present, the agent hosts ONE command-driven
 * `ActionWindowSession` and relays its frames over the EXISTING authenticated `/bridge/ws` socket as
 * opaque `{type:"aw"}` carrier payloads (see `bridge/action-window-endpoint.ts`). The driver factory is
 * injected so the default boot stays synthetic (no browser); the Runtime never clicks the target.
 */
export interface AgentActionWindowConfig {
  /** Opaque run identity announced to paired clients (assigned by the Runtime, never by the FE). */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `synthetic`). */
  channelCode: string;
  /** Dotted semantic copy key for the run headline; FE owns final copy. */
  runCopyKey: string;
  createDriver: () => ProbeDriver;
  /**
   * Optional R3 persistence directory. When set, the hosted run is persisted after every verified
   * transition, and an interrupted (non-terminal) persisted run is RESUMED on boot — parked at the
   * PAUSED barrier until an explicit `RESUME_RUN` — instead of minting a new run. The resumed run's
   * identity replaces `runId` in the `aw_session` announcement.
   */
  persistDir?: string;
}

export interface AgentBridgeConfig {
  port: number;
  allowedOrigins: string[];
  pairingFile: string;
  agentVersion: string;
  /** Stable per-agent salt so a raw connectionId never crosses the wire (only its 16-hex ref). */
  refSalt: string;
  autoApprovePairing?: boolean;
  /**
   * The human channel for the out-of-band pairing approval secret. Left unset by the default boot, which is
   * deliberate and fail-closed: the repo has NO native desktop/tray host (Runtime ADR §1), so a production
   * agent has no way to show a human the code and therefore refuses to pair (`503 approval_unavailable`)
   * rather than accepting a confirm any local process could forge.
   */
  approvalPresenter?: ApprovalPresenter;
  now?: () => number;
  /** When present, mounts the SEPARATE projection transport alongside the G1 status channel. */
  projection?: AgentProjectionConfig;
  /** When present, hosts one Action Window session over the existing `/bridge/ws` opaque passthrough. */
  actionWindow?: AgentActionWindowConfig;
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
  /** Test-only access to the hosted Action Window session (undefined unless configured). */
  readonly actionWindowSession: ActionWindowSession | undefined;
}

export function createAgentBridge(cfg: AgentBridgeConfig): AgentBridge {
  const store = new FilePairingStore(cfg.pairingFile, { now: cfg.now ?? (() => Date.now()) });
  // Make durable-pairing restart recovery observable exactly once at boot. Sanitized: a coarse status enum
  // plus counts only — never a pairingId/origin/token/hash. Lets an operator tell "restored N pairings" from
  // a corrupt store (re-pair required) from a fresh install.
  log("bridge_pairing_store_loaded", { ...store.loadResult });
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
  // Action Window hosting (R2B + R3 persistence): endpoint + engine + session are assembled here so
  // the CLI only decides WHETHER to host a run. With a persistDir, an interrupted persisted run is
  // resumed (its identity wins the announcement); otherwise a new run is created — persisted after
  // every verified transition. The driver is injected (synthetic by default — no browser).
  let actionWindow: ActionWindowEndpoint | undefined;
  let actionWindowSession: ActionWindowSession | undefined;
  if (cfg.actionWindow) {
    const aw = cfg.actionWindow;
    const resumable = aw.persistDir ? findResumableRun(aw.persistDir) : null;
    actionWindow = new ActionWindowEndpoint({
      runId: resumable?.runId ?? aw.runId,
      channelCode: resumable?.channelCode ?? aw.channelCode,
    });
    if (aw.persistDir) {
      const deps = { dir: aw.persistDir, transport: actionWindow.transport, driver: aw.createDriver() };
      const opened = resumable
        ? resumePersistedRunSession(deps, resumable)
        : createPersistentRunSession(deps, { runId: aw.runId, channelCode: aw.channelCode, runCopyKey: aw.runCopyKey });
      actionWindowSession = opened.session;
      log("aw_run_hosted", { origin: opened.origin, ...(opened.resumeState ? { resumeState: opened.resumeState } : {}) });
    } else {
      actionWindowSession = new ActionWindowSession(
        new ActionWindowEngine({ runId: aw.runId, channelCode: aw.channelCode, runCopyKey: aw.runCopyKey }),
        aw.createDriver(),
        actionWindow.transport,
      );
    }
  }
  actionWindowSession?.attach();
  const server = new BridgeServer({
    store,
    allowedOrigins: cfg.allowedOrigins,
    agentVersion: cfg.agentVersion,
    port: cfg.port,
    autoApprovePairing: cfg.autoApprovePairing,
    ...(cfg.approvalPresenter ? { approvalPresenter: cfg.approvalPresenter } : {}),
    projection,
    actionWindow,
  });
  const settle = settleObserverToPort(server.events, cfg.refSalt);
  let active = false;

  return {
    server,
    actionWindowSession,
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
