// **Isolated v2 reply-submission bridge path.** Strictly side-by-side with the v1 export world: this
// is the ONLY frontend module that imports `contracts/action-window/v2/`. It does NOT switch the shared
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
  return {
    start() {
      return Promise.resolve({ runId: mintRunId() });
    },
    report(runId, outcome) {
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
  };
}

/** The FE end of a v2 channel to the local agent (the dev-bridge transport implements this). */
export interface ReplyClientTransport {
  send(command: CommandEnvelope): void;
  subscribe(listener: (event: EventEnvelope) => void): () => void;
}

/**
 * The dev-bridge runtime (VITE_AW_BRIDGE): drives a REAL agent-hosted reply run over an injected v2
 * transport, reading the runtime-assigned runId from the agent's `aw_session` announcement. `start`
 * dispatches the v2 START_RUN with a LAN-safe command id; `report` sends the operator's command and
 * resolves on the agent's `RUN_OPERATOR_REPORTED` terminal event. Only ever used when a dev-bridge is
 * attached; the offline default is the simulated runtime above.
 */
export function createBridgeReplyRuntime(session: { transport: ReplyClientTransport; runId: string }): ReplyRuntime {
  const { transport, runId } = session;
  // Track the latest revision the agent has emitted for THIS run, so a report command carries a
  // fresh `expectedRevision`. Sending a stale 0 would trip the engine's `expectedRevision < revision`
  // guard (STALE_REVISION) once the run has advanced past START_RUN, and the report would never land.
  let latestRevision = 0;
  transport.subscribe((event) => {
    if (event.runId === runId && event.revision > latestRevision) latestRevision = event.revision;
  });
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
      transport.send(command("START_RUN", { channelCode: input.channelCode, intent: "REPLY_SUBMISSION", submissionRef: input.submissionRef }));
      return Promise.resolve({ runId });
    },
    report(id, outcome) {
      return new Promise<ReplyTerminal>((resolve) => {
        const unsubscribe = transport.subscribe((event) => {
          if (event.type === "RUN_OPERATOR_REPORTED" && event.runId === id) {
            unsubscribe();
            resolve(terminalFromEvent(event));
          }
        });
        // REQUEST_STEP_RECHECK = "I posted it"; SWITCH_TO_MANUAL = "I did not" — both terminate the run.
        transport.send(command(outcome === "OPERATOR_REPORTED_SUBMITTED" ? "REQUEST_STEP_RECHECK" : "SWITCH_TO_MANUAL"));
      });
    },
  };
}
