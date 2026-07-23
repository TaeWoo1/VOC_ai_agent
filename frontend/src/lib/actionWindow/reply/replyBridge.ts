// **The reply-carrier Bridge connection.** The v2 counterpart of `devMode.resolveBridgeSession`:
// establish one authenticated Bridge session with an agent hosting the REPLY carrier, and wrap it —
// frame adapter, then runtime — into a single handle whose `close()` releases everything.
//
// This is NOT carrier switching. A session is bound to one carrier for its whole life (reconnect
// included, enforced inside the shared transport); this module only declares which carrier it
// speaks, exactly as the export world declares its own. An agent hosting the export carrier refuses
// here with `carrier-mismatch` — symmetric to the export connect refusing a reply agent.
import { AW_CARRIER_REPLY } from "../../../../../contracts/action-window/aw-carrier-kind";
import type { AwClientTransport as AwClientTransportV2 } from "../../../../../contracts/action-window/v2/transport";
import { connectAwBridgeSession, type AwBridgeConnectResult, type AwRefusal, type AwWsDeps } from "../wsTransport";
import { isBridgeModeEnabled } from "../devMode";
import { createReplyFrameTransport } from "./replyFrameTransport";
import { createBridgeReplyRuntime, type ReplyRuntime } from "./replyRuntime";

/** A connected guided-reply capability: the runtime, and the one call that releases all of it. */
export interface GuidedReplyHandle {
  runtime: ReplyRuntime;
  /** Dispose the runtime (rejecting anything in flight) AND tear down the Bridge socket. Idempotent. */
  close(): void;
}

export type GuidedReplyConnectResult = { ok: true; handle: GuidedReplyHandle } | AwRefusal;

/**
 * Establish the guided-reply runtime over the Local Agent Bridge, or a refusal carrying why.
 *
 * <p>Bridge mode is DEV-only and opt-in, same gate as the export world: a shipped build refuses with
 * `bridge-disabled` before touching the network, so production still cannot construct a live runtime
 * — its guided path stays the honest manual handoff.
 *
 * <p>`connectFn` is injectable for tests; it defaults to the real shared transport.
 */
export async function connectGuidedReplyRuntime(
  deps: Partial<AwWsDeps> = {},
  connectFn: (d: AwWsDeps) => Promise<AwBridgeConnectResult> = connectAwBridgeSession,
): Promise<GuidedReplyConnectResult> {
  if (!isBridgeModeEnabled()) return { ok: false, reason: "bridge-disabled" };
  const env = import.meta.env as Record<string, unknown>;
  const httpBase = deps.httpBase ?? (typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615");
  const result = await connectFn({
    ...deps,
    httpBase,
    wsBase: deps.wsBase ?? httpBase.replace(/^http/, "ws"),
    expectedCarrier: AW_CARRIER_REPLY,
  });
  if (!result.ok) return result;

  // The session's transport is typed against the v1 frame contract, but on a REPLY-carrier socket
  // the envelopes flowing through those frames ARE v2 — the framing itself is byte-identical by
  // design (same kinds, same JSON wire, transportVersion 1 in both), and the transport never
  // inspects an envelope. This cast states that fact; nothing is converted.
  const framesV2 = result.session.transport as unknown as AwClientTransportV2;
  const runtime = createBridgeReplyRuntime({
    transport: createReplyFrameTransport(framesV2),
    runId: result.session.runId,
  });
  return {
    ok: true,
    handle: {
      runtime,
      close() {
        // Runtime first, so in-flight start/report reject as DISPOSED (an answer) rather than
        // timing out against a socket that is already gone.
        runtime.dispose();
        result.session.close();
      },
    },
  };
}
