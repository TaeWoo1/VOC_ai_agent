// **The FE end of the v2 LOCATE carrier.** Establishes a live Action Window session against a local agent
// that is hosting `carrier: "locate"`, and hands back a v2-typed frame transport.
//
// ## Why this is a thin wrapper and not a third transport
//
// Identical in shape to `issuance/issuanceSession.ts`, and for the same reason:
// `wsTransport.connectAwBridgeSession` already owns every wire concern (ticket minting from the stored
// pairing token, the `aw_session` handshake, carrier matching, reconnect-with-resync, going dormant rather
// than splicing two runs). What differs between issuance and locate is only the carrier NAME asked for and
// what rides INSIDE the frame — which the transport never inspects.
//
// ## Not DEV-gated, deliberately
//
// `[쿠팡에서 보기]` has no demo to fall back to: either a local agent is running and can read the seller's
// WING screen, or the honest answer is "SellerOps 로컬 에이전트가 실행 중이 아닙니다". So this connects in
// any build where a pairing exists, and a refusal is reported as itself so the button can say which problem
// it is.
import { AW_CARRIER_LOCATE } from "../../../../../contracts/action-window/aw-carrier-kind";
import type {
  AwClientFrame as V2ClientFrame,
  AwClientTransport as V2ClientTransport,
  AwServerFrame as V2ServerFrame,
} from "../../../../../contracts/action-window/v2/transport";
import { connectAwBridgeSession, type AwRefusalReason } from "../wsTransport";
import type { AwClientTransport as V1ClientTransport } from "../contract";

/** A live locate-carrier session: the v2 transport, the announced run identity, and a teardown. */
export interface LocateBridgeSession {
  transport: V2ClientTransport;
  /**
   * The run identity the agent announced when we attached.
   *
   * A STARTING POINT only — the authoritative runId for an in-flight run is the one on the latest view.
   */
  runId: string;
  channelCode: string;
  close(): void;
}

export type LocateSessionResult =
  | { ok: true; session: LocateBridgeSession }
  | { ok: false; reason: AwRefusalReason };

/** Where the local agent's bridge lives. Same resolution the pairing client and the other sessions use. */
function bridgeBase(): string {
  const env = import.meta.env as Record<string, unknown>;
  return typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615";
}

/** Adapt the v1-typed transport to the v2 one — a cast in exactly one place, as the issuance session does. */
function asV2Transport(v1: V1ClientTransport): V2ClientTransport {
  return {
    send: (frame: V2ClientFrame) => v1.send(frame as never),
    subscribe: (listener: (frame: V2ServerFrame) => void) => v1.subscribe((frame) => listener(frame as never)),
  };
}

/**
 * Attach to a local agent hosting the locate carrier.
 *
 * A refusal is returned, never thrown, and it carries WHY: "you have not paired", "the agent is off", and
 * "the agent is hosting a different carrier" are different problems, and the review screen turns each into
 * the right seller-facing message.
 */
export async function connectLocateSession(deps?: {
  onStatus?: (status: "connected" | "reconnecting" | "offline") => void;
  /**
   * WHICH channel's locate carrier to ask the agent for. Defaults to `coupang` — the only channel with a
   * locate surface (`[쿠팡에서 보기]` is the only control that reaches here).
   *
   * **This request is what makes the resident helper able to answer at all.** Without it the session attached
   * silently and waited for an announcement, which only a FIXED-carrier locate agent ever sends — and the only
   * thing that ever booted one was a seated-operator harness behind an approval manifest. A seller with the
   * SellerOps 도우미 paired pressed the button into nothing. Naming the carrier lets the resident helper bring
   * it up on demand, exactly as `/connect/coupang` does for the guided walk.
   */
  channelCode?: string;
}): Promise<LocateSessionResult> {
  const httpBase = bridgeBase();
  const result = await connectAwBridgeSession({
    httpBase,
    wsBase: httpBase.replace(/^http/, "ws"),
    expectedCarrier: AW_CARRIER_LOCATE,
    attachChannelCode: deps?.channelCode ?? "coupang",
    ...(deps?.onStatus ? { onStatus: deps.onStatus } : {}),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  const { session } = result;
  return {
    ok: true,
    session: {
      transport: asV2Transport(session.transport),
      runId: session.runId,
      channelCode: session.channelCode,
      close: () => session.close(),
    },
  };
}
