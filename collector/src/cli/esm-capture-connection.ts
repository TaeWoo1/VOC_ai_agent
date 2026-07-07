/**
 * **ESM capture connection resolver** (pure, offline).
 *
 * The live ESM review capture path must be CONNECTION-EXPLICIT: it derives its Chrome profile from a
 * validated ESM connection id (the same identity the local-agent reconnect path uses), never from an
 * unattributed default profile. This helper validates a requested connection id against the local
 * connections descriptor and, only when it is a runnable ESM browser connection, returns the connection's
 * dedicated profile directory via the ONE shared {@link connectionProfileDirFor} resolver.
 *
 * Fail-closed: an invalid descriptor, an unknown id, a non-ESM channel, a non-BROWSER strategy, or a
 * not-runnable connection all yield `ok:false` with a sanitized reason — there is NO implicit fallback to a
 * default profile. Pure: no fs, no browser; the caller reads the descriptor file and launches the browser.
 */
import { isRunnableBrowserConnection, parseConnectorConnections } from "../agent/local-agent-connector-startup";
import { connectionProfileDirFor } from "../agent/progressive-reconnect";

export type CaptureConnectionFailReason =
  | "descriptor-invalid"
  | "connection-not-found"
  | "channel-not-esm"
  | "strategy-not-browser"
  | "connection-not-runnable";

export type CaptureConnectionResolution =
  | { ok: true; connectionId: string; profileDir: string }
  | { ok: false; reason: CaptureConnectionFailReason };

/**
 * Resolve the validated ESM connection's dedicated profile directory, or fail closed. `connectionsRaw` is
 * the raw JSON of the local connections descriptor; `profileBaseDir` is the shared in-tree profile base
 * (`cfg.profileBaseDir`). The returned `profileDir` equals the local-agent reconnect path's profile for the
 * same `connectionId` — so a G0-verified session is reused, never copied. The profile identity is a function
 * of `connectionId` ONLY (never marketplace, loginMode, or capture kind).
 */
export function resolveCaptureConnectionProfile(input: {
  connectionsRaw: string;
  connectionId: string;
  profileBaseDir: string;
}): CaptureConnectionResolution {
  const parsed = parseConnectorConnections(input.connectionsRaw);
  if (!parsed.ok) return { ok: false, reason: "descriptor-invalid" };
  const connection = parsed.value.connections.find((c) => c.connectionId === input.connectionId);
  if (connection === undefined) return { ok: false, reason: "connection-not-found" };
  if (connection.channel !== "ESM") return { ok: false, reason: "channel-not-esm" };
  if (connection.strategy !== "BROWSER") return { ok: false, reason: "strategy-not-browser" };
  if (!isRunnableBrowserConnection(connection)) return { ok: false, reason: "connection-not-runnable" };
  return {
    ok: true,
    connectionId: input.connectionId,
    profileDir: connectionProfileDirFor(input.profileBaseDir, input.connectionId),
  };
}
