// **The FE end of the v2 ISSUANCE carrier.** Establishes a live Action Window session against a local agent
// that is hosting `carrier: "issuance"`, and hands back a v2-typed frame transport.
//
// ## Why this is a thin wrapper and not a second transport
//
// Identical in shape to `import/importSession.ts`, and for the same reason: `wsTransport.connectAwBridgeSession`
// already owns every wire concern (ticket minting from the stored pairing token, the `aw_session` handshake,
// carrier matching, reconnect-with-resync, going dormant rather than splicing two runs). What differs between
// import and issuance is only the carrier NAME asked for and what rides INSIDE the frame — which the transport
// never inspects. Re-implementing the transport for a third payload TYPE would be a third thing to keep correct.
//
// The v1-typed transport is cast to v2 in exactly one place (`asV2Transport`), resting on the codec equivalence
// pinned by `import/importSession.test.ts` (both contracts' serialize/deserialize are JSON verbatim, identical
// frame-kind sets). If those ever diverge that test fails, not a live socket.
//
// ## Not DEV-gated, deliberately
//
// Like the import session, a guided issuance has no demo to fall back to: the seller presses "화면을 보며
// 안내받기" and either a local agent guides them through the NAVER API center or the text checklist takes
// over. So this connects in any build where a pairing exists — the same pairing the status channel uses — and
// a refusal is reported as itself so the walkthrough can offer the text fallback with the right reason.
import {
  AW_CARRIER_ISSUANCE,
} from "../../../../../contracts/action-window/aw-carrier-kind";
import type {
  AwClientFrame as V2ClientFrame,
  AwClientTransport as V2ClientTransport,
  AwServerFrame as V2ServerFrame,
} from "../../../../../contracts/action-window/v2/transport";
import { connectAwBridgeSession, type AwRefusalReason } from "../wsTransport";
import type { AwClientTransport as V1ClientTransport } from "../contract";

/** A live issuance-carrier session: the v2 transport, the announced run identity, and a teardown. */
export interface IssuanceBridgeSession {
  transport: V2ClientTransport;
  /**
   * The run identity the agent announced when we attached.
   *
   * A STARTING POINT only. The issuance host mints a fresh identity per run and re-announces it, so the
   * authoritative runId for an in-flight run is the one on the latest view — a runtime built on this session
   * should adopt it from the view stream rather than trusting this value for the life of the session.
   */
  runId: string;
  channelCode: string;
  close(): void;
}

export type IssuanceSessionResult =
  | { ok: true; session: IssuanceBridgeSession }
  | { ok: false; reason: AwRefusalReason };

/**
 * Where the local agent's bridge lives. Same resolution the pairing client and the import session use, so a
 * workspace that has pointed `VITE_BRIDGE_URL` at a non-default port does not have to point it a third time.
 */
function bridgeBase(): string {
  const env = import.meta.env as Record<string, unknown>;
  return typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615";
}

/**
 * Adapt the v1-typed transport to the v2 one. A cast, in exactly one place, resting on the codec equivalence
 * stated in the module note. Written as a named function so there is a single thing to find, test, and delete
 * if the two transports are ever unified.
 */
function asV2Transport(v1: V1ClientTransport): V2ClientTransport {
  return {
    send: (frame: V2ClientFrame) => v1.send(frame as never),
    subscribe: (listener: (frame: V2ServerFrame) => void) => v1.subscribe((frame) => listener(frame as never)),
  };
}

/**
 * Attach to a local agent hosting the issuance carrier.
 *
 * A refusal is returned, never thrown, and it carries WHY: "you have not paired", "the agent is off", and
 * "the agent is hosting a different carrier" are different problems, and the walkthrough turns each into the
 * right seller-facing message (and offers the text fallback).
 */
export async function connectIssuanceSession(deps?: {
  onStatus?: (status: "connected" | "reconnecting" | "offline") => void;
  /**
   * WHICH channel's issuance walk this caller wants (`coupang`, `naver`). Sent to the agent as an attach request
   * so the resident helper can bring that walk up on demand; the announced `channelCode` still wins for the
   * session. Absent ⇒ no request is sent (a fixed-carrier agent announces regardless).
   */
  channelCode?: string;
}): Promise<IssuanceSessionResult> {
  const httpBase = bridgeBase();
  const result = await connectAwBridgeSession({
    httpBase,
    wsBase: httpBase.replace(/^http/, "ws"),
    expectedCarrier: AW_CARRIER_ISSUANCE,
    ...(deps?.onStatus ? { onStatus: deps.onStatus } : {}),
    ...(deps?.channelCode ? { attachChannelCode: deps.channelCode } : {}),
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
