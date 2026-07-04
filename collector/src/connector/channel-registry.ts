/**
 * **Channel adapter registry** — the seam that says, per channel, WHICH connector strategy reaches it,
 * how operationally ready that path is ({@link ImplementationStatus}), and its declared data-verification
 * posture (`CapabilityStatus`). It is the one place a new channel is declared; the orchestrator and
 * connectors never hard-code a channel.
 *
 * Two independent axes (see `channel-connector.ts`):
 *  - `implementationStatus` — operational readiness. `AVAILABLE` (NAVER, ESM), `NOT_IMPLEMENTED`
 *    (Cafe24 API — strategy known, not wired for production), `DISCOVERY_REQUIRED` (Coupang, 11st, SSG,
 *    TodayHouse — strategy not even proven). This is the axis that gates sync-intent generation.
 *  - `defaultCapability` — the `CapabilityStatus` (data/schema/dedup verification), carried through
 *    UNCHANGED in meaning; informational on a sync intent, never the operational gate.
 *
 * A `DISCOVERY_REQUIRED` channel yields a `SKIPPED` handle (no connector, no fake capability). A
 * `NOT_IMPLEMENTED` channel yields a real connector when its deps are supplied (so it is testable) but
 * still never produces a sync intent; without deps it too is a `SKIPPED` handle. Only an `AVAILABLE`
 * channel whose deps are missing is a genuine configuration error (throws).
 *
 * Nothing here changes the existing `CommerceChannel` union or the sync-state/schema/dedup verification;
 * the registry keys are a SUPERSET ({@link KnownChannel}) so "we know of more channels than we have
 * connectors for" is modeled honestly without touching the connectable set.
 */

import type { CommerceChannel, ConnectorType, CapabilityStatus } from "../connection/sync-state";
import type { ChannelConnector, ConnectorStrategy, ImplementationStatus } from "./channel-connector";
import { BrowserChannelConnector } from "./browser-connector";
import { ApiChannelConnector, type ApiConnectorPort } from "./api-connector";
import type { ProgressiveServiceLike } from "../agent/local-agent-startup";
import type { ProgressiveReconnectConnection } from "../agent/progressive-reconnect";

/** Channels declared but with no connector strategy proven yet — discovery-required, not implemented. */
export type DiscoveryRequiredChannel = "COUPANG" | "ELEVENST" | "SSG" | "TODAYHOUSE";

/** Every channel the registry knows of: the connectable set plus the discovery-required set. */
export type KnownChannel = CommerceChannel | DiscoveryRequiredChannel;

/** A channel's adapter declaration. `strategy: null` ⇔ `implementationStatus: "DISCOVERY_REQUIRED"`. */
export interface ChannelAdapterDescriptor {
  channel: KnownChannel;
  strategy: ConnectorStrategy | null;
  connectorType: ConnectorType;
  /** Data/schema/dedup verification posture (unchanged axis) — informational. */
  defaultCapability: CapabilityStatus;
  /** Operational readiness axis — the sync-intent gate. */
  implementationStatus: ImplementationStatus;
}

/**
 * The adapter table. `implementationStatus` and `defaultCapability` are separate: NAVER/ESM connectors
 * are `AVAILABLE` operationally while their data path is only `NEEDS_VERIFICATION`; Cafe24's API strategy
 * is `NOT_IMPLEMENTED` operationally with a `NEEDS_DISCOVERY` data path; discovery-required channels have
 * no strategy at all.
 */
export const CHANNEL_ADAPTERS: readonly ChannelAdapterDescriptor[] = [
  { channel: "NAVER", strategy: "BROWSER", connectorType: "BROWSER_EXPORT", defaultCapability: "NEEDS_VERIFICATION", implementationStatus: "AVAILABLE" },
  { channel: "ESM", strategy: "BROWSER", connectorType: "BROWSER_EXPORT", defaultCapability: "NEEDS_VERIFICATION", implementationStatus: "AVAILABLE" },
  { channel: "CAFE24", strategy: "API", connectorType: "API", defaultCapability: "NEEDS_DISCOVERY", implementationStatus: "NOT_IMPLEMENTED" },
  { channel: "COUPANG", strategy: null, connectorType: "NONE", defaultCapability: "NEEDS_DISCOVERY", implementationStatus: "DISCOVERY_REQUIRED" },
  { channel: "ELEVENST", strategy: null, connectorType: "NONE", defaultCapability: "NEEDS_DISCOVERY", implementationStatus: "DISCOVERY_REQUIRED" },
  { channel: "SSG", strategy: null, connectorType: "NONE", defaultCapability: "NEEDS_DISCOVERY", implementationStatus: "DISCOVERY_REQUIRED" },
  { channel: "TODAYHOUSE", strategy: null, connectorType: "NONE", defaultCapability: "NEEDS_DISCOVERY", implementationStatus: "DISCOVERY_REQUIRED" },
];

const BY_CHANNEL: ReadonlyMap<KnownChannel, ChannelAdapterDescriptor> = new Map(
  CHANNEL_ADAPTERS.map((d) => [d.channel, d]),
);

export function descriptorFor(channel: KnownChannel): ChannelAdapterDescriptor | undefined {
  return BY_CHANNEL.get(channel);
}

/**
 * A ready-to-run connector (with its operational readiness), or a marker that the channel is skipped
 * before any connector could run. The orchestrator consumes a list of these.
 */
export type ConnectorHandle =
  | { status: "READY_TO_START"; connector: ChannelConnector; implementationStatus: ImplementationStatus }
  | { status: "SKIPPED"; channel: KnownChannel; connectionId: string; implementationStatus: ImplementationStatus };

/** Per-connection dependencies the factory needs to build a connector for a given strategy. */
export interface BrowserConnectorDeps {
  service: ProgressiveServiceLike;
  connection: ProgressiveReconnectConnection;
}
export interface ApiConnectorDeps {
  port: ApiConnectorPort;
}
export interface ConnectorCreationDeps {
  browser?: BrowserConnectorDeps;
  api?: ApiConnectorDeps;
}

/**
 * Build a {@link ConnectorHandle} for one (channel × connection):
 *  - unknown / `DISCOVERY_REQUIRED` channel → `SKIPPED` (no connector).
 *  - declared strategy WITH its deps → `READY_TO_START`.
 *  - `NOT_IMPLEMENTED` strategy WITHOUT deps → `SKIPPED` (nothing to run yet; not an error).
 *  - `AVAILABLE` strategy WITHOUT deps → a configuration error (throws).
 *
 * **API availability is deps-driven.** An `API` channel whose static descriptor is `NOT_IMPLEMENTED` (e.g.
 * Cafe24) is promoted to `AVAILABLE` — and thus runnable, sync-intent-eligible — ONLY when a real
 * production `ApiConnectorPort` is supplied. Without a port it stays `NOT_IMPLEMENTED` and settles
 * `SKIPPED`. This is how "AVAILABLE only when the port actually exists" is modeled without a live wire.
 */
export function createConnectorHandle(
  channel: KnownChannel,
  connectionId: string,
  deps: ConnectorCreationDeps,
): ConnectorHandle {
  const descriptor = descriptorFor(channel);
  if (descriptor === undefined || descriptor.strategy === null || descriptor.implementationStatus === "DISCOVERY_REQUIRED") {
    return { status: "SKIPPED", channel, connectionId, implementationStatus: descriptor?.implementationStatus ?? "DISCOVERY_REQUIRED" };
  }
  // Past the guard, `channel` is one of the connectable `CommerceChannel`s.
  const commerceChannel = channel as CommerceChannel;
  const impl = descriptor.implementationStatus;

  if (descriptor.strategy === "BROWSER") {
    if (!deps.browser) {
      if (impl === "NOT_IMPLEMENTED") return { status: "SKIPPED", channel, connectionId, implementationStatus: impl };
      throw new Error(`createConnectorHandle: AVAILABLE BROWSER strategy for ${channel} requires browser deps`);
    }
    return {
      status: "READY_TO_START",
      implementationStatus: impl,
      connector: new BrowserChannelConnector(
        commerceChannel,
        connectionId,
        descriptor.connectorType,
        descriptor.defaultCapability,
        deps.browser.service,
        deps.browser.connection,
      ),
    };
  }

  if (!deps.api) {
    if (impl === "NOT_IMPLEMENTED") return { status: "SKIPPED", channel, connectionId, implementationStatus: impl };
    throw new Error(`createConnectorHandle: AVAILABLE API strategy for ${channel} requires api deps`);
  }
  // A real production port was supplied → the API channel is operationally AVAILABLE (promoted even from a
  // NOT_IMPLEMENTED default), so it is runnable and its READY sync intent will be generated.
  return {
    status: "READY_TO_START",
    implementationStatus: "AVAILABLE",
    connector: new ApiChannelConnector(
      commerceChannel,
      connectionId,
      descriptor.connectorType,
      descriptor.defaultCapability,
      deps.api.port,
    ),
  };
}

/** Convenience for callers/UI: the discovery-required channels, in declaration order. */
export function discoveryRequiredChannels(): KnownChannel[] {
  return CHANNEL_ADAPTERS.filter((d) => d.implementationStatus === "DISCOVERY_REQUIRED").map((d) => d.channel);
}
