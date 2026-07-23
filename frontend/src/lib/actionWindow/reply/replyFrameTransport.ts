// **The envelope↔frame adapter the reply runtime was missing.** `createBridgeReplyRuntime` speaks
// v2 `CommandEnvelope`/`EventEnvelope` through `ReplyClientTransport`, but the wire carries
// `{kind:"aw_command"…}` / `{kind:"aw_event"…}` frames (`contracts/action-window/v2/transport.ts`).
// Until this module, the only implementation of that interface was a fake in the runtime's own unit
// test — the runtime had never been driven by anything shaped like the real wire. This adapter closes
// that gap without the runtime learning about frames or the frame layer learning about the runtime.
import type {
  AwClientTransport,
} from "../../../../../contracts/action-window/v2/transport";
import type { ReplyClientTransport } from "./replyRuntime";

/**
 * Adapt a frame-level v2 `AwClientTransport` into the envelope-level `ReplyClientTransport` the
 * reply runtime consumes.
 *
 * The mapping is deliberately total on what the reply path uses and silent on what it does not:
 *
 * - `send(command)` → `{kind: "aw_command", command}` — the only client frame a reply run emits.
 *   (`aw_resync` is reconnect recovery, which the reply path does not have yet — recorded, not wired.)
 * - `aw_event` frames → `subscribe` listeners, unwrapped to the bare `EventEnvelope`.
 * - `aw_command_result` frames → `subscribeResults` listeners — the agent's accept/reject answer per
 *   commandId, which is how a refused report becomes an immediate rejection instead of a timeout.
 * - `aw_view` / `aw_resync_result` frames are dropped: the reply runtime renders no View Model and
 *   requests no resync, so delivering them would invent an audience for frames nobody consumes.
 *
 * Each `subscribe`/`subscribeResults` call holds exactly ONE underlying frame subscription and its
 * unsubscribe releases exactly that one — so the frame transport's listener count mirrors the reply
 * transport's, and "zero listeners after disposal" is measurable at the frame layer, where a real
 * socket would feel it.
 */
export function createReplyFrameTransport(frames: AwClientTransport): ReplyClientTransport {
  return {
    send(command) {
      frames.send({ kind: "aw_command", command });
    },
    subscribe(listener) {
      return frames.subscribe((frame) => {
        if (frame.kind === "aw_event") listener(frame.event);
      });
    },
    subscribeResults(listener) {
      return frames.subscribe((frame) => {
        if (frame.kind === "aw_command_result") {
          listener({
            commandId: frame.commandId,
            accepted: frame.accepted,
            ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
          });
        }
      });
    },
  };
}
