// The FE-1 mock scenario selector is a fixture/demo preview tool. It is DEV-only
// and must never appear in the production UI: gated on Vite's build-time `DEV`
// flag, so the production build tree-shakes it out entirely.
import type { AwClientTransport } from "./contract";

export function isFixturePreviewEnabled(): boolean {
  return import.meta.env.DEV === true;
}

/**
 * Which Action Window data source the Operations screen uses. This is the dev/runtime boundary the
 * mock and Bridge adapters are selected through:
 *   - `"mock"` (default, incl. production and tests): the contract-backed demo flow.
 *   - `"bridge"`: the live local-agent Runtime over the Action Window transport.
 *
 * Bridge mode is DEV-only and opt-in (`VITE_AW_BRIDGE=1`) — and even then only takes effect once a
 * real transport is available (see {@link resolveBridgeTransport}). The scenario preview is shown
 * only in mock mode.
 */
export type AdapterMode = "mock" | "bridge";

export function isBridgeModeEnabled(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  return env.DEV === true && env.VITE_AW_BRIDGE === "1";
}

/** A live Action Window transport bound to the Operation Run it drives (run identity assigned out-of-band). */
export interface BridgeSession {
  transport: AwClientTransport;
  runId: string;
  channelCode: string;
}

/**
 * The live Action Window transport session, or `null` when none is wired.
 *
 * The real Bridge-WS transport — Action Window frames carried as opaque payloads inside Local Agent
 * Bridge v1 — plus the run identity assigned during pairing, is a follow-up (a Bridge
 * opaque-passthrough slice). Until it lands there is nothing to connect to, so this returns `null` and
 * Operations stays on the mock. The Bridge *adapter* (`bridgeAdapter.ts`) is complete and
 * transport-injected; only this concrete transport is deferred.
 */
export function resolveBridgeSession(): BridgeSession | null {
  return null;
}

/** Effective mode after accounting for whether a transport actually exists. */
export function resolveAdapterMode(): AdapterMode {
  return isBridgeModeEnabled() && resolveBridgeSession() !== null ? "bridge" : "mock";
}
