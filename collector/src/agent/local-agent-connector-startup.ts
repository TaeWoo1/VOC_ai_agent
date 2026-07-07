/**
 * **Local Agent CONNECTOR startup / composition root** (multi-channel).
 *
 * The production boot flow, generalized off the progressive-only path
 * ({@link ./local-agent-startup}) onto the channel-agnostic **Connector Orchestrator**. It loads a MIXED
 * set of sanitized connection descriptors (browser channels NAVER/ESM, the API channel Cafe24, and the
 * not-yet-discovered channels), turns each into a {@link ConnectorHandle} through the channel registry,
 * and drives them all through ONE {@link ConnectorOrchestrator} — every connection settled by the single
 * uniform `ChannelConnector.ensureReady()` operation, in isolation.
 *
 * **Progressive Reconnect stays the browser-auth subcomponent.** Browser channels are wired to ONE shared
 * device-wide {@link LocalAgentProgressiveService}; the orchestrator's `BrowserChannelConnector` adapts it
 * per connection. This root does not replace the progressive machine — it is the multi-channel peer of the
 * old `LocalAgentStartup`, sitting above it.
 *
 * **Cafe24 is NOT implemented here.** The API strategy exists in the registry as `NOT_IMPLEMENTED`; no API
 * port is wired, so a Cafe24 (or any API) descriptor produces a `SKIPPED` handle — honest, never a fake
 * connector and never a live API call. Discovery-required channels likewise produce a `SKIPPED` handle.
 *
 * **No ESM coupling in the shape.** The browser runtime config is OPTIONAL and lazily realized: the browser
 * service is constructed ONLY when the boot actually contains a runnable browser connection
 * ({@link isRunnableBrowserConnection} — `BROWSER` + `AVAILABLE`). An API-only or discovery-only config
 * builds no browser service and needs no browser environment values.
 *
 * **Outcomes + intents, never execution.** Each connection surfaces one of the common outcomes
 * (`READY` / `NEEDS_USER_ACTION` / `FAILED` / `SKIPPED`); a `SyncIntent` is GENERATED only when the
 * connection is both `READY` and `AVAILABLE`, and is never executed (no export, fetch, upload, dedup,
 * backend write, or status mutation). Clean shutdown + per-connection failure isolation are inherited from
 * the orchestrator. Everything crossing the boundary is a sanitized enum / boolean.
 *
 * Pure/offline construction: building this root and booting it against a fake service touches no browser /
 * http / fs / backend. The one live seam is {@link createLocalAgentConnectorStartup}, which wires the real
 * progressive service — exactly as the progressive-only root did.
 */

import { createLocalAgentProgressiveService, type ProgressiveReconnectServiceConfig } from "./local-agent-progressive-service";
import type { ProgressiveServiceLike, ProgressiveSnapshot } from "./local-agent-startup";
import type { UserActionCategory } from "./progressive-reconnect";
import {
  dedicatedProfileIdFor,
  initialFormStrategyForMode,
  type ProgressiveReconnectConnection,
  type LoginMode,
  type AutoReconnectCapability,
} from "./progressive-reconnect";
import type { SanitizedAccountRef } from "./local-agent-state";
import {
  ConnectorOrchestrator,
  type ConnectorStartupResult,
  type ConnectorShutdownReport,
  type ConnectorOrchestratorObserver,
} from "../connector/connector-orchestrator";
import {
  CHANNEL_ADAPTERS,
  createConnectorHandle,
  descriptorFor,
  type ConnectorHandle,
  type KnownChannel,
} from "../connector/channel-registry";
import type { ConnectorStrategy } from "../connector/channel-connector";

// ── Mixed connection descriptors (sanitized, offline, resilient) ────────────────────────────────────

/**
 * A sanitized MIXED connection descriptor as it appears in the local device config. Adds `channel` to the
 * progressive descriptor's shape: the browser-auth fields (`loginMode` + the three separate consents +
 * optional measured capability) are REQUIRED for a `BROWSER`-strategy channel and IGNORED for an API /
 * discovery-required one. Never a credential, store id, cookie, token, URL, or DOM.
 */
export interface ConnectorConnectionDescriptor {
  connectionId: string;
  channel: KnownChannel;
  loginMode?: LoginMode;
  autoReconnectConsent?: boolean;
  autoSubmitConsent?: boolean;
  assistedReconnectConsent?: boolean;
  /** Optional previously-measured device capability; defaults to `UNKNOWN` (never claims VERIFIED). */
  autoReconnectCapability?: AutoReconnectCapability;
}

/**
 * One validated connection ready to be turned into a {@link ConnectorHandle}. `strategy` is read from the
 * registry (not the descriptor); `browserConnection` is the progressive-reconnect connection built for a
 * `BROWSER` channel's auth subcomponent, and null for an API / discovery-required channel.
 */
export interface ValidatedConnectorConnection {
  connectionId: string;
  channel: KnownChannel;
  strategy: ConnectorStrategy | null;
  browserConnection: ProgressiveReconnectConnection | null;
}

/** The resilient parse outcome: the valid connections plus a sanitized record of what was skipped. */
export interface ParsedConnectorConnections {
  connections: ValidatedConnectorConnection[];
  /** 0-based indexes of entries rejected as malformed — surfaced, never silently dropped. */
  rejectedEntryIndexes: number[];
  /** Connection ids seen more than once (the first is kept; later ones dropped) — surfaced. */
  duplicateConnectionIds: string[];
}

export type ParseConnectorConnectionsResult =
  | { ok: true; value: ParsedConnectorConnections }
  | { ok: false; errorCategory: "invalid-json" | "not-an-array" | "empty" };

/** Every channel the registry knows of — the allowed `channel` values in a descriptor. */
const KNOWN_CHANNELS: ReadonlySet<string> = new Set<string>(CHANNEL_ADAPTERS.map((d) => d.channel));
const LOGIN_MODES: ReadonlySet<string> = new Set<LoginMode>(["ESM_PLUS", "GMARKET", "AUCTION"]);
const CAPABILITIES: ReadonlySet<string> = new Set<AutoReconnectCapability>(["VERIFIED", "CONDITIONAL", "ASSISTED_ONLY", "UNKNOWN"]);

/** Build the sanitized, hash-only account ref for a configured connection (no store fingerprint yet). */
function accountRefFor(connectionId: string): SanitizedAccountRef {
  return { connectionId, boundStoreFingerprintHash: null, fingerprintSourceCategory: null };
}

/** Assemble the full progressive-reconnect connection for a validated BROWSER descriptor. */
function browserConnectionFrom(
  connectionId: string,
  loginMode: LoginMode,
  consents: { autoReconnectConsent: boolean; autoSubmitConsent: boolean; assistedReconnectConsent: boolean },
  capability: AutoReconnectCapability,
): ProgressiveReconnectConnection {
  const account = accountRefFor(connectionId);
  return {
    account,
    loginMode,
    dedicatedProfileId: dedicatedProfileIdFor(account),
    initialFormStrategy: initialFormStrategyForMode(loginMode),
    autoReconnectCapability: capability,
    autoReconnectConsent: consents.autoReconnectConsent,
    autoSubmitConsent: consents.autoSubmitConsent,
    assistedReconnectConsent: consents.assistedReconnectConsent,
  };
}

/** Validate ONE mixed descriptor and derive its validated connection, or null when malformed. */
function connectionFromDescriptor(raw: unknown): ValidatedConnectorConnection | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.connectionId !== "string" || d.connectionId.trim().length === 0) return null;
  if (typeof d.channel !== "string" || !KNOWN_CHANNELS.has(d.channel)) return null;

  const channel = d.channel as KnownChannel;
  const strategy = descriptorFor(channel)?.strategy ?? null;

  // Browser-auth fields are required ONLY for a browser channel; ignored for API / discovery-required.
  if (strategy === "BROWSER") {
    if (typeof d.loginMode !== "string" || !LOGIN_MODES.has(d.loginMode)) return null;
    if (typeof d.autoReconnectConsent !== "boolean") return null;
    if (typeof d.autoSubmitConsent !== "boolean") return null;
    if (typeof d.assistedReconnectConsent !== "boolean") return null;
    let capability: AutoReconnectCapability = "UNKNOWN";
    if (d.autoReconnectCapability !== undefined) {
      if (typeof d.autoReconnectCapability !== "string" || !CAPABILITIES.has(d.autoReconnectCapability)) return null;
      capability = d.autoReconnectCapability as AutoReconnectCapability;
    }
    const browserConnection = browserConnectionFrom(
      d.connectionId,
      d.loginMode as LoginMode,
      {
        autoReconnectConsent: d.autoReconnectConsent,
        autoSubmitConsent: d.autoSubmitConsent,
        assistedReconnectConsent: d.assistedReconnectConsent,
      },
      capability,
    );
    return { connectionId: d.connectionId, channel, strategy, browserConnection };
  }

  // API (e.g. Cafe24 — NOT wired here) or discovery-required: no browser auth to build.
  return { connectionId: d.connectionId, channel, strategy, browserConnection: null };
}

/**
 * Parse the sanitized MIXED device connection config (a JSON array of {@link ConnectorConnectionDescriptor})
 * into validated connections. **Resilient, not all-or-nothing:** one malformed entry (or a duplicate id) is
 * SKIPPED and surfaced — it never blocks the other connections from booting. Only a structurally unusable
 * input (malformed JSON, a non-array root, or a literally empty array) fails closed with a sanitized error
 * category. Never throws and never echoes the raw input.
 */
export function parseConnectorConnections(raw: string): ParseConnectorConnectionsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errorCategory: "invalid-json" };
  }
  if (!Array.isArray(parsed)) return { ok: false, errorCategory: "not-an-array" };
  if (parsed.length === 0) return { ok: false, errorCategory: "empty" };

  const connections: ValidatedConnectorConnection[] = [];
  const rejectedEntryIndexes: number[] = [];
  const duplicateConnectionIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    const connection = connectionFromDescriptor(parsed[i]);
    if (connection === null) {
      rejectedEntryIndexes.push(i); // skip a malformed entry — do not block the rest
      continue;
    }
    if (seen.has(connection.connectionId)) {
      duplicateConnectionIds.push(connection.connectionId); // keep the first, drop later duplicates
      continue;
    }
    seen.add(connection.connectionId);
    connections.push(connection);
  }
  return { ok: true, value: { connections, rejectedEntryIndexes, duplicateConnectionIds } };
}

// ── Runnable-browser predicate ─────────────────────────────────────────────────────────────────────

/**
 * True iff this connection actually needs the browser-auth service: a `BROWSER` strategy on an `AVAILABLE`
 * channel (NAVER / ESM today) with its progressive-reconnect connection built. This is the single gate for
 * "does the browser runtime need to exist" — an API / discovery-required connection is never runnable and
 * never touches the browser service.
 */
export function isRunnableBrowserConnection(c: ValidatedConnectorConnection): boolean {
  return c.strategy === "BROWSER" && c.browserConnection !== null && descriptorFor(c.channel)?.implementationStatus === "AVAILABLE";
}

// ── Handle building ────────────────────────────────────────────────────────────────────────────────

/** Per-boot dependencies the composition root injects — a LAZY provider of the shared browser-auth service. */
export interface ConnectorStartupDeps {
  /** Invoked (memoized) ONLY when a runnable browser connection exists; never called for API-only/discovery. */
  browserService: () => ProgressiveServiceLike;
}

/**
 * Turn validated connections into registry handles. A runnable browser connection is wired to the shared
 * progressive service (realized lazily, at most once per boot); every other channel (API-not-implemented,
 * discovery-required) gets NO deps, so the registry returns a `SKIPPED` handle — never a fake connector,
 * never a live call, and never constructs the browser service. Preserves input order.
 */
export function buildConnectorHandles(
  connections: readonly ValidatedConnectorConnection[],
  deps: ConnectorStartupDeps,
): ConnectorHandle[] {
  let cachedService: ProgressiveServiceLike | null = null;
  const sharedService = (): ProgressiveServiceLike => (cachedService ??= deps.browserService());
  return connections.map((c) =>
    isRunnableBrowserConnection(c)
      ? createConnectorHandle(c.channel, c.connectionId, { browser: { service: sharedService(), connection: c.browserConnection! } })
      : createConnectorHandle(c.channel, c.connectionId, {}),
  );
}

// ── Composition root ─────────────────────────────────────────────────────────────────────────────────

/**
 * The device-local MULTI-CHANNEL startup root. Owns one shared browser-auth service and one
 * {@link ConnectorOrchestrator}; boots a mixed connection set through it (each via a single
 * `ensureReady()`), surfaces the sanitized per-connection results, and shuts every managed connection down
 * cleanly. Boot exactly once (the orchestrator enforces it).
 */
export class LocalAgentConnectorStartup {
  private readonly orchestrator: ConnectorOrchestrator;
  /** The shared browser-auth service, realized at most once (only when a runnable browser connection
   * exists). Retained so a post-boot `humanCompleted` can re-verify the SAME live browser. */
  private cachedBrowserService: ProgressiveServiceLike | null = null;

  constructor(
    /** Lazy provider of the shared browser-auth service — realized only when a runnable browser connection exists. */
    private readonly browserServiceProvider: () => ProgressiveServiceLike,
    observer?: ConnectorOrchestratorObserver,
  ) {
    this.orchestrator = new ConnectorOrchestrator(observer);
  }

  /** Realize (once) and retain the shared browser-auth service. */
  private sharedBrowserService(): ProgressiveServiceLike {
    return (this.cachedBrowserService ??= this.browserServiceProvider());
  }

  /**
   * Same-process re-verification: the operator finished the pending fallback action for `connectionId`,
   * so run exactly ONE fresh in-session inspection on the STILL-OPEN browser (never a cold restart). The
   * transition reaches READY/LOGGED_IN only when the session-probe inspection verifies it; otherwise it
   * stays NEEDS_USER_ACTION. Returns the sanitized snapshot, or null when no browser service was realized
   * (e.g. an API/discovery-only boot) or the connection is unmanaged.
   */
  async humanCompleted(connectionId: string, action: UserActionCategory): Promise<ProgressiveSnapshot | null> {
    if (this.cachedBrowserService === null) return null;
    return this.cachedBrowserService.humanCompleted(connectionId, action);
  }

  /**
   * Boot the device: build a handle per validated connection (runnable browser channels wired to the shared
   * service, everything else a `SKIPPED` handle) and drive them all through the orchestrator, in isolation
   * and in order. The browser service is constructed only if the set contains a runnable browser
   * connection. Returns one sanitized {@link ConnectorStartupResult} per connection.
   */
  async boot(connections: readonly ValidatedConnectorConnection[]): Promise<ConnectorStartupResult[]> {
    return this.orchestrator.boot(buildConnectorHandles(connections, { browserService: () => this.sharedBrowserService() }));
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

// ── Production composition ──────────────────────────────────────────────────────────────────────────

/** The live browser-auth runtime config (the progressive-service config) — needed only for browser channels. */
export type LocalAgentBrowserRuntimeConfig = ProgressiveReconnectServiceConfig;

/**
 * Config for the production connector startup root. The browser runtime config is OPTIONAL: it is required
 * only when the boot contains a runnable browser connection. An API-only or discovery-only device may omit
 * it entirely — no ESM/browser environment values are mandatory globally.
 */
export interface LocalAgentConnectorStartupConfig {
  browser?: LocalAgentBrowserRuntimeConfig;
}

/**
 * Build the production multi-channel startup root: a {@link LocalAgentConnectorStartup} over the Connector
 * Orchestrator whose browser-auth subcomponent (ONE {@link LocalAgentProgressiveService}) is realized
 * LAZILY — only if the boot actually contains a runnable browser connection. If a browser connection needs
 * the service but no browser config was supplied, that lazy realization throws (a misconfiguration, never a
 * silent degrade). This replaces the progressive-only `createLocalAgentStartup`; it still never constructs
 * the legacy reconnect runtime, and wires no API port (Cafe24 stays `NOT_IMPLEMENTED`).
 */
export function createLocalAgentConnectorStartup(
  config: LocalAgentConnectorStartupConfig,
  observer?: ConnectorOrchestratorObserver,
): LocalAgentConnectorStartup {
  const browserService = (): ProgressiveServiceLike => {
    if (config.browser === undefined) {
      throw new Error("createLocalAgentConnectorStartup: a runnable browser connection requires browser runtime config, but none was supplied");
    }
    return createLocalAgentProgressiveService(config.browser);
  };
  return new LocalAgentConnectorStartup(browserService, observer);
}
