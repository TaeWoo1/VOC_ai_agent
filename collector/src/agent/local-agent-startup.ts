/**
 * **Local Agent startup / composition root** (M-Agent-Auth-Progressive-Reconnect).
 *
 * The device-local production entrypoint that finally WIRES the progressive-reconnect ladder into a
 * running lifecycle. It owns ONE {@link LocalAgentProgressiveService} for the whole device, boots the
 * configured connections through it, surfaces the sanitized intents, and tears everything down cleanly
 * on shutdown. This is the slice that turns the composition service's "future wiring seam" into an
 * actual startup path.
 *
 * **Only the progressive path.** This root constructs `LocalAgentProgressiveService` and NOTHING else —
 * it never builds the legacy two-step `LocalAgentRuntime` reconnect lifecycle. A device that boots
 * through here runs the progressive ladder exclusively.
 *
 * **Local-device only.** No tray UI, no installer, no OS auto-start, no Device Vault, no catch-up
 * execution, no backend write, no persistence migration.
 *
 * **Intent handling — user-action vs catch-up differ deliberately:**
 *  - A *user-action* request is HANDLED by surfacing it, so it is drained (consumed) exactly once and
 *    reported; a second drain for the same step is empty.
 *  - A *catch-up* request means "run one catch-up sync". Executing catch-up is OUT OF SCOPE here, so
 *    this root NEVER acknowledges/consumes it — that would falsely mark it done. It stays PENDING and is
 *    exposed (`pendingCatchUp`) as a PURE read. Repeated reads never duplicate it, and shutdown surfaces
 *    any still-pending catch-up rather than silently discarding it as completed.
 *
 * **Connection isolation.** Each connection is managed independently: a connection whose `start` throws
 * never aborts the others, a malformed configured entry is skipped (not fatal) so the rest still boot,
 * routing addresses exactly one connection by id, and one connection's failed teardown never blocks the
 * rest. Everything crossing this boundary is a sanitized enum / boolean.
 */

import { LocalAgentProgressiveService, createLocalAgentProgressiveService, type ProgressiveReconnectServiceConfig } from "./local-agent-progressive-service";
import {
  dedicatedProfileIdFor,
  initialFormStrategyForMode,
  type ProgressiveReconnectConnection,
  type ReconnectPath,
  type UserActionCategory,
  type LoginMode,
  type AutoReconnectCapability,
} from "./progressive-reconnect";
import type { LocalAgentState, SanitizedAccountRef } from "./local-agent-state";

/** A sanitized, PURE progressive snapshot (the shape the service returns / exposes). */
export interface ProgressiveSnapshot {
  localAgentState: LocalAgentState;
  reconnectPath: ReconnectPath | null;
  pendingUserAction: UserActionCategory | null;
  /** True while an unexecuted catch-up intent is pending. PURE read (never consumed here). */
  pendingCatchUp: boolean;
}

/** A sanitized per-connection outcome of one lifecycle step. Only enums / booleans — never raw data. */
export interface LocalAgentStartupResult {
  connectionId: string;
  /** False when the underlying `start` threw — the connection is isolated (still torn down on shutdown). */
  started: boolean;
  /** The progressive phase mapped onto the Local Agent lifecycle, or null when `start` threw. */
  localAgentState: LocalAgentState | null;
  reconnectPath: ReconnectPath | null;
  /** The human action currently awaited (WAITING / HUMAN), or null. */
  pendingUserAction: UserActionCategory | null;
  /** The user-action requests surfaced+drained this step (one-shot). */
  userActions: UserActionCategory[];
  /**
   * True iff a catch-up sync is requested but NOT executed. Catch-up execution is out of scope, so this
   * stays PENDING — the root never acknowledges it. A PURE read; reading it never consumes it.
   */
  pendingCatchUp: boolean;
}

/** The sanitized outcome of a clean shutdown. */
export interface LocalAgentShutdownReport {
  /** Connections whose teardown completed. */
  stoppedConnectionIds: string[];
  /**
   * Connections that STILL had an unexecuted catch-up pending at shutdown. Surfaced — never silently
   * discarded as "completed" — since catch-up execution is out of scope.
   */
  pendingCatchUpConnectionIds: string[];
}

/** Optional observer for the sanitized settle of each lifecycle step (e.g. a CLI printer / notifier). */
export interface LocalAgentStartupObserver {
  onConnectionSettled(result: LocalAgentStartupResult): void;
}

/**
 * The subset of {@link LocalAgentProgressiveService} the startup root drives (structural — the real
 * service conforms). Note the absence of `acknowledgeCatchUp`: the root deliberately never consumes a
 * catch-up intent (execution is out of scope), it only READS `pendingCatchUp` from the snapshot.
 */
export interface ProgressiveServiceLike {
  start(connection: ProgressiveReconnectConnection): Promise<ProgressiveSnapshot>;
  sessionLost(connectionId: string): Promise<ProgressiveSnapshot | null>;
  humanCompleted(connectionId: string, action: UserActionCategory): Promise<ProgressiveSnapshot | null>;
  stop(connectionId: string): Promise<void>;
  drainUserActionRequests(connectionId: string): UserActionCategory[];
  /** PURE current snapshot (never consumes) — used to read `pendingCatchUp` at shutdown / after a throw. */
  getSnapshot(connectionId: string): ProgressiveSnapshot | null;
}

/**
 * The device-local startup / composition root. Boots the configured connections through ONE progressive
 * service, surfaces their intents (draining user-actions one-shot; leaving catch-up pending), routes
 * explicit session-loss / human-completion events, and shuts every managed connection down (closing its
 * browser) exactly once.
 */
export class LocalAgentStartup {
  /** Every connection this root has taken ownership of (insertion order); the shutdown set. */
  private readonly managed = new Set<string>();
  private booted = false;

  constructor(
    private readonly service: ProgressiveServiceLike,
    private readonly observer?: LocalAgentStartupObserver,
  ) {}

  /**
   * Boot the device: start each configured connection through the service, in isolation. A connection
   * whose `start` throws is recorded as `started:false` and never aborts the others; every connection
   * (including a partial start) is retained for shutdown so its browser is always closed. Returns one
   * sanitized result per connection, in the input order.
   */
  async boot(connections: readonly ProgressiveReconnectConnection[]): Promise<LocalAgentStartupResult[]> {
    if (this.booted) {
      throw new Error("LocalAgentStartup.boot: already booted (construct a new root to boot again)");
    }
    this.booted = true;
    const results: LocalAgentStartupResult[] = [];
    for (const connection of connections) {
      results.push(await this.startOne(connection));
    }
    return results;
  }

  /** Explicit session-loss for one connection → one new automatic attempt, then surface its intents. */
  async routeSessionLost(connectionId: string): Promise<LocalAgentStartupResult | null> {
    if (!this.managed.has(connectionId)) return null;
    const snapshot = await this.service.sessionLost(connectionId);
    if (snapshot === null) return null;
    return this.settle(connectionId, snapshot, true);
  }

  /** Explicit human-completion for one connection → one fresh inspection, then surface its intents. */
  async routeHumanCompleted(connectionId: string, action: UserActionCategory): Promise<LocalAgentStartupResult | null> {
    if (!this.managed.has(connectionId)) return null;
    const snapshot = await this.service.humanCompleted(connectionId, action);
    if (snapshot === null) return null;
    return this.settle(connectionId, snapshot, true);
  }

  /**
   * Shut the device down: stop every managed connection (closing its browser) exactly once, in the order
   * they were taken on. Any still-pending, unexecuted catch-up is READ (never acknowledged) and surfaced
   * in the report before teardown — never silently marked completed. One connection's failed teardown
   * never blocks the rest. Idempotent — a second shutdown is a no-op.
   */
  async shutdown(): Promise<LocalAgentShutdownReport> {
    const ids = [...this.managed];
    this.managed.clear();
    const stoppedConnectionIds: string[] = [];
    const pendingCatchUpConnectionIds: string[] = [];
    for (const id of ids) {
      // PURE read BEFORE teardown — surface a still-pending catch-up, never discard it as done.
      if (this.service.getSnapshot(id)?.pendingCatchUp === true) {
        pendingCatchUpConnectionIds.push(id);
      }
      try {
        await this.service.stop(id);
        stoppedConnectionIds.push(id);
      } catch {
        // Isolation: a single connection's teardown failure must not block the others' cleanup.
      }
    }
    return { stoppedConnectionIds, pendingCatchUpConnectionIds };
  }

  /** The connection ids this root currently owns (would be torn down on shutdown). */
  managedConnectionIds(): string[] {
    return [...this.managed];
  }

  private async startOne(connection: ProgressiveReconnectConnection): Promise<LocalAgentStartupResult> {
    const id = connection.account.connectionId;
    // Take ownership BEFORE starting so shutdown always closes the browser, even on a partial start.
    this.managed.add(id);
    try {
      const snapshot = await this.service.start(connection);
      return this.settle(id, snapshot, true);
    } catch {
      // Isolation: a failed connection is reported and skipped, never thrown — the boot continues.
      const userActions = this.service.drainUserActionRequests(id);
      const pendingCatchUp = this.service.getSnapshot(id)?.pendingCatchUp === true;
      const result: LocalAgentStartupResult = {
        connectionId: id,
        started: false,
        localAgentState: null,
        reconnectPath: null,
        pendingUserAction: null,
        userActions,
        pendingCatchUp,
      };
      this.observer?.onConnectionSettled(result);
      return result;
    }
  }

  /**
   * Build the sanitized result for a settled step: drain the one-shot user-action requests, READ (never
   * consume) the pending-catch-up flag, then notify.
   */
  private settle(connectionId: string, snapshot: ProgressiveSnapshot, started: boolean): LocalAgentStartupResult {
    const userActions = this.service.drainUserActionRequests(connectionId);
    const result: LocalAgentStartupResult = {
      connectionId,
      started,
      localAgentState: snapshot.localAgentState,
      reconnectPath: snapshot.reconnectPath,
      pendingUserAction: snapshot.pendingUserAction,
      userActions,
      pendingCatchUp: snapshot.pendingCatchUp, // PURE read — the catch-up intent stays pending.
    };
    this.observer?.onConnectionSettled(result);
    return result;
  }
}

// ── Configured-connection loading (sanitized, offline, resilient) ──────────────────────────────────

/**
 * A sanitized connection descriptor as it appears in the local device config (never a credential,
 * store id, cookie, token, URL, or DOM). The derived `account` fingerprint / profile id / initial-form
 * strategy are computed by {@link parseProgressiveConnections}, not carried here.
 */
export interface ProgressiveConnectionDescriptor {
  connectionId: string;
  loginMode: LoginMode;
  autoReconnectConsent: boolean;
  autoSubmitConsent: boolean;
  assistedReconnectConsent: boolean;
  /** Optional previously-measured device capability; defaults to `UNKNOWN` (never claims VERIFIED). */
  autoReconnectCapability?: AutoReconnectCapability;
}

/** The resilient parse outcome: the valid connections plus a sanitized record of what was skipped. */
export interface ParsedProgressiveConnections {
  connections: ProgressiveReconnectConnection[];
  /** 0-based indexes of entries rejected as malformed — surfaced, never silently dropped. */
  rejectedEntryIndexes: number[];
  /** Connection ids seen more than once (the first is kept; later ones dropped) — surfaced. */
  duplicateConnectionIds: string[];
}

export type ParseProgressiveConnectionsResult =
  | { ok: true; value: ParsedProgressiveConnections }
  | { ok: false; errorCategory: "invalid-json" | "not-an-array" | "empty" };

const LOGIN_MODES: ReadonlySet<string> = new Set<LoginMode>(["ESM_PLUS", "GMARKET", "AUCTION"]);
const CAPABILITIES: ReadonlySet<string> = new Set<AutoReconnectCapability>(["VERIFIED", "CONDITIONAL", "ASSISTED_ONLY", "UNKNOWN"]);

/** Build the sanitized, hash-only account ref for a configured connection (no store fingerprint yet). */
function accountRefFor(connectionId: string): SanitizedAccountRef {
  return { connectionId, boundStoreFingerprintHash: null, fingerprintSourceCategory: null };
}

/** Validate ONE descriptor and derive its full progressive connection, or null when malformed. */
function connectionFromDescriptor(raw: unknown): ProgressiveReconnectConnection | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.connectionId !== "string" || d.connectionId.trim().length === 0) return null;
  if (typeof d.loginMode !== "string" || !LOGIN_MODES.has(d.loginMode)) return null;
  if (typeof d.autoReconnectConsent !== "boolean") return null;
  if (typeof d.autoSubmitConsent !== "boolean") return null;
  if (typeof d.assistedReconnectConsent !== "boolean") return null;
  let capability: AutoReconnectCapability = "UNKNOWN";
  if (d.autoReconnectCapability !== undefined) {
    if (typeof d.autoReconnectCapability !== "string" || !CAPABILITIES.has(d.autoReconnectCapability)) return null;
    capability = d.autoReconnectCapability as AutoReconnectCapability;
  }
  const loginMode = d.loginMode as LoginMode;
  const account = accountRefFor(d.connectionId);
  return {
    account,
    loginMode,
    dedicatedProfileId: dedicatedProfileIdFor(account),
    initialFormStrategy: initialFormStrategyForMode(loginMode),
    autoReconnectCapability: capability,
    autoReconnectConsent: d.autoReconnectConsent,
    autoSubmitConsent: d.autoSubmitConsent,
    assistedReconnectConsent: d.assistedReconnectConsent,
  };
}

/**
 * Parse the sanitized device connection config (a JSON array of {@link ProgressiveConnectionDescriptor})
 * into validated {@link ProgressiveReconnectConnection}s. **Resilient, not all-or-nothing:** one malformed
 * entry (or a duplicate id) is SKIPPED and surfaced — it never blocks the other connections from booting.
 * Only a structurally unusable input (malformed JSON, a non-array root, or a literally empty array) fails
 * closed with a sanitized error category. Never throws and never echoes the raw input.
 */
export function parseProgressiveConnections(raw: string): ParseProgressiveConnectionsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errorCategory: "invalid-json" };
  }
  if (!Array.isArray(parsed)) return { ok: false, errorCategory: "not-an-array" };
  if (parsed.length === 0) return { ok: false, errorCategory: "empty" };

  const connections: ProgressiveReconnectConnection[] = [];
  const rejectedEntryIndexes: number[] = [];
  const duplicateConnectionIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    const connection = connectionFromDescriptor(parsed[i]);
    if (connection === null) {
      rejectedEntryIndexes.push(i); // skip a malformed entry — do not block the rest
      continue;
    }
    const id = connection.account.connectionId;
    if (seen.has(id)) {
      duplicateConnectionIds.push(id); // keep the first, drop later duplicates
      continue;
    }
    seen.add(id);
    connections.push(connection);
  }
  return { ok: true, value: { connections, rejectedEntryIndexes, duplicateConnectionIds } };
}

// ── Production composition ──────────────────────────────────────────────────────────────────────────

/** Config for the production startup root — the live progressive-service config, unchanged. */
export type LocalAgentStartupConfig = ProgressiveReconnectServiceConfig;

/**
 * Build the production startup root: one wired {@link LocalAgentProgressiveService} (which builds the
 * live `ProgressiveReconnectChromeBrowser` per connection) driven by a {@link LocalAgentStartup}. This
 * is the ONLY production path that assembles the progressive lifecycle — it never constructs the legacy
 * reconnect runtime.
 */
export function createLocalAgentStartup(
  config: LocalAgentStartupConfig,
  observer?: LocalAgentStartupObserver,
): LocalAgentStartup {
  const service: LocalAgentProgressiveService = createLocalAgentProgressiveService(config);
  return new LocalAgentStartup(service, observer);
}
