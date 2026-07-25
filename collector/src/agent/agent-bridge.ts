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
import { ReplySubmissionEndpoint } from "../bridge/reply-submission-endpoint";
import { assembleReplyRun, recoverReplyRuns, makeReplyRunMarker } from "../action-window/reply-submission/reply-dispatch";
import type { ReplySubmitProbeDriver } from "../action-window/reply-submission/reply-driver";
import type { ReplyTargetHint } from "../action-window/reply-submission/reply-surface";
import type { ReplyRunMode } from "../action-window/reply-submission/reply-stages";
import type { ReplySubmitSession } from "../action-window/reply-submission/reply-session";
import { InitialImportEndpoint } from "../bridge/initial-import-endpoint";
import { makeImportRunMarker, recoverImportRuns } from "../action-window/initial-import/import-dispatch";
import type { ImportProbeDriver } from "../action-window/initial-import/import-driver";
import { ImportSegmentHost, type ResolvedLaunchScope } from "../action-window/initial-import/import-host";
import type { AwCarrierEndpoint } from "../bridge/aw-carrier";
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

/**
 * Optional ISOLATED reply-submission session hosting (v2). Mutually exclusive with {@link AgentActionWindowConfig}
 * — an agent hosts EITHER an export run OR a reply-submission run, never both, so exactly one carrier
 * endpoint is ever mounted. The driver factory is injected so the default boot stays synthetic/fixture
 * (no browser); the Runtime never submits. With a `persistDir`, restart recovery PARKS any interrupted
 * reply run (never resumes/re-drives it), then a fresh run is minted for the next submission.
 */
export interface AgentReplySubmissionConfig {
  /** Opaque run identity announced to paired clients (assigned by the Runtime, never by the FE). */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `naver`). */
  channelCode: string;
  /** Opaque 16-hex binding to an approved reply — never text or a review id. */
  submissionRef?: string;
  /** Privacy-safe guided target metadata (row locator). Present → guided run; absent → legacy. NEVER persisted/emitted. */
  targetHint?: ReplyTargetHint;
  /** Run mode. `ABORT_REHEARSAL` (requires a `targetHint`) makes the submitted terminal unreachable. */
  mode?: ReplyRunMode;
  createDriver: (hint?: ReplyTargetHint) => ReplySubmitProbeDriver;
  /** Gitignored `.reply-runs/` persistence dir. Required in live mode; restart recovery → PARKED. */
  persistDir?: string;
}

/**
 * One guided initial-review-import segment, hosted over the same opaque `/bridge/ws` passthrough.
 *
 * Mutually exclusive with both `actionWindow` and `replySubmission` — an agent hosts ONE carrier, and the
 * three are different carrier kinds precisely so a frontend cannot attach to the wrong one.
 */
export interface AgentImportConfig {
  /**
   * Placeholder run identity for the FIRST announcement only. The real per-segment identity is minted by
   * {@link ImportSegmentHost} when a launch ref actually arrives — this exists so a frontend attaching
   * before any run has started still sees that an agent is present.
   */
  announceRunId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `naver`). */
  channelCode: string;
  /**
   * Ask the SERVER what a launch ref authorizes.
   *
   * The ref is NOT known at boot — it arrives inside `START_RUN`, one per segment — and the required
   * window must come from the server rather than the client, or a frontend could widen its own import
   * scope. That asymmetry is the whole reason an import needs a host and the other two carriers do not.
   */
  resolveScope: (launchRef: string) => Promise<ResolvedLaunchScope | null>;
  /**
   * The driver. No default and no factory fallback: on the product path this is the LIVE driver, and a
   * fixture driver reaching production would report imports that never happened.
   */
  driver: ImportProbeDriver;
  /** Gitignored `.import-runs/` persistence dir. Restart recovery ABANDONS; it never re-drives. */
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
  /** When present, hosts one ISOLATED reply-submission session (v2). Mutually exclusive with `actionWindow`. */
  replySubmission?: AgentReplySubmissionConfig;
  /** When present, hosts one ISOLATED import segment (v2). Mutually exclusive with the other two. */
  initialImport?: AgentImportConfig;
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
  /** Test-only access to the hosted reply-submission session (undefined unless configured). */
  readonly replySubmissionSession: ReplySubmitSession | undefined;
  /** The import segment host, when this agent hosts the import carrier. Assembles one run per segment. */
  readonly importHost: ImportSegmentHost | undefined;
}

export function createAgentBridge(cfg: AgentBridgeConfig): AgentBridge {
  // An agent hosts EITHER an export run OR a reply-submission run — never both (one carrier slot).
  // Fail fast before any I/O.
  if (cfg.actionWindow && cfg.replySubmission) {
    throw new Error("agent-bridge: actionWindow and replySubmission are mutually exclusive");
  }
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

  // ISOLATED reply-submission hosting (v2). Restart recovery PARKS any interrupted run (never resumes/
  // re-drives it — a reply POST is not idempotent), then a fresh run is minted for the next submission.
  // The reply endpoint occupies the SAME single carrier slot as export (they are mutually exclusive).
  let replyEndpoint: ReplySubmissionEndpoint | undefined;
  let replySubmissionSession: ReplySubmitSession | undefined;
  if (cfg.replySubmission) {
    const rs = cfg.replySubmission;
    if (rs.persistDir) {
      const { parked } = recoverReplyRuns(rs.persistDir, makeReplyRunMarker());
      if (parked.length > 0) log("aw_reply_run_parked", { count: parked.length });
    }
    replyEndpoint = new ReplySubmissionEndpoint({ runId: rs.runId, channelCode: rs.channelCode });
    const assembly = assembleReplyRun(replyEndpoint.transport, {
      runId: rs.runId,
      channelCode: rs.channelCode,
      ...(rs.submissionRef ? { submissionRef: rs.submissionRef } : {}),
      ...(rs.targetHint ? { targetHint: rs.targetHint } : {}),
      ...(rs.mode ? { mode: rs.mode } : {}),
      createDriver: rs.createDriver,
      ...(rs.persistDir ? { persistDir: rs.persistDir } : {}),
    });
    replySubmissionSession = assembly.session;
    replySubmissionSession.attach();
    log("aw_reply_run_hosted", {});
  }

  // ISOLATED import hosting (v2). Restart recovery ABANDONS any interrupted run — it is never resumed,
  // because resuming would require the launch ref to have been persisted, and an importRef is a
  // single-use ingest authorization (see import-run-store). The segment itself is not lost: the server
  // holds the plan and coverage, so the next run picks it up with a fresh ticket.
  let importEndpoint: InitialImportEndpoint | undefined;
  let importHost: ImportSegmentHost | undefined;
  if (cfg.initialImport) {
    const im = cfg.initialImport;
    if (im.persistDir) {
      const { abandoned, abandonedAfterDownload } = recoverImportRuns(im.persistDir, makeImportRunMarker());
      if (abandoned.length > 0) {
        // The two counts mean different things to a seller: one group cost them nothing, the other cost
        // them an export window they will have to repeat.
        log("aw_import_run_abandoned", {
          count: abandoned.length,
          afterDownload: abandonedAfterDownload.length,
        });
      }
    }
    importEndpoint = new InitialImportEndpoint({ runId: im.announceRunId, channelCode: im.channelCode });
    // The host owns per-segment assembly. Nothing is built here, because at boot the agent does not know
    // which segment it is about to guide — see AgentImportConfig.resolveScope.
    importHost = new ImportSegmentHost({
      endpoint: importEndpoint,
      channelCode: im.channelCode,
      resolveScope: im.resolveScope,
      driver: im.driver,
      ...(im.persistDir ? { persistDir: im.persistDir } : {}),
    });
    importHost.attach();
    log("aw_import_host_ready", {});
  }

  // ONE carrier per agent. The order states the precedence explicitly rather than relying on which
  // config the CLI happened to build: import wins over reply, reply over export. The CLI already refuses
  // to build more than one, so this is defence in depth, not the decision point.
  const carrier: AwCarrierEndpoint | undefined = importEndpoint ?? replyEndpoint ?? actionWindow;
  const server = new BridgeServer({
    store,
    allowedOrigins: cfg.allowedOrigins,
    agentVersion: cfg.agentVersion,
    port: cfg.port,
    autoApprovePairing: cfg.autoApprovePairing,
    ...(cfg.approvalPresenter ? { approvalPresenter: cfg.approvalPresenter } : {}),
    projection,
    actionWindow: carrier,
  });
  const settle = settleObserverToPort(server.events, cfg.refSalt);
  let active = false;

  return {
    server,
    actionWindowSession,
    replySubmissionSession,
    importHost,
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
