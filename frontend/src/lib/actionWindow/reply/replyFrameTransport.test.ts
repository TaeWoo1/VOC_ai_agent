// The envelope↔frame adapter: unit-level mapping proofs, then the loopback E2E that drives the
// REAL runtime over REAL serialized v2 frames — the first time anything shaped like the wire has
// done so (until this slice, the only ReplyClientTransport was a hand-rolled fake).
import { describe, it, expect } from "vitest";
import {
  createLoopbackChannel,
  type AwClientFrame,
  type AwClientTransport,
  type AwServerFrame,
} from "../../../../../contracts/action-window/v2/transport";
import type {
  ActionWindowRunView,
  CommandEnvelope,
  EventEnvelope,
} from "../../../../../contracts/action-window/v2/index";
import { createReplyFrameTransport } from "./replyFrameTransport";
import {
  createBridgeReplyRuntime,
  startReplySubmission,
  type ReplyCommandResult,
} from "./replyRuntime";

const RUN_ID = "run_agentabcd12";

function commandEnvelope(type: CommandEnvelope["type"]): CommandEnvelope {
  return { protocolVersion: 2, commandId: "cmd-1", runId: RUN_ID, expectedRevision: 0, type };
}

function terminalEvent(outcome: "OPERATOR_REPORTED_SUBMITTED" | "SUBMISSION_ABORTED"): EventEnvelope {
  return {
    protocolVersion: 2,
    eventId: `${RUN_ID}-e1`,
    runId: RUN_ID,
    sequence: 1,
    revision: 1,
    type: "RUN_OPERATOR_REPORTED",
    occurredAt: "2026-01-01T00:00:00.000001Z",
    payload: { status: "OPERATOR_REPORTED", operatorOutcome: outcome, verification: "UNVERIFIED" },
  } as EventEnvelope;
}

function fakeFrames(): {
  transport: AwClientTransport;
  sent: AwClientFrame[];
  emit: (f: AwServerFrame) => void;
  listenerCount: () => number;
} {
  const sent: AwClientFrame[] = [];
  const listeners = new Set<(f: AwServerFrame) => void>();
  return {
    sent,
    emit: (f) => listeners.forEach((l) => l(f)),
    listenerCount: () => listeners.size,
    transport: {
      send: (f) => sent.push(f),
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
  };
}

describe("createReplyFrameTransport — the envelope↔frame mapping", () => {
  it("wraps a sent command in an aw_command frame, unchanged", () => {
    const frames = fakeFrames();
    const reply = createReplyFrameTransport(frames.transport);
    const command = commandEnvelope("START_RUN");

    reply.send(command);

    expect(frames.sent).toEqual([{ kind: "aw_command", command }]);
  });

  it("unwraps aw_event frames to bare EventEnvelopes for event subscribers", () => {
    const frames = fakeFrames();
    const reply = createReplyFrameTransport(frames.transport);
    const seen: EventEnvelope[] = [];
    reply.subscribe((e) => seen.push(e));
    const event = terminalEvent("OPERATOR_REPORTED_SUBMITTED");

    frames.emit({ kind: "aw_event", event });

    expect(seen).toEqual([event]);
  });

  it("unwraps aw_command_result frames for result subscribers — reason carried verbatim, or absent", () => {
    const frames = fakeFrames();
    const reply = createReplyFrameTransport(frames.transport);
    const seen: ReplyCommandResult[] = [];
    reply.subscribeResults((r) => seen.push(r));

    frames.emit({ kind: "aw_command_result", commandId: "cmd-1", accepted: false, reason: "STALE_REVISION" });
    frames.emit({ kind: "aw_command_result", commandId: "cmd-2", accepted: true });

    expect(seen).toEqual([
      { commandId: "cmd-1", accepted: false, reason: "STALE_REVISION" },
      { commandId: "cmd-2", accepted: true },
    ]);
  });

  it("routes frames to the RIGHT channel and drops what the reply path does not consume", () => {
    // aw_view / aw_resync_result have no audience in the reply runtime (no View Model, no resync) —
    // they must reach NEITHER listener, and events must not leak into results or vice versa.
    const frames = fakeFrames();
    const reply = createReplyFrameTransport(frames.transport);
    const events: EventEnvelope[] = [];
    const results: ReplyCommandResult[] = [];
    reply.subscribe((e) => events.push(e));
    reply.subscribeResults((r) => results.push(r));

    frames.emit({ kind: "aw_view", view: { revision: 1 } as unknown as ActionWindowRunView });
    frames.emit({ kind: "aw_resync_result", view: null, events: [terminalEvent("SUBMISSION_ABORTED")] });
    frames.emit({ kind: "aw_event", event: terminalEvent("OPERATOR_REPORTED_SUBMITTED") });
    frames.emit({ kind: "aw_command_result", commandId: "cmd-1", accepted: true });

    expect(events).toHaveLength(1);
    expect(results).toHaveLength(1);
  });

  it("each unsubscribe releases exactly its own frame listener — the frame layer returns to zero", () => {
    // The zero-after-disposal pin is measured HERE in the runtime's tests; it only means something
    // if the adapter really maps one reply subscription to one frame subscription.
    const frames = fakeFrames();
    const reply = createReplyFrameTransport(frames.transport);
    const offEvents = reply.subscribe(() => {});
    const offResults = reply.subscribeResults(() => {});
    expect(frames.listenerCount()).toBe(2);

    offEvents();
    expect(frames.listenerCount()).toBe(1);
    offResults();
    expect(frames.listenerCount()).toBe(0);
  });
});

describe("the runtime over the adapter over the contract's loopback — real frames, real serialization", () => {
  // createLoopbackChannel round-trips every frame through serializeFrame/deserializeFrame and
  // delivers synchronously — the harshest honest model of the in-process wire.

  it("drives a full guided report to its terminal through serialized aw_command / aw_event frames", async () => {
    const { client, server } = createLoopbackChannel();
    const received: CommandEnvelope[] = [];
    server.subscribe((frame) => {
      if (frame.kind !== "aw_command") return;
      received.push(frame.command);
      // The real session acks EVERY command — start() resolves on this ack, and for the report the
      // accepted ack is NOT the terminal: the runtime must keep waiting through it.
      server.send({ kind: "aw_command_result", commandId: frame.command.commandId, accepted: true });
      if (frame.command.type === "REQUEST_STEP_RECHECK") {
        server.send({ kind: "aw_event", event: terminalEvent("OPERATOR_REPORTED_SUBMITTED") });
      }
    });
    const runtime = createBridgeReplyRuntime({ transport: createReplyFrameTransport(client), runId: RUN_ID });

    const handle = await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });
    const terminal = await handle.reportSubmitted();

    expect(terminal).toEqual({ runId: RUN_ID, operatorOutcome: "OPERATOR_REPORTED_SUBMITTED", verification: "UNVERIFIED" });
    expect(received.map((c) => c.type)).toEqual(["START_RUN", "REQUEST_STEP_RECHECK"]);
    expect(received[0]!.payload).toEqual({ channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" });
  });

  it("surfaces an agent refusal IMMEDIATELY through a serialized aw_command_result frame", async () => {
    const { client, server } = createLoopbackChannel();
    server.subscribe((frame) => {
      if (frame.kind === "aw_command" && frame.command.type === "SWITCH_TO_MANUAL") {
        server.send({ kind: "aw_command_result", commandId: frame.command.commandId, accepted: false, reason: "STALE_REVISION" });
      }
    });
    // A timeout this long turns into a hang-then-fail if the rejection ever stops settling early.
    const runtime = createBridgeReplyRuntime(
      { transport: createReplyFrameTransport(client), runId: RUN_ID },
      { reportTimeoutMs: 10_000 },
    );

    await expect(runtime.report(RUN_ID, "SUBMISSION_ABORTED")).rejects.toMatchObject({
      name: "ReplyReportRejectedError",
      reason: "STALE_REVISION",
    });
  });

  it("surfaces a refused START_RUN immediately as well — the failure lands at the click that caused it", async () => {
    const { client, server } = createLoopbackChannel();
    server.subscribe((frame) => {
      if (frame.kind === "aw_command" && frame.command.type === "START_RUN") {
        server.send({ kind: "aw_command_result", commandId: frame.command.commandId, accepted: false, reason: "INVALID_FOR_STATE" });
      }
    });
    const runtime = createBridgeReplyRuntime(
      { transport: createReplyFrameTransport(client), runId: RUN_ID },
      { startTimeoutMs: 10_000 },
    );

    await expect(runtime.start({ channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" })).rejects.toMatchObject({
      name: "ReplyStartRejectedError",
      reason: "INVALID_FOR_STATE",
    });
  });
});
