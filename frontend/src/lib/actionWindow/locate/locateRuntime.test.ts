// **The FE end of a locate run.**
//
// Two properties carry the weight. Every press is its own `START_RUN` with its own binding — unlike the
// guided-issuance host, which sends one for the life of a walk — because a seller presses `[쿠팡에서 보기]`
// on whichever review they are looking at, as often as they like. And a command the current view does not
// allow is never sent: the runtime alone decides what a run can do, and a client-side guess is how a run
// gets driven into a state it never entered.
import { describe, expect, it, vi } from "vitest";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  validateCommandEnvelope,
  type ActionWindowRunView,
} from "../../../../../contracts/action-window/v2/index";
import type {
  AwClientFrame,
  AwClientTransport,
  AwServerFrame,
} from "../../../../../contracts/action-window/v2/transport";
import { createLocateRuntime } from "./locateRuntime";

const REF = "a1b2c3d4e5f60718";

function harness() {
  const sent: AwClientFrame[] = [];
  const listeners = new Set<(frame: AwServerFrame) => void>();
  const transport: AwClientTransport = {
    send: (frame) => {
      sent.push(frame);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const runtime = createLocateRuntime({ transport, runId: "run_l1", channelCode: "coupang" });
  return {
    runtime,
    sent,
    server: (frame: AwServerFrame) => {
      for (const l of [...listeners]) l(frame);
    },
  };
}

function view(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 2,
    runId: "run_l1",
    revision: 4,
    channelCode: "coupang",
    runCopyKey: "actionWindow.reviewLocate.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "REVIEW_LOCATE",
    currentStep: {
      stepId: "aw.review_locate_open_list",
      stepNumber: 1,
      totalSteps: 2,
      copyKey: "actionWindow.reviewLocate.openList",
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "FIND_CURRENT_STEP"],
    blocker: { code: "TARGET_NOT_FOUND", recoverable: true },
    progress: { completedSteps: 0, totalSteps: 2 },
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...over,
  };
}

describe("the locate runtime", () => {
  it("sends a valid REVIEW_LOCATE START_RUN carrying the binding and nothing else", () => {
    const h = harness();

    h.runtime.locate(REF);

    expect(h.sent).toHaveLength(1);
    const frame = h.sent[0] as { kind: string; command: unknown };
    expect(frame.kind).toBe("aw_command");
    expect(validateCommandEnvelope(frame.command)).toEqual({ ok: true });
    const command = frame.command as { type: string; payload: Record<string, unknown> };
    expect(command.type).toBe("START_RUN");
    expect(command.payload).toEqual({ channelCode: "coupang", intent: "REVIEW_LOCATE", locateRef: REF });
  });

  it("opens nothing until the seller presses", () => {
    const h = harness();

    expect(h.sent).toHaveLength(0);
  });

  /** Each press is a press. The issuance host's exactly-once guard would be wrong here. */
  it("sends a fresh START_RUN for every press", () => {
    const h = harness();

    h.runtime.locate(REF);
    h.runtime.locate("00112233445566ff");

    expect(h.sent).toHaveLength(2);
    const refs = h.sent.map((f) => ((f as { command: { payload: { locateRef: string } } }).command.payload.locateRef));
    expect(refs).toEqual([REF, "00112233445566ff"]);
  });

  it("adopts the run identity and revision from the agent's own view", () => {
    const h = harness();
    h.server({ kind: "aw_view", view: view({ runId: "run_other", revision: 9 }) });

    h.runtime.send("REQUEST_STEP_RECHECK");

    const command = (h.sent[0] as { command: { runId: string; expectedRevision: number } }).command;
    expect(command.runId).toBe("run_other");
    expect(command.expectedRevision).toBe(9);
  });

  it("refuses to send a command the current view does not allow", () => {
    const h = harness();
    h.server({ kind: "aw_view", view: view({ status: "COMPLETED", allowedCommands: [], blocker: undefined }) });

    h.runtime.send("REQUEST_STEP_RECHECK");

    expect(h.sent).toHaveLength(0);
  });

  it("reports a refused press so the screen can say the agent declined it", () => {
    const onStartRefused = vi.fn();
    const sent: AwClientFrame[] = [];
    const listeners = new Set<(frame: AwServerFrame) => void>();
    const runtime = createLocateRuntime(
      {
        transport: {
          send: (frame) => {
            sent.push(frame);
          },
          subscribe: (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
          },
        },
        runId: "run_l1",
        channelCode: "coupang",
      },
      { onStartRefused },
    );

    runtime.locate(REF);
    const commandId = (sent[0] as { command: { commandId: string } }).command.commandId;
    for (const l of [...listeners]) {
      l({ kind: "aw_command_result", commandId, accepted: false, reason: "INVALID_PAYLOAD" });
    }

    expect(onStartRefused).toHaveBeenCalledWith("INVALID_PAYLOAD");
  });

  it("stops sending and stops publishing once disposed", () => {
    const h = harness();
    const seen: (ActionWindowRunView | null)[] = [];
    h.runtime.subscribe((v) => seen.push(v));

    h.runtime.dispose();
    h.runtime.locate(REF);
    h.server({ kind: "aw_view", view: view() });

    expect(h.sent).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it("speaks the protocol version the contract pins", () => {
    const h = harness();
    h.runtime.locate(REF);

    expect((h.sent[0] as { command: { protocolVersion: number } }).command.protocolVersion).toBe(
      ACTION_WINDOW_PROTOCOL_VERSION,
    );
  });
});
