// **The guided-import runtime the seller's single CTA drives.**
//
// One object per attached agent, reused across the whole sitting: range discovery, then one run per monthly
// segment. It sends the v2 `START_RUN` that binds a run to a launch ref, mirrors the runtime's sanitized view
// so the card can render progress, and forwards the operator's commands — nothing else.
//
// ## Four rules this module exists to hold
//
//  1. **The FE never invents a run identity.** `runId` is adopted from the agent's own view stream. The import
//     host mints a fresh identity per segment and re-announces it, so the attach-time announcement is a
//     starting point and the latest view is the authority.
//  2. **A command is sent only when the runtime says it is allowed.** `allowedCommands` on the view is the
//     single source; the card renders buttons from it and this module refuses anything absent from it. A
//     client-side guess about what is permitted is how a run gets driven into a state it never entered.
//  3. **`REQUEST_STEP_RECHECK` reports intent, never completion.** It says "I did it, look again". Only the
//     runtime completes a step, by observing — the contract rule the v1 export world established.
//  4. **No step is ever completed, no blocker ever cleared, locally.** Every visible state change comes from a
//     view the agent published.
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
  type RunIntent,
} from "../../../../../contracts/action-window/v2/index";
import type {
  AwClientTransport,
  AwGuidanceIntent,
  AwGuidancePack,
} from "../../../../../contracts/action-window/v2/transport";
import { newCommandId } from "../../commandId";

/** What the card renders. A projection of the runtime's view — never assembled from local guesses. */
export interface GuidedImportSnapshot {
  runId: string;
  status: ActionWindowRunView["status"];
  intent: RunIntent | null;
  step: {
    stepNumber: number;
    totalSteps: number;
    copyKey: string;
    copyParams: Record<string, string | number | boolean>;
    status: string;
  } | null;
  blocker: { code: string; recoverable: boolean } | null;
  allowedCommands: readonly CommandType[];
  revision: number;
}

/** Which run kind a launch ref authorizes, as the backend reported it when minting the ticket. */
export type GuidedImportKind = "DISCOVERY" | "SEGMENT";

export interface GuidedImportRuntime {
  /** Latest published state, or null before the first view arrives. */
  snapshot(): GuidedImportSnapshot | null;
  subscribe(listener: (snapshot: GuidedImportSnapshot | null) => void): () => void;
  /**
   * Bind a run to a launch ref and start it. Resolves when the agent ACKNOWLEDGES the command — an
   * acknowledgement is permission to keep waiting, not a completed run.
   *
   * Rejects with {@link GuidedImportStartRejectedError} when the agent refuses, and
   * {@link GuidedImportStartTimeoutError} when it never answers. Both matter to the caller for the same
   * reason: the ticket it just minted is unspent, and it can be handed back.
   */
  start(input: { launchRef: string; kind: GuidedImportKind }): Promise<void>;
  /**
   * Hand the agent the prose it renders in the marketplace page.
   *
   * Held and RE-SENT after every successful `start`, because the agent builds a fresh session per segment and a
   * new session starts with no copy at all. Without the re-send the seller would get a guidance panel on their
   * first segment and a silent one on every segment after it — which is worse than never having had it, because
   * they would have learned to rely on it.
   */
  setGuidancePack(pack: AwGuidancePack): void;
  /**
   * A press on the in-page panel that only THIS side can act on.
   *
   * One value arrives today: `CONTINUE_NEXT_SEGMENT`, the seller asking — from inside their SmartStore window —
   * for the next monthly segment. It is a request, not a command: a run is authorized by a single-use ticket the
   * backend mints, and this frontend is the only party that holds the plan identity needed to ask for one. So the
   * listener does what the SellerOps button does, through the same endpoint, and may refuse.
   */
  subscribeIntent(listener: (intent: AwGuidanceIntent) => void): () => void;
  /** Forward an operator command. Refuses anything the current view does not allow. */
  send(type: CommandType): void;
  /** Ask the agent to replay the run it is hosting — recovers a guided view after a page refresh. */
  resync(): void;
  dispose(): void;
}

/** How long `start` waits for the agent's acknowledgement. A machine round-trip with no human in it. */
export const GUIDED_IMPORT_START_TIMEOUT_MS = 6_000;

export class GuidedImportStartTimeoutError extends Error {
  constructor() {
    super("guided import: the agent never acknowledged START_RUN");
    this.name = "GuidedImportStartTimeoutError";
  }
}

export class GuidedImportStartRejectedError extends Error {
  /** The agent's sanitized rejection code (e.g. `INVALID_FOR_STATE`), or null when it sent none. */
  readonly reason: string | null;
  constructor(reason: string | null) {
    super(`guided import: the agent rejected START_RUN${reason ? ` (${reason})` : ""}`);
    this.name = "GuidedImportStartRejectedError";
    this.reason = reason;
  }
}

export class GuidedImportDisposedError extends Error {
  constructor() {
    super("guided import: this runtime has been released");
    this.name = "GuidedImportDisposedError";
  }
}

const INTENT_FOR: Readonly<Record<GuidedImportKind, RunIntent>> = {
  DISCOVERY: "INITIAL_REVIEW_IMPORT_DISCOVERY",
  SEGMENT: "INITIAL_REVIEW_IMPORT_SEGMENT",
};

/** The binding ref key each kind must carry — the contract's `INTENT_REQUIRED_REF`, from the sending side. */
const REF_KEY_FOR: Readonly<Record<GuidedImportKind, "discoveryRef" | "importRef">> = {
  DISCOVERY: "discoveryRef",
  SEGMENT: "importRef",
};

function project(view: ActionWindowRunView): GuidedImportSnapshot {
  return {
    runId: view.runId,
    status: view.status,
    intent: view.intent ?? null,
    step: view.currentStep
      ? {
          stepNumber: view.currentStep.stepNumber,
          totalSteps: view.currentStep.totalSteps,
          copyKey: view.currentStep.copyKey,
          copyParams: { ...(view.currentStep.copyParams ?? {}) },
          status: view.currentStep.status,
        }
      : null,
    blocker: view.blocker ? { code: view.blocker.code, recoverable: view.blocker.recoverable } : null,
    allowedCommands: [...view.allowedCommands],
    revision: view.revision,
  };
}

export function createGuidedImportRuntime(
  session: { transport: AwClientTransport; runId: string; channelCode: string },
  options: { startTimeoutMs?: number } = {},
): GuidedImportRuntime {
  const { transport } = session;
  const startTimeoutMs = options.startTimeoutMs ?? GUIDED_IMPORT_START_TIMEOUT_MS;
  /**
   * The identity commands are addressed to. Seeded from the announcement and then REPLACED by whatever the
   * agent's views report: the host re-arms per run, so an FE that kept the attach-time value would address
   * segment two's commands to segment one and have its `expectedRevision` refused forever.
   */
  let runId = session.runId;
  let latest: GuidedImportSnapshot | null = null;
  let disposed = false;
  /** The guidance prose to hand to each run this session hosts. Null until the card supplies it. */
  let guidancePack: AwGuidancePack | null = null;
  const listeners = new Set<(snapshot: GuidedImportSnapshot | null) => void>();
  const intentListeners = new Set<(intent: AwGuidanceIntent) => void>();

  const publish = (next: GuidedImportSnapshot | null): void => {
    latest = next;
    for (const listener of [...listeners]) listener(next);
  };

  const stopViews = transport.subscribe((frame) => {
    if (disposed) return;
    if (frame.kind === "aw_guidance_intent") {
      // Deliberately NOT folded into the snapshot: this is not run state, it is a thing the seller asked for
      // once, and a state field would replay it on every re-render.
      for (const listener of [...intentListeners]) listener(frame.intent);
      return;
    }
    if (frame.kind === "aw_view") {
      runId = frame.view.runId;
      publish(project(frame.view));
      return;
    }
    if (frame.kind === "aw_resync_result") {
      if (!frame.view) {
        // Nothing hosted: the agent is up but idle. Reporting an empty run is honest; inventing a PREPARING
        // state would show the seller a run that does not exist.
        publish(null);
        return;
      }
      runId = frame.view.runId;
      publish(project(frame.view));
    }
  });

  const envelope = (type: CommandType, payload?: CommandEnvelope["payload"]): CommandEnvelope => ({
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: newCommandId(),
    runId,
    // The freshest revision we have seen. A stale one is refused by the engine's optimistic-concurrency
    // guard, and 0 is correct before any view exists — a run that has not started has no history to be
    // stale against, and the host resets the replayed command to 0 anyway.
    expectedRevision: latest?.revision ?? 0,
    type,
    ...(payload ? { payload } : {}),
  });

  const sendPack = (): void => {
    if (!guidancePack) return;
    transport.send({ kind: "aw_guidance_pack", pack: guidancePack });
  };

  return {
    snapshot: () => latest,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeIntent(listener) {
      intentListeners.add(listener);
      return () => intentListeners.delete(listener);
    },
    setGuidancePack(pack) {
      if (disposed) return;
      guidancePack = pack;
      // Sent now as well as per-run: a page reopened mid-run has a live session on the agent that is drawing a
      // panel with no words in it until someone hands it some.
      sendPack();
    },
    start(input) {
      if (disposed) return Promise.reject(new GuidedImportDisposedError());
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let stopResults: (() => void) | null = null;
        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          stopResults?.();
          fn();
        };
        const timer = setTimeout(() => settle(() => reject(new GuidedImportStartTimeoutError())), startTimeoutMs);
        // Exactly ONE binding ref, chosen by kind. The host refuses a command carrying both — a caller that
        // sends both does not know which approved work it is spending.
        const command = envelope("START_RUN", {
          // The agent's own announced channel, never a value the card chose: a client-supplied channel would
          // be a client deciding which marketplace a run touches.
          channelCode: session.channelCode,
          intent: INTENT_FOR[input.kind],
          [REF_KEY_FOR[input.kind]]: input.launchRef,
        } as CommandEnvelope["payload"]);
        stopResults = transport.subscribe((frame) => {
          if (frame.kind !== "aw_command_result" || frame.commandId !== command.commandId) return;
          if (frame.accepted) {
            // The agent has built the session for THIS run, so now there is something to give the copy to.
            // Before the acknowledgement there was not: the host assembles a session only once it has resolved
            // the launch ref, and a pack sent earlier would arrive at a listener that does not exist yet.
            sendPack();
            settle(() => resolve());
          } else settle(() => reject(new GuidedImportStartRejectedError(frame.reason ?? null)));
        });
        // A transport that replays synchronously inside subscribe() would settle before the assignment above
        // completes, leaving the listener attached to a finished promise.
        if (settled) {
          stopResults();
          return;
        }
        try {
          transport.send({ kind: "aw_command", command });
        } catch (e) {
          settle(() => reject(e instanceof Error ? e : new Error(String(e))));
        }
      });
    },
    send(type) {
      if (disposed) return;
      // The view is the authority on what is permitted right now. Sending anything else would be a client
      // deciding a run's state machine, which is the runtime's job alone.
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
      stopViews();
      listeners.clear();
      intentListeners.clear();
    },
  };
}
