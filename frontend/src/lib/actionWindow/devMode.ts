// The FE-1 mock scenario selector is a fixture/demo preview tool. It is DEV-only
// and must never appear in the production UI: gated on Vite's build-time `DEV`
// flag, so the production build tree-shakes it out entirely.
import {
  connectAwBridgeSession,
  type AwBridgeConnectResult,
  type AwConnectionStatus,
} from "./wsTransport";

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
 * live session is actually established (see {@link resolveBridgeSession}); otherwise the operations
 * store stays on the fixture source (`connectBridgeIfEnabled` owns that fallback). The scenario
 * preview is shown only in the fixture world.
 */
export type AdapterMode = "mock" | "bridge";

export function isBridgeModeEnabled(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  return env.DEV === true && env.VITE_AW_BRIDGE === "1";
}

/**
 * Establish the live Action Window session over the Local Agent Bridge (R2B), or resolve `null` when
 * none is reachable — bridge mode disabled, agent off, unpaired, no hosted run announced, a
 * transport-version mismatch, or an agent hosting the OTHER carrier. A refusal keeps Operations on
 * the mock (the honest fallback), so the screen degrades to the contract-backed demo instead of a
 * broken live view — and now carries WHY, which is the difference between an operator who can fix it
 * and one staring at "offline".
 *
 * Authentication reuses the pairing the Bridge status client established (`BRIDGE_TOKEN_KEY`); the run
 * identity comes from the agent's `aw_session` announcement — the FE never invents a runId.
 */
export function resolveBridgeSession(
  onStatus?: (status: AwConnectionStatus) => void,
): Promise<AwBridgeConnectResult> {
  // Not a failure — this build simply did not ask for a live bridge. Named so diagnostics can say
  // "bridge mode is off" instead of reporting a connection problem that was never attempted.
  if (!isBridgeModeEnabled()) return Promise.resolve({ ok: false, reason: "bridge-disabled" });
  const env = import.meta.env as Record<string, unknown>;
  const httpBase = typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615";
  return connectAwBridgeSession({ httpBase, wsBase: httpBase.replace(/^http/, "ws"), onStatus });
}

/**
 * The INTENDED mode from build-time flags. Bridge mode still falls back to the fixture source at
 * runtime when {@link resolveBridgeSession} cannot reach a live session (`connectBridgeIfEnabled`
 * in bridgeSource.ts owns that fallback).
 */
export function resolveAdapterMode(): AdapterMode {
  return isBridgeModeEnabled() ? "bridge" : "mock";
}
