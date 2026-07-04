/**
 * **Channel Connector contract** — the channel-agnostic vocabulary the multi-channel Connector
 * Orchestrator is built on.
 *
 * A *connector* abstracts ONE question per (channel × connection): "get this channel's session/credential
 * into a usable state, once." Two strategy families implement it — an {@link ConnectorStrategy} `API`
 * connector (credential/token auth) and a `BROWSER` connector (human-attended browser session; the
 * existing Progressive Reconnect ladder is adapted as its auth subcomponent). The orchestrator drives
 * every connector through the SAME single operation — {@link ChannelConnector.ensureReady} — so adding a
 * channel never changes the lifecycle, only which strategy + adapter seam it plugs into.
 *
 * **Two independent axes — kept separate on purpose:**
 *  - {@link ImplementationStatus} is the *operational readiness* axis: does a working connector for this
 *    channel exist yet (`AVAILABLE`), is it declared-but-unbuilt (`NOT_IMPLEMENTED`), or is even the
 *    strategy unknown (`DISCOVERY_REQUIRED`)? This is the gate for generating a sync intent.
 *  - `CapabilityStatus` (from `../connection/sync-state.ts`, UNCHANGED) is the *data/schema/dedup
 *    verification* axis: how proven is the data path once we can reach it? It is carried on a sync intent
 *    as INFORMATION only — it never gates the operational decision.
 *
 * **Reuses the existing multi-channel vocabulary** (`CommerceChannel`, `ConnectorType`, `AuthStatus`,
 * `CapabilityStatus`) rather than forking it; it ADDS only the connector-operational types.
 *
 * **Pure + offline.** No fs / http / browser / backend. Agent-layer types are `type`-only imports
 * (erased at compile time), so this module pulls in no Playwright at runtime and is fully unit-testable
 * with fakes. A connector GENERATES a {@link SyncIntent}; it never executes a sync, export, upload,
 * dedup, or status write.
 */

import type { AuthStatus, CapabilityStatus, ConnectorType, CommerceChannel } from "../connection/sync-state";
import type { ReconnectPath, UserActionCategory } from "../agent/progressive-reconnect";

/** The two connector strategy families. `BROWSER` adapts the Progressive Reconnect ladder for auth. */
export type ConnectorStrategy = "API" | "BROWSER";

/**
 * The operational readiness of a channel's connector — SEPARATE from `CapabilityStatus`.
 *  - `AVAILABLE`         — a working connector exists (NAVER / ESM today).
 *  - `NOT_IMPLEMENTED`   — the strategy is known and a connector shape exists, but it is not wired for
 *                          production yet (Cafe24 API). It may run in tests, but never yields a sync intent.
 *  - `DISCOVERY_REQUIRED`— not even the strategy is proven yet (Coupang / 11st / SSG / TodayHouse).
 */
export type ImplementationStatus = "AVAILABLE" | "NOT_IMPLEMENTED" | "DISCOVERY_REQUIRED";

/**
 * Channel-agnostic human-action categories a connector can surface. A SUPERSET: the first four are the
 * browser-auth actions (1:1 with `UserActionCategory` from the progressive-reconnect layer — bridged
 * explicitly by {@link connectorActionFromUserAction}), the last two are API-auth actions.
 */
export type ConnectorUserAction =
  | "SELECT_SAVED_CREDENTIAL"
  | "ENTER_MISSING_USERNAME"
  | "COMPLETE_MANUAL_LOGIN"
  | "COMPLETE_ADDITIONAL_AUTHENTICATION"
  | "PROVIDE_API_CREDENTIAL"
  | "REAUTHORIZE_API_ACCESS";

/**
 * Explicit bridge: a browser-auth `UserActionCategory` → the connector-level {@link ConnectorUserAction}.
 * Kept explicit (not a cast) so the two vocabularies stay independently evolvable — the `never` tail makes
 * a new `UserActionCategory` a compile error here.
 */
export function connectorActionFromUserAction(action: UserActionCategory): ConnectorUserAction {
  switch (action) {
    case "SELECT_SAVED_CREDENTIAL": return "SELECT_SAVED_CREDENTIAL";
    case "ENTER_MISSING_USERNAME": return "ENTER_MISSING_USERNAME";
    case "COMPLETE_MANUAL_LOGIN": return "COMPLETE_MANUAL_LOGIN";
    case "COMPLETE_ADDITIONAL_AUTHENTICATION": return "COMPLETE_ADDITIONAL_AUTHENTICATION";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * The common outcome of {@link ChannelConnector.ensureReady} — one shape for both strategies.
 *  - `READY`            — session/credential is usable (already, or after one reconnect/refresh).
 *  - `NEEDS_USER_ACTION`— a human must act; `pendingUserAction` says which.
 *  - `FAILED`           — could not be made ready (unrecoverable / errored).
 *  - `SKIPPED`          — deliberately not attempted (e.g. auto-reconnect consent withheld).
 */
export type ConnectorReadyOutcome = "READY" | "NEEDS_USER_ACTION" | "FAILED" | "SKIPPED";

/** The sanitized result of the single {@link ChannelConnector.ensureReady} operation. */
export interface EnsureReadyResult {
  outcome: ConnectorReadyOutcome;
  authStatus: AuthStatus;
  /** Browser-only rung that resolved the attempt; null for the API strategy. */
  reconnectPath: ReconnectPath | null;
  pendingUserAction: ConnectorUserAction | null;
}

/** How a channel's data would be pulled if a sync ran. Mirrors the fallback order in the sync-state model. */
export type SyncMechanism = "API_FETCH" | "BROWSER_EXPORT" | "MANUAL_UPLOAD" | "NONE";

/**
 * A GENERATED description of the sync that WOULD run — never executed here. The orchestrator produces one
 * ONLY for a connection that is both `READY` and `AVAILABLE`, so a scheduler/worker (a separate,
 * not-yet-existing slice) can act on it. `capabilityStatus` is carried for INFORMATION (the data-path
 * verification posture); it does not decide whether the intent is generated. Producing an intent triggers
 * no export, fetch, upload, dedup, backend write, or status mutation.
 */
export interface SyncIntent {
  channel: CommerceChannel;
  connectionId: string;
  connectorType: ConnectorType;
  mechanism: SyncMechanism;
  /** Informational data/schema/dedup verification posture — NOT the operational gate. */
  capabilityStatus: CapabilityStatus;
}

/**
 * The common contract every channel connector conforms to. The orchestrator calls `ensureReady()` EXACTLY
 * ONCE per connection, then — only when that returned `READY` and the channel is `AVAILABLE` — calls the
 * pure `planSync()`. `stop()` releases any held resources (a browser connector closes its browser).
 */
export interface ChannelConnector {
  readonly channel: CommerceChannel;
  readonly connectionId: string;
  readonly strategy: ConnectorStrategy;
  readonly connectorType: ConnectorType;
  /** Declared data/schema/dedup verification posture (informational) — readable without generating an intent. */
  readonly capabilityStatus: CapabilityStatus;
  /**
   * The single readiness operation. API: inspect the token, refresh once if needed. Browser: launch,
   * inspect the session, reconnect once if needed. Returns one of the common {@link ConnectorReadyOutcome}s.
   */
  ensureReady(): Promise<EnsureReadyResult>;
  /** GENERATE (do not execute) the sync intent. Pure — only called by the orchestrator when eligible. */
  planSync(): SyncIntent;
  /** Release any held resources. Idempotent. */
  stop(): Promise<void>;
}
