// **Guided review ACQUISITION from a conversation** — the runtime a `HUMAN_ACTION_REQUIRED` artifact drives
// when its path is `EXPORT_ACTION_WINDOW` (NAVER seller-center export, the v1 read chain) or
// `WING_READ_ACTION_WINDOW` (Coupang WING review read, the v2 `REVIEW_ACQUISITION` intent).
//
// One object per attached agent. It sends ONE `START_RUN`, mirrors the agent's sanitized view so the card can
// render `ActionWindowControlPanel` from `allowedCommands`, and forwards the seller's commands — nothing else.
// The rules are the ones `importRuntime`/`locateRuntime` already hold:
//
//  1. the FE never invents a run identity — `runId` is adopted from the agent's own view stream;
//  2. a command is sent only when the latest view allows it;
//  3. `REQUEST_STEP_RECHECK` reports intent, never completion — only the runtime completes a step;
//  4. no step is completed, no blocker cleared, locally.
//
// Product contract wording: reviewnary prepares the exact seller-center screen and period; the seller performs
// only the platform-required confirmations; reviewnary detects, ingests, resumes the original request and shows
// the result. The completion signal the artifact acts on is the view's `COMPLETED` status (or the backend's
// SyncJob watcher in the conversation provider) — never a client-side guess.
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  type ActionWindowRunView,
  type AwClientTransport,
  type CommandEnvelope,
  type CommandType,
} from "../contract";
import { newCommandId } from "../../commandId";

/** What a `START_RUN` binds to. `EXPORT` binds to nothing (v1); `REVIEW_ACQUISITION` spends a single-use ref. */
export type AcquisitionStart =
  | { intent: "EXPORT" }
  | { intent: "REVIEW_ACQUISITION"; acquisitionRef: string };

export interface AcquireRuntime {
  /** Latest published view, or null before the first frame. */
  view(): ActionWindowRunView | null;
  subscribe(listener: (view: ActionWindowRunView | null) => void): () => void;
  /**
   * Send the one `START_RUN`. Resolves when the agent ACKNOWLEDGES it — permission to keep waiting, not a
   * completed run. Rejects with {@link AcquireStartRejectedError} / {@link AcquireStartTimeoutError}.
   */
  start(input: AcquisitionStart): Promise<void>;
  /** Forward an operator command. Refuses anything the current view does not allow. */
  send(type: CommandType): void;
  /** Ask the agent to replay the run it is hosting (recovers a view after a refresh). */
  resync(): void;
  dispose(): void;
}

export const ACQUIRE_START_TIMEOUT_MS = 6_000;

export class AcquireStartTimeoutError extends Error {
  constructor() {
    super("guided acquisition: the agent never acknowledged START_RUN");
    this.name = "AcquireStartTimeoutError";
  }
}

export class AcquireStartRejectedError extends Error {
  readonly reason: string | null;
  constructor(reason: string | null) {
    super(`guided acquisition: the agent rejected START_RUN${reason ? ` (${reason})` : ""}`);
    this.name = "AcquireStartRejectedError";
    this.reason = reason;
  }
}

export class AcquireDisposedError extends Error {
  constructor() {
    super("guided acquisition: this runtime has been released");
    this.name = "AcquireDisposedError";
  }
}

/**
 * The `START_RUN` payload for each start. An `EXPORT` start is sent v1-clean (`{channelCode}` only —
 * "absent intent ⇒ EXPORT" is the documented v1-compatible meaning, and the export engine validates the v1
 * shape). A `REVIEW_ACQUISITION` start carries the intent and its ref, the v2 `INTENT_REQUIRED_REF` rule
 * from the sending side. Exactly one ref, never two.
 */
export function startPayload(channelCode: string, input: AcquisitionStart): Record<string, string> {
  return input.intent === "EXPORT"
    ? { channelCode }
    : { channelCode, intent: input.intent, acquisitionRef: input.acquisitionRef };
}

export function createAcquireRuntime(
  session: { transport: AwClientTransport; runId: string; channelCode: string },
  options: { startTimeoutMs?: number } = {},
): AcquireRuntime {
  const { transport } = session;
  const startTimeoutMs = options.startTimeoutMs ?? ACQUIRE_START_TIMEOUT_MS;
  let runId = session.runId;
  let latest: ActionWindowRunView | null = null;
  let disposed = false;
  const listeners = new Set<(view: ActionWindowRunView | null) => void>();

  const publish = (next: ActionWindowRunView | null): void => {
    latest = next;
    for (const listener of [...listeners]) listener(next);
  };

  const stopViews = transport.subscribe((frame) => {
    if (disposed) return;
    if (frame.kind === "aw_view") {
      runId = frame.view.runId;
      publish(frame.view);
    } else if (frame.kind === "aw_resync_result") {
      if (!frame.view) {
        publish(null);
        return;
      }
      runId = frame.view.runId;
      publish(frame.view);
    }
  });

  const envelope = (type: CommandType, payload?: CommandEnvelope["payload"]): CommandEnvelope => ({
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: newCommandId(),
    runId,
    expectedRevision: latest?.revision ?? 0,
    type,
    ...(payload ? { payload } : {}),
  });

  return {
    view: () => latest,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(input) {
      if (disposed) return Promise.reject(new AcquireDisposedError());
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
        const timer = setTimeout(() => settle(() => reject(new AcquireStartTimeoutError())), startTimeoutMs);
        // The agent's own announced channel, never a value the artifact chose.
        const command = envelope("START_RUN", startPayload(session.channelCode, input) as CommandEnvelope["payload"]);
        stopResults = transport.subscribe((frame) => {
          if (frame.kind !== "aw_command_result" || frame.commandId !== command.commandId) return;
          if (frame.accepted) settle(() => resolve());
          else settle(() => reject(new AcquireStartRejectedError(frame.reason ?? null)));
        });
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
    },
  };
}
