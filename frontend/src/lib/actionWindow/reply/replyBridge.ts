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
 * <p><b>No longer DEV-gated</b> — and the issuance / import / locate sessions never were. The gate was
 * doing something other than what it looked like: it refused with `bridge-disabled` BEFORE touching
 * the network in every shipped build, which made the guided reply path structurally unreachable — not
 * "unavailable until an agent hosts it", but unreachable even when one did. A capability that can
 * never be reached is not a capability, and the fallback it left behind (`resolveReplyRuntime`, null
 * in production) read as an honest manual handoff while actually standing in for a cut wire.
 *
 * <p><b>Removing it opens nothing new.</b> `expectedCarrier` is matched against the agent's own
 * announcement inside the shared transport, so this attaches to an agent hosting the REPLY carrier and
 * to nothing else — and the resident SellerOps 도우미 deliberately does NOT host that carrier
 * (`RESIDENT_CARRIER_ACTIVATORS` serves the four guided READ walks and refuses `reply`). The only
 * thing that announces `reply` today is the seated-operator live harness, which performs the account
 * fingerprint, chrome-identity and selector-store preflights before it hosts anything. So a seller
 * with the ordinary helper still gets a refusal and the manual handoff; an operator running that
 * harness now gets the product screen driving it instead of a CLI.
 *
 * <p>The WRITE boundary is untouched either way: the runtime locates and highlights the composer
 * READ-ONLY, the SELLER types and presses submit, and the only terminal the guided session can reach
 * without them is SUBMISSION_ABORTED.
 *
 * <p>`connectFn` is injectable for tests; it defaults to the real shared transport.
 */
export async function connectGuidedReplyRuntime(
  deps: Partial<AwWsDeps> = {},
  connectFn: (d: AwWsDeps) => Promise<AwBridgeConnectResult> = connectAwBridgeSession,
): Promise<GuidedReplyConnectResult> {
  const env = import.meta.env as Record<string, unknown>;
  const httpBase = deps.httpBase ?? (typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615");
  const result = await connectFn({
    ...deps,
    httpBase,
    wsBase: deps.wsBase ?? httpBase.replace(/^http/, "ws"),
    expectedCarrier: AW_CARRIER_REPLY,
    // Name the carrier, as every other session does. A fixed-carrier agent ignores it; an on-demand
    // host needs it to know what is being asked for — and the resident helper answering "not servable"
    // is a better, faster refusal than a silent wait for an announcement that never comes.
    attachChannelCode: deps.attachChannelCode ?? "naver",
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
