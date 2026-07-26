/**
 * **Live wiring for the journey ports over the Action Window transport — observe-only.**
 *
 * The Bridge/FE channel is just one adapter of the two journey ports. This module provides that adapter:
 *
 *  - `connectTransportViewsToPort` taps the run VIEWS the runtime already publishes (the exact frames the FE
 *    reads) and pushes sanitized observations to a `JourneyProjectionPort`. It is a second, passive reader of
 *    the same stream — it subscribes, it never sends, and it changes nothing the runtime does. It carries no
 *    identity across: only a run status enum and, on a newly-seen run, a "a hosted segment began" marker. The
 *    run id is read solely to notice a NEW run; it is never emitted or logged.
 *
 *  - `TransportJourneyCommandPort` issues journey commands as Action Window command frames. It is the same
 *    path the FE uses, behind the port — so a headless caller drives a run with no React and no open tab.
 *
 * The upper journey (auth, account, plan, pairing) does NOT cross this transport, so a shadow fed only from
 * here cannot see it and MUST NOT infer it — it starts at `UNOBSERVED_EXTERNAL` (see `journey-shadow.ts`).
 *
 * No browser, no network of its own, no FE import.
 */
import type { AwClientTransport } from "../../../../contracts/action-window/v2/transport";
import type { JourneyCommand, JourneyCommandPort, JourneyProjectionPort } from "./journey-ports";

/** The intent a segment start carries, per the shared contract. */
const SEGMENT_INTENT = "INITIAL_REVIEW_IMPORT_SEGMENT";
/** The v2 command protocol version the runtime validates against (matches the FE's own command frames). */
const COMMAND_PROTOCOL_VERSION = 2;

/**
 * Subscribe to the run views on a client transport and push sanitized observations to a projection port.
 * Returns an unsubscribe. Observe-only: it never sends a frame.
 *
 * On the FIRST view of a run it emits a `segment_entry: HOST_SEGMENT` observation — the observable handoff
 * from the unobserved external prefix — then the run-status observation. Subsequent views of that run emit
 * only the status. The run id is used only to detect a new run; it never leaves this function.
 */
export function connectTransportViewsToPort(client: AwClientTransport, port: JourneyProjectionPort): () => void {
  const seenRuns = new Set<string>();
  return client.subscribe((frame) => {
    if (frame.kind !== "aw_view") return;
    const runId = frame.view.runId;
    const status = frame.view.status;
    if (typeof runId === "string" && runId.length > 0 && !seenRuns.has(runId)) {
      seenRuns.add(runId);
      void port.observe({ kind: "segment_entry", effect: "HOST_SEGMENT" });
    }
    if (typeof status === "string") {
      void port.observe({ kind: "run_status", status });
    }
  });
}

/**
 * The Bridge/FE transport as a `JourneyCommandPort` adapter. Turns a journey command into the Action Window
 * command frame the runtime already understands. Command ids come from a per-adapter counter — deterministic,
 * no clock, no randomness.
 */
export class TransportJourneyCommandPort implements JourneyCommandPort {
  private seq = 0;

  constructor(private readonly client: AwClientTransport) {}

  send(command: JourneyCommand): void {
    this.seq += 1;
    const commandId = `journey-cmd-${this.seq}`;
    if (command.kind === "START_SEGMENT") {
      this.client.send({
        kind: "aw_command",
        command: {
          protocolVersion: COMMAND_PROTOCOL_VERSION,
          commandId,
          runId: command.runId,
          expectedRevision: command.expectedRevision ?? 0,
          type: "START_RUN",
          payload: { channelCode: command.channelCode, intent: SEGMENT_INTENT, importRef: command.launchRef },
        },
      });
      return;
    }
    // REQUEST_STEP_RECHECK / CANCEL_RUN — payload-less commands addressed to a run at a revision.
    this.client.send({
      kind: "aw_command",
      command: {
        protocolVersion: COMMAND_PROTOCOL_VERSION,
        commandId,
        runId: command.runId,
        expectedRevision: command.expectedRevision,
        type: command.kind,
        payload: {},
      },
    });
  }
}
