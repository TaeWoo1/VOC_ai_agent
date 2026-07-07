/**
 * **Progressive Reconnect Composition Service** (M-Agent-Auth-Progressive-Reconnect).
 *
 * Assembles the device-local progressive-reconnect ladder into a callable composition service: it owns
 * ONE progressive runtime per connection (created through an injected factory) and exposes the lifecycle
 * operations — **startup**, **session-loss**, **human-completion**, **stop**, **account-removal** — plus
 * the sanitized intents.
 *
 * **NOT yet wired into production startup.** There is currently NO Local Agent startup/composition root
 * (no CLI, no server bootstrap) that constructs or calls this service; the whole Local Agent lifecycle is
 * exercised only by unit tests. `createProgressiveReconnectRuntimeFactory` / `createLocalAgentProgressiveService`
 * are provided as the **FUTURE WIRING SEAM** (they build the live `ProgressiveReconnectChromeBrowser`), but
 * the actual production startup wiring — a real entrypoint that calls `start`/`sessionLost`/… on agent boot,
 * and that would stop constructing the legacy two-step `LocalAgentReconnectService` on that path — remains a
 * SEPARATE, not-yet-existing slice. This module does not itself integrate into a running lifecycle.
 *
 * **One-shot intents** (matching the catch-up acknowledge idiom): the runtime's surfaced intents are
 * consumed ONCE — `drainUserActionRequests` returns pending user-action requests and clears them, and
 * `acknowledgeCatchUp` consumes a single catch-up intent idempotently. `getSnapshot` is a PURE read
 * (repeated reads never duplicate effects); it reports the current awaited action + whether a catch-up
 * is pending, but never consumes.
 *
 * Boundaries: **no catch-up execution** (recorded/acknowledged only — never runs export/upload/backend),
 * no UI, no persistence migration, no scheduler, no Device Vault. Browser ownership is preserved while
 * waiting for the human (WAITING/HUMAN keep the runtime + live browser alive); the browser is closed
 * ONLY on stop/removeAccount. The runtime/browser/policy modules are reused UNCHANGED.
 */

import { ProgressiveReconnectRuntime, type ProgressiveReconnectSink } from "./progressive-reconnect-runtime";
import { ProgressiveReconnectChromeBrowser } from "./progressive-reconnect-chrome";
import type { ProgressiveReconnectConnection, ProgressiveReconnectState, ReconnectPath, UserActionCategory } from "./progressive-reconnect";
import type { LocalAgentState, SanitizedAccountRef } from "./local-agent-state";

/** The subset of the runtime this service drives (structural — `ProgressiveReconnectRuntime` conforms). */
export interface ProgressiveReconnectRuntimeLike {
  start(): Promise<ProgressiveReconnectState>;
  sessionLost(): Promise<ProgressiveReconnectState>;
  humanCompleted(action: UserActionCategory): Promise<ProgressiveReconnectState>;
  stop(): Promise<ProgressiveReconnectState>;
  close(): Promise<void>;
  getState(): ProgressiveReconnectState;
}

/** Creates one per-connection runtime. Production wires the live browser; tests inject a fake/spy. */
export interface ProgressiveReconnectRuntimeFactory {
  create(connection: ProgressiveReconnectConnection, sink: ProgressiveReconnectSink): ProgressiveReconnectRuntimeLike;
}

/** A sanitized, PURE snapshot of one connection's progressive-reconnect outcome. */
export interface ProgressiveIntegrationResult {
  connectionId: string;
  /** The progressive phase mapped onto the existing Local Agent lifecycle state. */
  localAgentState: LocalAgentState;
  reconnectPath: ReconnectPath | null;
  /** The human action currently awaited (WAITING / HUMAN), or null. Pure read. */
  pendingUserAction: UserActionCategory | null;
  /** True while an unacknowledged catch-up intent is pending. Pure read (does NOT consume). */
  pendingCatchUp: boolean;
}

/**
 * Map a progressive-reconnect state onto the existing `LocalAgentState`. The progressive machine
 * REUSES the `LocalAgentState` enum for its `phase`, so the settled phases (READY /
 * WAITING_FOR_CREDENTIAL_SELECTION / HUMAN_RECONNECT_REQUIRED / STOPPED) map directly.
 */
export function localAgentStateFromProgressive(state: ProgressiveReconnectState): LocalAgentState {
  return state.phase;
}

/**
 * One-shot intent sink (per connection). Records the runtime's surfaced intents and consumes them
 * exactly once — mirrors the catch-up acknowledge idiom so a request is never handled twice.
 */
class ConnectionIntentSink implements ProgressiveReconnectSink {
  private userActionQueue: UserActionCategory[] = [];
  private pendingCatchUps = 0;

  requestCatchUp(_account: SanitizedAccountRef): void {
    this.pendingCatchUps += 1;
  }
  emitUserAction(_account: SanitizedAccountRef, action: UserActionCategory): void {
    this.userActionQueue.push(action);
  }
  /** Return + CLEAR the pending user-action requests (a second drain returns []). */
  drainUserActionRequests(): UserActionCategory[] {
    const drained = this.userActionQueue;
    this.userActionQueue = [];
    return drained;
  }
  /** Consume ONE pending catch-up intent; true if one was pending, false otherwise (idempotent tail). */
  acknowledgeCatchUp(): boolean {
    if (this.pendingCatchUps > 0) { this.pendingCatchUps -= 1; return true; }
    return false;
  }
  hasPendingCatchUp(): boolean {
    return this.pendingCatchUps > 0;
  }
}

interface ConnectionEntry {
  runtime: ProgressiveReconnectRuntimeLike;
  intents: ConnectionIntentSink;
}

/** One instance manages all connections' progressive reconnect, keyed by connection id (isolated). */
export class LocalAgentProgressiveService {
  private readonly byConnection = new Map<string, ConnectionEntry>();

  constructor(private readonly factory: ProgressiveReconnectRuntimeFactory) {}

  /** Agent startup: create (or reuse) the per-connection runtime and drive the ladder once. */
  async start(connection: ProgressiveReconnectConnection): Promise<ProgressiveIntegrationResult> {
    const id = connection.account.connectionId;
    let entry = this.byConnection.get(id);
    if (!entry) {
      const intents = new ConnectionIntentSink();
      entry = { runtime: this.factory.create(connection, intents), intents };
      this.byConnection.set(id, entry);
    }
    await entry.runtime.start();
    return this.snapshot(id);
  }

  /** Explicit session-loss → permit one new automatic attempt on the existing runtime. */
  async sessionLost(connectionId: string): Promise<ProgressiveIntegrationResult | null> {
    const entry = this.byConnection.get(connectionId);
    if (!entry) return null;
    await entry.runtime.sessionLost();
    return this.snapshot(connectionId);
  }

  /** The human completed a fallback action → one fresh inspection on the SAME (still-open) browser. */
  async humanCompleted(connectionId: string, action: UserActionCategory): Promise<ProgressiveIntegrationResult | null> {
    const entry = this.byConnection.get(connectionId);
    if (!entry) return null;
    await entry.runtime.humanCompleted(action);
    return this.snapshot(connectionId);
  }

  /** Stop the connection's lifecycle AND close its browser; forget the connection. Idempotent. */
  async stop(connectionId: string): Promise<void> {
    const entry = this.byConnection.get(connectionId);
    if (!entry) return;
    this.byConnection.delete(connectionId);
    try { await entry.runtime.stop(); } finally { await entry.runtime.close(); }
  }

  /** Account removal is stop + close + forget. */
  removeAccount(connectionId: string): Promise<void> {
    return this.stop(connectionId);
  }

  /** Consume (drain) the pending sanitized user-action requests for a connection — once. */
  drainUserActionRequests(connectionId: string): UserActionCategory[] {
    return this.byConnection.get(connectionId)?.intents.drainUserActionRequests() ?? [];
  }

  /** Acknowledge (consume) a single catch-up intent for a connection — once; idempotent tail. */
  acknowledgeCatchUp(connectionId: string): boolean {
    return this.byConnection.get(connectionId)?.intents.acknowledgeCatchUp() ?? false;
  }

  /** PURE current snapshot (never consumes intents). Null if the connection is not managed. */
  getSnapshot(connectionId: string): ProgressiveIntegrationResult | null {
    return this.byConnection.has(connectionId) ? this.snapshot(connectionId) : null;
  }

  /** The current mapped Local Agent state for a connection, or null if it is not managed. */
  getLocalAgentState(connectionId: string): LocalAgentState | null {
    const entry = this.byConnection.get(connectionId);
    return entry ? localAgentStateFromProgressive(entry.runtime.getState()) : null;
  }

  /** True while the connection's runtime (and its live browser) is retained (through WAITING/HUMAN). */
  isBrowserRetained(connectionId: string): boolean {
    return this.byConnection.has(connectionId);
  }

  private snapshot(connectionId: string): ProgressiveIntegrationResult {
    const entry = this.byConnection.get(connectionId);
    if (!entry) throw new Error(`LocalAgentProgressiveService: no runtime for connection ${connectionId}`);
    const prog = entry.runtime.getState();
    return {
      connectionId,
      localAgentState: localAgentStateFromProgressive(prog),
      reconnectPath: prog.path,
      pendingUserAction: prog.pendingUserAction,
      pendingCatchUp: entry.intents.hasPendingCatchUp(),
    };
  }
}

// ── Production composition (wires the live browser port) ─────────────────────────────────────────

/** Config for the production factory. The per-connection profile dir is derived from the base dir. */
export interface ProgressiveReconnectServiceConfig {
  /** In-tree base dir; each connection gets `${profileBaseDir}/${dedicatedProfileId}`. */
  profileBaseDir: string;
  /** Login-form / loginMode / credential surface only (never a LOGGED_IN verdict). */
  authSurfaceUrl: string;
  /** Seller-center session-gated probe surface — the ONLY surface that may yield LOGGED_IN. */
  sessionProbeUrl: string;
  allowlist: readonly string[];
  salt: string;
  chromePath?: string;
}

/** Production factory: builds a real `ProgressiveReconnectChromeBrowser` per connection. */
export function createProgressiveReconnectRuntimeFactory(config: ProgressiveReconnectServiceConfig): ProgressiveReconnectRuntimeFactory {
  return {
    create(connection: ProgressiveReconnectConnection, sink: ProgressiveReconnectSink): ProgressiveReconnectRuntimeLike {
      const browser = new ProgressiveReconnectChromeBrowser({
        profileDir: `${config.profileBaseDir}/${connection.dedicatedProfileId}`,
        authSurfaceUrl: config.authSurfaceUrl,
        sessionProbeUrl: config.sessionProbeUrl,
        allowlist: config.allowlist,
        salt: config.salt,
        chromePath: config.chromePath,
      });
      return new ProgressiveReconnectRuntime(connection, browser, sink);
    },
  };
}

/** The production composition entrypoint: a wired `LocalAgentProgressiveService`. */
export function createLocalAgentProgressiveService(config: ProgressiveReconnectServiceConfig): LocalAgentProgressiveService {
  return new LocalAgentProgressiveService(createProgressiveReconnectRuntimeFactory(config));
}
