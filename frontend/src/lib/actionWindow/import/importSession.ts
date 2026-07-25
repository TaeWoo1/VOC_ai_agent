// **The FE end of the v2 IMPORT carrier.** Establishes a live Action Window session against a local agent
// that is hosting `carrier: "import"`, and hands back a v2-typed frame transport.
//
// ## Why this is a thin wrapper and not a second transport
//
// `wsTransport.connectAwBridgeSession` already owns every wire concern that matters here — ticket minting from
// the stored pairing token, the `aw_session` announcement handshake, carrier matching, reconnect with a resync
// from zero, and going dormant rather than splicing two runs. It is also the module the export world has been
// running on. Re-implementing 300 lines of that for a different payload TYPE would be a second thing to keep
// correct, and the half without production mileage.
//
// It is typed against the v1 contract, and this module is the ONE place that difference is bridged. The bridge
// is sound for a stated reason rather than by hope: both contracts' `serializeFrame`/`deserializeFrame` are
// `JSON.stringify`/`JSON.parse` verbatim, and both frame-kind sets are identical (`aw_command`/`aw_resync` out,
// `aw_event`/`aw_view`/`aw_command_result`/`aw_resync_result` in). What differs is only what rides INSIDE the
// frame — envelopes and the View Model — which the transport never inspects. `importSession.test.ts` pins that
// equivalence by round-tripping a real v2 frame through the v1 codec, so if the two ever diverge the assumption
// fails loudly here instead of silently on a live socket.
//
// ## Not DEV-gated, deliberately
//
// `devMode.resolveBridgeSession` refuses unless `VITE_AW_BRIDGE=1` because the Operations screen's live export
// view is opt-in and falls back to a contract-backed demo. A guided import has no demo to fall back to: the
// seller presses 과거 리뷰 전체 연동하기 and either a local agent guides them through NAVER or nothing happens.
// So this connects in any build where a pairing exists — the same pairing the status channel already uses — and
// a refusal is reported as itself.
import {
  AW_CARRIER_IMPORT,
} from "../../../../../contracts/action-window/aw-carrier-kind";
import type {
  AwClientFrame as V2ClientFrame,
  AwClientTransport as V2ClientTransport,
  AwServerFrame as V2ServerFrame,
} from "../../../../../contracts/action-window/v2/transport";
import { connectAwBridgeSession, type AwRefusalReason } from "../wsTransport";
import type { AwClientTransport as V1ClientTransport } from "../contract";

/** A live import-carrier session: the v2 transport, the announced run identity, and a teardown. */
export interface ImportBridgeSession {
  transport: V2ClientTransport;
  /**
   * The run identity the agent announced when we attached.
   *
   * A STARTING POINT only. The import host mints a fresh identity per run and re-announces it, so the
   * authoritative runId for an in-flight run is the one on the latest view — see `importRuntime`, which adopts
   * it from the view stream rather than trusting this value for the life of the session.
   */
  runId: string;
  channelCode: string;
  close(): void;
}

export type ImportSessionResult =
  | { ok: true; session: ImportBridgeSession }
  | { ok: false; reason: AwRefusalReason };

/**
 * Where the local agent's bridge lives. Same resolution the pairing client uses, so a workspace that has
 * pointed `VITE_BRIDGE_URL` at a non-default port does not have to point it twice.
 */
function bridgeBase(): string {
  const env = import.meta.env as Record<string, unknown>;
  return typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615";
}

/**
 * Adapt the v1-typed transport to the v2 one.
 *
 * A cast, in exactly one place, resting on the codec equivalence stated in the module note. It is written as a
 * function rather than an inline `as` so there is a single named thing to find, test, and delete if the two
 * transports are ever unified.
 */
function asV2Transport(v1: V1ClientTransport): V2ClientTransport {
  return {
    send: (frame: V2ClientFrame) => v1.send(frame as never),
    subscribe: (listener: (frame: V2ServerFrame) => void) => v1.subscribe((frame) => listener(frame as never)),
  };
}

/**
 * Attach to a local agent hosting the import carrier.
 *
 * A refusal is returned, never thrown, and it carries WHY: "you have not paired", "the agent is off" and "the
 * agent is hosting the reply carrier" are different problems with different fixes, and the seller-facing card
 * says which.
 */
export async function connectImportSession(deps?: {
  onStatus?: (status: "connected" | "reconnecting" | "offline") => void;
}): Promise<ImportSessionResult> {
  const httpBase = bridgeBase();
  const result = await connectAwBridgeSession({
    httpBase,
    wsBase: httpBase.replace(/^http/, "ws"),
    expectedCarrier: AW_CARRIER_IMPORT,
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
