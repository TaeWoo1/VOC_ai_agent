// **Isolated v2 reply-submission bridge path.** Strictly side-by-side with the v1 export world: this
// `reply/` directory is the ONLY frontend code that imports `contracts/action-window/v2/` (this module
// speaks the envelopes; `replyFrameTransport.ts` speaks the wire frames). It does NOT switch the shared
// `contract.ts` (which stays v1) and does NOT widen the generic `bridgeAdapter` sender — a guided reply
// run is a separate, v2-typed path with its own command ids and its own terminal.
//
// The runtime terminal is the SOLE source of the recorded outcome + runId: `startReplySubmission`
// dispatches a v2 `START_RUN(REPLY_SUBMISSION, submissionRef)`, and the operator's report drives the run
// to its `OPERATOR_REPORTED` terminal, from which the FE reads `operatorOutcome` + the `run_<hex>` runId.
// The FE never fabricates either. Command ids are minted with the LAN-safe `newCommandId` helper.
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  validateEventEnvelope,
  type CommandEnvelope,
  type EventEnvelope,
} from "../../../../../contracts/action-window/v2/index";
import { newCommandId } from "../../commandId";
import { isFixturePreviewEnabled } from "../devMode";
import type { OperatorOutcomeName } from "../../types";

/** The honest terminal of a guided reply run — outcome + verification as a pair, plus the run identity. */
export interface ReplyTerminal {
  runId: string;
  operatorOutcome: OperatorOutcomeName;
  verification: "UNVERIFIED";
}

/**
 * A reply-submission runtime the FE drives. Two impls exist: an in-memory {@link createSimulatedReplyRuntime}
 * (the offline / non-bridge default, still a real v2 terminal) and {@link createBridgeReplyRuntime} over a
 * live dev-bridge transport. Both assign the runId themselves (never the FE) and emit the terminal.
 */
export interface ReplyRuntime {
  /** Dispatch `START_RUN(REPLY_SUBMISSION, submissionRef)`; resolve the runtime-assigned opaque runId. */
  start(input: { channelCode: string; submissionRef: string }): Promise<{ runId: string }>;
  /** Drive the run to its `OPERATOR_REPORTED` terminal with the operator's report; resolve the terminal. */
  report(runId: string, outcome: OperatorOutcomeName): Promise<ReplyTerminal>;
  /**
   * Release the runtime. Detaches its construction-time subscription (the bridge runtime's revision
   * tracker), rejects any in-flight `report()` with {@link ReplyRuntimeDisposedError}, and makes every
   * later `start`/`report` fail closed with the same error rather than attach a listener to — or send
   * into — a torn-down session. Idempotent; the intended caller is the cleanup of whatever effect
   * created the runtime, so unmounting releases it.
   */
  dispose(): void;
}

/** A handle over one guided run: the runId, and the two terminal-driving reports. */
export interface ReplyRunHandle {
  runId: string;
  reportSubmitted(): Promise<ReplyTerminal>;
  abortSubmission(): Promise<ReplyTerminal>;
}

/**
 * Start a guided reply run over a runtime and return a handle. The handle's `reportSubmitted` /
 * `abortSubmission` drive the run to its terminal — from which the caller reads the outcome + runId.
 */
export async function startReplySubmission(
  runtime: ReplyRuntime,
  input: { channelCode: string; submissionRef: string },
): Promise<ReplyRunHandle> {
  const { runId } = await runtime.start(input);
  return {
    runId,
    reportSubmitted: () => runtime.report(runId, "OPERATOR_REPORTED_SUBMITTED"),
    abortSubmission: () => runtime.report(runId, "SUBMISSION_ABORTED"),
  };
}

/**
 * The reply runtime this build may use, or `null` when guidance is unavailable.
 *
 * **Production resolves to `null`, deliberately.** `createBridgeReplyRuntime` is not wired to
 * anything yet, so before this the panel silently fell back to the SIMULATED runtime in every
 * shipped build: it minted a `run_<hex>` locally, synthesised a terminal event, and persisted that
 * fabricated run identity into `review_reply_outcome.aw_run_ref`. Nothing guided the seller and the
 * database could not tell the difference.
 *
 * A null is not a degraded guided run — it is the honest statement that this build cannot guide, and
 * the panel answers it with a clearly-labelled manual handoff that records NO run ref at all.
 *
 * Simulation stays DEV/test-only: `isFixturePreviewEnabled()` is `import.meta.env.DEV`, so the
 * production bundle tree-shakes the branch out entirely.
 */
export function resolveReplyRuntime(): ReplyRuntime | null {
  return isFixturePreviewEnabled() ? createSimulatedReplyRuntime() : null;
}

/** A LAN-safe opaque run identity mirroring the agent's `run_<hex>` shape. Throws on a non-secure origin. */
function mintRunId(): string {
  return `run_${newCommandId().replace(/-/g, "").slice(0, 12)}`;
}

/** Read the terminal back from an emitted v2 `RUN_OPERATOR_REPORTED` event — never fabricated. */
function terminalFromEvent(event: EventEnvelope): ReplyTerminal {
  const valid = validateEventEnvelope(event);
  if (!valid.ok) throw new Error("reply runtime: emitted a non-contract terminal event");
  const payload = event.payload as { operatorOutcome: OperatorOutcomeName; verification: "UNVERIFIED" };
  return { runId: event.runId, operatorOutcome: payload.operatorOutcome, verification: payload.verification };
}

/**
 * The offline / non-bridge runtime. It is NOT a hand-minted value: `report` constructs a real, contract-
 * valid v2 `RUN_OPERATOR_REPORTED` terminal event and the terminal is read back from it. Used whenever no
 * dev-bridge is attached (the default), including in mock mode and tests.
 */
export function createSimulatedReplyRuntime(): ReplyRuntime {
  // No transport and no listener to release — dispose here only closes the door, so the simulated
  // and bridge runtimes present ONE lifecycle to the caller and a consumer written against the
  // simulated one cannot accidentally keep driving a disposed bridge one.
  let disposed = false;
  return {
    start() {
      if (disposed) return Promise.reject(new ReplyRuntimeDisposedError());
      return Promise.resolve({ runId: mintRunId() });
    },
    report(runId, outcome) {
      if (disposed) return Promise.reject(new ReplyRuntimeDisposedError());
      const event: EventEnvelope = {
        protocolVersion: 2,
        eventId: `${runId}-e1`,
        runId,
        sequence: 1,
        revision: 1,
        type: "RUN_OPERATOR_REPORTED",
        occurredAt: "2026-01-01T00:00:00.000001Z",
        payload: { status: "OPERATOR_REPORTED", operatorOutcome: outcome, verification: "UNVERIFIED" },
      };
      return Promise.resolve(terminalFromEvent(event));
    },
    dispose() {
      disposed = true;
    },
  };
}

/**
 * A command acknowledgement from the agent — the envelope-level view of the wire's
 * `aw_command_result` frame. `reason`, when present, is one of the engine's sanitized rejection
 * codes (e.g. `STALE_REVISION`, `INVALID_FOR_STATE`, `INVALID_ENVELOPE`) — never free text.
 */
export interface ReplyCommandResult {
  commandId: string;
  accepted: boolean;
  reason?: string;
}

/**
 * The FE end of a v2 channel to the local agent. `createReplyFrameTransport` implements this over
 * the contract's frame-level `AwClientTransport`; test fakes implement it directly.
 */
export interface ReplyClientTransport {
  send(command: CommandEnvelope): void;
  subscribe(listener: (event: EventEnvelope) => void): () => void;
  /** Command acknowledgements. A rejection here is the ONLY early signal that a report cannot land. */
  subscribeResults(listener: (result: ReplyCommandResult) => void): () => void;
}

/**
 * **DISPOSAL CONTRACT — items 1 and 3 are now implemented here; item 2 belongs to injection.**
 *
 * <p>This factory subscribes ONCE at construction, to track the latest revision so a report carries
 * a fresh `expectedRevision`. `dispose()` releases that subscription, rejects any in-flight
 * `report()`, and makes later `start`/`report` fail closed with {@link ReplyRuntimeDisposedError} —
 * a disposed runtime can neither attach a new listener to a torn-down session nor send into one.
 * The tests pin the transport's listener count at **ZERO** after disposal (not merely at the
 * construction baseline the report-cleanup tests use), including when disposal lands mid-report.
 *
 * <p><b>What the injection slice still owes:</b> a caller that actually invokes `dispose()` — for a
 * React consumer, the cleanup of the effect that created the runtime, so unmounting a panel
 * releases it. Until that caller exists, nothing constructs this runtime in any build, and the
 * lifecycle guarantee below is proven but unexercised.
 *
 * <p>The dev-bridge runtime (VITE_AW_BRIDGE): drives a REAL agent-hosted reply run over an injected v2
 * transport, reading the runtime-assigned runId from the agent's `aw_session` announcement. `start`
 * dispatches the v2 START_RUN with a LAN-safe command id; `report` sends the operator's command and
 * resolves on the agent's `RUN_OPERATOR_REPORTED` terminal event — or rejects immediately when the
 * agent refuses the command (`aw_command_result.accepted=false`), instead of letting the refusal
 * hide behind the timeout. Only ever used when a dev-bridge is attached; the offline default is the
 * simulated runtime above.
 */
/**
 * How long a reported outcome waits for its terminal before giving up.
 *
 * <p>Any finite bound beats none. Without one, `report()` settles ONLY on
 * `RUN_OPERATOR_REPORTED`: a dropped socket, a rejected command, or an agent that died mid-run
 * leaves the promise pending forever, and the caller pending with it. Twelve seconds is longer than
 * a healthy local round-trip by orders of magnitude and shorter than an operator's patience.
 */
export const REPLY_REPORT_TIMEOUT_MS = 12_000;

/** Thrown when a reported outcome never reached its terminal. Distinguishable from a transport throw. */
export class ReplyReportTimeoutError extends Error {
  constructor() {
    super("reply runtime: no terminal event arrived for the reported outcome");
    this.name = "ReplyReportTimeoutError";
  }
}

/**
 * Thrown when the agent REFUSED the report command (`aw_command_result.accepted=false`) — the run
 * did not advance, and waiting for a terminal would only run the timeout down on an answer that has
 * already arrived. Retryable: the refusal is about this command (stale revision, wrong state), not
 * about the session.
 */
export class ReplyReportRejectedError extends Error {
  /** The agent's sanitized rejection code (e.g. `STALE_REVISION`), or `null` when it sent none. */
  readonly reason: string | null;
  constructor(reason: string | null) {
    super(`reply runtime: the agent rejected the report command${reason ? ` (${reason})` : ""}`);
    this.name = "ReplyReportRejectedError";
    this.reason = reason;
  }
}

/** Thrown by `start`/`report` on a disposed runtime, and by `dispose()` into any in-flight report. */
export class ReplyRuntimeDisposedError extends Error {
  constructor() {
    super("reply runtime: disposed — this runtime can no longer drive a run");
    this.name = "ReplyRuntimeDisposedError";
  }
}

export function createBridgeReplyRuntime(
  session: { transport: ReplyClientTransport; runId: string },
  options: { reportTimeoutMs?: number } = {},
): ReplyRuntime {
  const { transport, runId } = session;
  const reportTimeoutMs = options.reportTimeoutMs ?? REPLY_REPORT_TIMEOUT_MS;
  // Track the latest revision the agent has emitted for THIS run, so a report command carries a
  // fresh `expectedRevision`. Sending a stale 0 would trip the engine's `expectedRevision < revision`
  // guard (STALE_REVISION) once the run has advanced past START_RUN, and the report would never land.
  let latestRevision = 0;
  const stopRevisionTracking = transport.subscribe((event) => {
    if (event.runId === runId && event.revision > latestRevision) latestRevision = event.revision;
  });
  let disposed = false;
  // The abort hook of every unsettled report(), so dispose() can reject them instead of leaving
  // their listeners and timers to ride out the timeout on a session that no longer exists.
  const pendingAborts = new Set<() => void>();
  const command = (type: CommandEnvelope["type"], payload?: CommandEnvelope["payload"]): CommandEnvelope => ({
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: newCommandId(),
    runId,
    expectedRevision: latestRevision,
    type,
    ...(payload ? { payload } : {}),
  });
  return {
    start(input) {
      if (disposed) return Promise.reject(new ReplyRuntimeDisposedError());
      transport.send(command("START_RUN", { channelCode: input.channelCode, intent: "REPLY_SUBMISSION", submissionRef: input.submissionRef }));
      return Promise.resolve({ runId });
    },
    report(id, outcome) {
      if (disposed) return Promise.reject(new ReplyRuntimeDisposedError());
      return new Promise<ReplyTerminal>((resolve, reject) => {
        // ONE settle path, and it always tears BOTH subscriptions down. A listener that outlives its
        // promise is not merely a leak here: it holds a closure over a run that has finished, and a
        // later event on a reused transport would resolve a promise nobody is waiting on.
        let settled = false;
        let unsubscribeEvents: (() => void) | null = null;
        let unsubscribeResults: (() => void) | null = null;
        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribeEvents?.();
          unsubscribeResults?.();
          pendingAborts.delete(abort);
          fn();
        };
        const abort = (): void => settle(() => reject(new ReplyRuntimeDisposedError()));
        pendingAborts.add(abort);
        const timer = setTimeout(
          () => settle(() => reject(new ReplyReportTimeoutError())),
          reportTimeoutMs,
        );
        // Minted BEFORE the subscriptions so the result listener can close over its commandId — the
        // correlation key `aw_command_result` acks by.
        // REQUEST_STEP_RECHECK = "I posted it"; SWITCH_TO_MANUAL = "I did not" — both terminate the run.
        const reportCommand = command(outcome === "OPERATOR_REPORTED_SUBMITTED" ? "REQUEST_STEP_RECHECK" : "SWITCH_TO_MANUAL");
        unsubscribeEvents = transport.subscribe((event) => {
          if (event.type === "RUN_OPERATOR_REPORTED" && event.runId === id) {
            // terminalFromEvent throws on a non-contract terminal; route that through settle too, so
            // a malformed terminal rejects the caller instead of leaving it pending behind a throw
            // raised inside a listener nobody catches.
            settle(() => {
              try {
                resolve(terminalFromEvent(event));
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
              }
            });
          }
        });
        // A transport that delivers SYNCHRONOUSLY inside subscribe() settles before the assignment
        // above completes, so `settle`'s `unsubscribeEvents?.()` no-ops and the listener survives the
        // promise — the exact leak this function exists to prevent, reachable by a replaying or
        // buffering transport. Cheap to close, and closing it means the guarantee does not rest on
        // an assumption about a transport that has not been written yet.
        if (settled) {
          unsubscribeEvents();
          return;
        }
        unsubscribeResults = transport.subscribeResults((result) => {
          // The agent answered — and the answer is no. The run did not advance, no terminal is
          // coming for this command, and waiting for the timeout would only delay a decision the
          // agent has already made. An ACCEPTED result settles nothing: acceptance is not the
          // terminal, it is permission to keep waiting for one.
          if (result.commandId === reportCommand.commandId && !result.accepted) {
            settle(() => reject(new ReplyReportRejectedError(result.reason ?? null)));
          }
        });
        // Symmetry guard, currently unreachable rather than a live leak: a replay during
        // subscribeResults() cannot match `reportCommand.commandId` (it has not been SENT yet), and
        // a sync event-replay already returned above before this subscription existed. It stays
        // because the reachability argument rests on this exact ordering — reorder the mint, the
        // send, or the subscriptions, and this line is what turns that mistake into a no-op instead
        // of a leak.
        if (settled) {
          unsubscribeResults();
          return;
        }
        try {
          transport.send(reportCommand);
        } catch (e) {
          // A transport that throws on send would otherwise leave the promise pending AND the
          // listeners attached, with nothing ever arriving to clear either.
          settle(() => reject(e instanceof Error ? e : new Error(String(e))));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopRevisionTracking();
      // Copy first: each abort settles, and settling removes it from the set mid-iteration.
      for (const abort of [...pendingAborts]) abort();
    },
  };
}
