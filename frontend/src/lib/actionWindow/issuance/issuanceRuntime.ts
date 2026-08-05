// **The guided-issuance run host — the FE end of one NAVER API-center guided walk.**
//
// One object per attached issuance-carrier agent. It hosts the SINGLE issuance run the guided walkthrough
// shows: it sends the v2 `START_RUN(API_ISSUANCE_GUIDANCE)`, mirrors the runtime's sanitized `ActionWindowRunView`
// so the walkthrough can render the timeline/controls/blocker, and forwards the operator's commands — nothing
// else. It is the shared host for BOTH onboarding paths (existing-app and new-app): the RUNTIME decides step 2
// (open vs create) by observing the API center, so this host never carries a path.
//
// ## Five rules this module exists to hold
//
//  1. **The FE never invents a run identity.** `runId` is adopted from the agent's own view/resync stream; the
//     announced session runId is only a starting point.
//  2. **`START_RUN` fires exactly once, and only when nothing is already hosted.** On attach the host RESYNCS
//     first; a resync that returns a live view is a page-refresh reattach (adopt it, send no START_RUN), and only
//     a resync that returns null (the agent is idle) starts a fresh walk. This is the refresh-safe reattach the
//     import world proved: a reload over a running walk resumes the same run instead of starting a second.
//  3. **Issuance binds to no approved marketplace work.** `API_ISSUANCE_GUIDANCE` carries no ref
//     (`INTENT_REQUIRED_REF` is null): it is a tutorial over the seller's own API center, authorized by the
//     guided-connection flow, not by a minted ticket. So `START_RUN` sends only `{channelCode, intent}`.
//  4. **A command is sent only when the view says it is allowed.** `allowedCommands` is the single source; a
//     client-side guess about what is permitted is how a run gets driven into a state it never entered.
//  5. **`REQUEST_STEP_RECHECK` reports intent, never completion; no step is completed or blocker cleared
//     locally.** Every visible state change comes from a view the agent published. This host reads no NAVER
//     value, no selector, no credential — only sanitized run views.
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
} from "../../../../../contracts/action-window/v2/index";
import type { AwClientTransport } from "../../../../../contracts/action-window/v2/transport";
import { newCommandId } from "../../commandId";

/** The issuance intent — a tutorial over the seller's own API center; binds to no minted ref. */
const ISSUANCE_INTENT = "API_ISSUANCE_GUIDANCE";

export interface GuidedIssuanceRuntime {
  /** Latest published run view, or null before the first view / after an idle resync. */
  view(): ActionWindowRunView | null;
  subscribe(listener: (view: ActionWindowRunView | null) => void): () => void;
  /**
   * Attach-time entry: RESYNC first, then send `START_RUN` exactly once — but ONLY if the resync proves the
   * agent is hosting nothing. Idempotent: repeated calls (StrictMode, a re-render) do nothing once a resync is
   * pending or a run has been started/adopted, so START_RUN can never fire twice.
   */
  ensureStarted(): void;
  /** Forward an operator command. Refuses anything the current view does not allow. */
  send(type: CommandType): void;
  /** Ask the agent to replay the run it is hosting — recovers a guided view after a page refresh. */
  resync(): void;
  /** Release the view subscription and stop publishing. */
  dispose(): void;
}

export interface GuidedIssuanceRuntimeOptions {
  /** Called if the agent REFUSES `START_RUN` (`aw_command_result.accepted=false`), with its sanitized reason. */
  onStartRefused?: (reason: string | null) => void;
}

/** The host's internal lifecycle — the guard that makes START_RUN exactly-once and refresh-safe. */
type HostPhase = "new" | "resyncing" | "started" | "adopted" | "disposed";

export function createGuidedIssuanceRuntime(
  session: { transport: AwClientTransport; runId: string; channelCode: string },
  options: GuidedIssuanceRuntimeOptions = {},
): GuidedIssuanceRuntime {
  const { transport } = session;
  /**
   * The identity commands are addressed to. Seeded from the announcement, then REPLACED by whatever the agent's
   * views/resync report — the authoritative runId for an in-flight run is the one on the latest view.
   */
  let runId = session.runId;
  let latest: ActionWindowRunView | null = null;
  let phase: HostPhase = "new";
  /** The commandId of the one START_RUN we sent, so a refusal for it can be recognized. */
  let startCommandId: string | null = null;
  const listeners = new Set<(view: ActionWindowRunView | null) => void>();

  const publish = (next: ActionWindowRunView | null): void => {
    latest = next;
    for (const listener of [...listeners]) listener(next);
  };

  const envelope = (type: CommandType, payload?: CommandEnvelope["payload"]): CommandEnvelope => ({
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: newCommandId(),
    runId,
    // The freshest revision seen. A stale one is refused by the engine's optimistic-concurrency guard; 0 is
    // correct before any view exists (a run that has not started has no history to be stale against).
    expectedRevision: latest?.revision ?? 0,
    type,
    ...(payload ? { payload } : {}),
  });

  const sendStartRun = (): void => {
    // Exactly-once: guarded by the phase machine (only reached from an idle resync result).
    const command = envelope("START_RUN", {
      // The agent's own announced channel, never a value the FE chose. No ref: issuance binds to nothing.
      channelCode: session.channelCode,
      intent: ISSUANCE_INTENT,
    } as CommandEnvelope["payload"]);
    startCommandId = command.commandId;
    phase = "started";
    transport.send({ kind: "aw_command", command });
  };

  const stopViews = transport.subscribe((frame) => {
    if (phase === "disposed") return;
    if (frame.kind === "aw_view") {
      runId = frame.view.runId;
      // A view proves a run is hosted — adopt it so a late idle resync result can never START_RUN over it.
      if (phase !== "started") phase = "adopted";
      publish(frame.view);
      return;
    }
    if (frame.kind === "aw_resync_result") {
      if (frame.view) {
        // A run is already hosted (a refresh reattach): adopt it, send NO START_RUN.
        runId = frame.view.runId;
        phase = "adopted";
        publish(frame.view);
        return;
      }
      // The agent is up but idle → this is a fresh walk. Start it exactly once.
      if (phase === "resyncing") sendStartRun();
      return;
    }
    if (frame.kind === "aw_command_result") {
      if (startCommandId && frame.commandId === startCommandId && !frame.accepted) {
        options.onStartRefused?.(frame.reason ?? null);
      }
      return;
    }
    // aw_event / aw_guidance_intent carry no state this host renders — the view stream is the authority.
  });

  return {
    view: () => latest,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensureStarted() {
      // Only ever kicks off from a clean start. Once resyncing/started/adopted (or disposed), it is a no-op —
      // this is what makes START_RUN exactly-once across StrictMode double-invokes and re-renders.
      if (phase !== "new") return;
      phase = "resyncing";
      transport.send({ kind: "aw_resync", runId, sinceSequence: 0 });
    },
    send(type) {
      if (phase === "disposed") return;
      // The view is the authority on what is permitted right now.
      if (!latest?.allowedCommands.includes(type)) return;
      transport.send({ kind: "aw_command", command: envelope(type) });
    },
    resync() {
      if (phase === "disposed") return;
      transport.send({ kind: "aw_resync", runId, sinceSequence: 0 });
    },
    dispose() {
      if (phase === "disposed") return;
      phase = "disposed";
      stopViews();
      listeners.clear();
    },
  };
}
