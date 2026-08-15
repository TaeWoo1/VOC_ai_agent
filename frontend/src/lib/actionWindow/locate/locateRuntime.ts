// **The `[쿠팡에서 보기]` run host — the FE end of one locate.**
//
// One object per attached locate-carrier agent. It sends the v2 `START_RUN(REVIEW_LOCATE, locateRef)` for the
// review the seller pressed, mirrors the runtime's sanitized `ActionWindowRunView` so the review screen can
// say what happened, and forwards the operator's commands — nothing else.
//
// ## How this differs from the issuance host, and why
//
// The issuance host sends `START_RUN` **exactly once** and resyncs first so a page refresh reattaches to the
// walk in progress. A locate is the opposite shape: the seller presses the button as often as they like, on
// whichever review they are looking at, and **each press IS a `START_RUN`** carrying its own freshly minted
// binding. So there is no exactly-once guard here — there is a `locate(ref)` call, and the runtime re-aims.
//
// What it still holds, identically:
//
//  1. **The FE never invents a run identity.** `runId` is adopted from the agent's own view/resync stream.
//  2. **A command is sent only when the view says it is allowed.** `allowedCommands` is the single source.
//  3. **`REQUEST_STEP_RECHECK` reports intent, never completion.** No step is completed and no blocker
//     cleared locally; every visible change comes from a view the agent published.
//  4. **It never sees the review.** The binding is opaque, and what the agent matches on is resolved
//     server-side — this module could not display the locate target if it wanted to.
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
} from "../../../../../contracts/action-window/v2/index";
import type { AwClientTransport } from "../../../../../contracts/action-window/v2/transport";
import { newCommandId } from "../../commandId";

const LOCATE_INTENT = "REVIEW_LOCATE";

/** How long a press waits to be acknowledged before the screen is told it did not get through. */
const START_ACK_TIMEOUT_MS = 8_000;

export interface LocateRuntime {
  /** Latest published run view, or null before the first view. */
  view(): ActionWindowRunView | null;
  subscribe(listener: (view: ActionWindowRunView | null) => void): () => void;
  /** Ask the agent to find the review this binding stands for. Each press is its own call. */
  locate(locateRef: string): void;
  /** Forward an operator command. Refuses anything the current view does not allow. */
  send(type: CommandType): void;
  /** Ask the agent to replay the run it is hosting — recovers a view after a page refresh. */
  resync(): void;
  /** Release the view subscription and stop publishing. */
  dispose(): void;
}

export interface LocateRuntimeOptions {
  /** Called if the agent REFUSES a `START_RUN`, with its sanitized reason. */
  onStartRefused?: (reason: string | null) => void;
}

export function createLocateRuntime(
  session: { transport: AwClientTransport; runId: string; channelCode: string },
  options: LocateRuntimeOptions = {},
): LocateRuntime {
  const { transport } = session;
  let runId = session.runId;
  let latest: ActionWindowRunView | null = null;
  let disposed = false;
  /** The commandIds of the presses we sent, so a refusal for one can be recognised as ours. */
  const startCommandIds = new Set<string>();
  /**
   * The press we are waiting to hear back about.
   *
   * <p>**Nothing is published while this is set.** A run view carries no press identity, so a view that
   * arrives between "the seller pressed on review B" and "the agent accepted that press" is indistinguishable
   * from B's — and it is A's. Rendered under B, it says SellerOps outlined B when the ring on Coupang is
   * around A. Frames are ordered, so the agent's own `aw_command_result` is exactly the line between them.
   */
  let pendingStart: string | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(view: ActionWindowRunView | null) => void>();

  const settlePending = (): void => {
    pendingStart = null;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const publish = (next: ActionWindowRunView | null): void => {
    latest = next;
    for (const listener of [...listeners]) listener(next);
  };

  const envelope = (type: CommandType, payload?: CommandEnvelope["payload"]): CommandEnvelope => ({
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: newCommandId(),
    runId,
    // The freshest revision seen. A stale one is refused by the engine's optimistic-concurrency guard; 0 is
    // correct before any view exists.
    expectedRevision: latest?.revision ?? 0,
    type,
    ...(payload ? { payload } : {}),
  });

  const stopViews = transport.subscribe((frame) => {
    if (disposed) return;
    if (frame.kind === "aw_view") {
      runId = frame.view.runId;
      // Belongs to the press before this one — see `pendingStart`.
      if (pendingStart !== null) return;
      publish(frame.view);
      return;
    }
    if (frame.kind === "aw_resync_result") {
      if (frame.view) {
        runId = frame.view.runId;
        if (pendingStart !== null) return;
        publish(frame.view);
      }
      return;
    }
    if (frame.kind === "aw_command_result") {
      if (startCommandIds.has(frame.commandId)) {
        if (frame.commandId === pendingStart) settlePending();
        if (!frame.accepted) options.onStartRefused?.(frame.reason ?? null);
      }
      return;
    }
    // aw_event carries no state this host renders — the view stream is the authority.
  });

  return {
    view: () => latest,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    locate(locateRef) {
      if (disposed) return;
      const command = envelope("START_RUN", {
        // The agent's own announced channel, never a value the FE chose.
        channelCode: session.channelCode,
        intent: LOCATE_INTENT,
        locateRef,
      } as CommandEnvelope["payload"]);
      startCommandIds.add(command.commandId);
      settlePending();
      pendingStart = command.commandId;
      // The previous press's verdict is not this one's. Clear it rather than leave it on screen under a
      // review it is not about.
      publish(null);
      // **A press that is never acknowledged has to say so.** With no live socket the transport drops
      // outbound frames silently, so without this the screen would sit on "찾는 중…" forever — and a
      // reconnect's resync would then repaint the OLD run's completed view under the new review.
      pendingTimer = setTimeout(() => {
        if (pendingStart !== command.commandId) return;
        settlePending();
        options.onStartRefused?.(null);
      }, START_ACK_TIMEOUT_MS);
      transport.send({ kind: "aw_command", command });
    },
    send(type) {
      if (disposed) return;
      // The view is the authority on what is permitted right now.
      if (!latest?.allowedCommands.includes(type)) return;
      transport.send({ kind: "aw_command", command: envelope(type) });
    },
    resync() {
      if (disposed) return;
      transport.send({ kind: "aw_resync", runId, sinceSequence: 0 });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      settlePending();
      stopViews();
      listeners.clear();
    },
  };
}
