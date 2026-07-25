// The guided-import runtime: what it puts on the wire, and what it refuses to.
//
// Every test here is about a rule that, broken, fails somewhere far away — a command addressed to a finished
// run, a step completed on the client's word, a ticket spent on a run that never started.
import { describe, expect, it, vi } from "vitest";
import {
  createGuidedImportRuntime,
  GuidedImportStartRejectedError,
  GuidedImportStartTimeoutError,
  type GuidedImportSnapshot,
} from "./importRuntime";
import type {
  ActionWindowRunView,
  CommandEnvelope,
  CommandType,
} from "../../../../../contracts/action-window/v2/index";
import { validateCommandEnvelope } from "../../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwClientTransport, AwServerFrame } from "../../../../../contracts/action-window/v2/transport";

function view(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 2,
    runId: "run_aaaaaaaaaaaa",
    revision: 5,
    channelCode: "naver",
    runCopyKey: "actionWindow.run.naverInitialReviewImportSegment",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "INITIAL_REVIEW_IMPORT_SEGMENT",
    currentStep: {
      stepId: "aw.import_set_start_date",
      stepNumber: 3,
      totalSteps: 8,
      copyKey: "actionWindow.import.setStartDate",
      copyParams: { targetKind: "start_date", requiredStart: "2026-06-01", requiredEnd: "2026-06-30" },
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 2, totalSteps: 8 },
    updatedAt: "2026-01-01T00:00:00.000005Z",
    ...over,
  };
}

/** A transport that records what was sent and lets a test push server frames back. */
function fakeTransport() {
  const sent: AwClientFrame[] = [];
  const listeners = new Set<(frame: AwServerFrame) => void>();
  const transport: AwClientTransport = {
    send: (frame) => sent.push(frame),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    transport,
    sent,
    listenerCount: () => listeners.size,
    deliver: (frame: AwServerFrame) => {
      for (const l of [...listeners]) l(frame);
    },
    /** Accept whatever START_RUN is in flight, as the agent's ack would. */
    ack: (accepted = true, reason?: string) => {
      const command = sent[sent.length - 1];
      if (!command || command.kind !== "aw_command") throw new Error("no command to ack");
      for (const l of [...listeners]) {
        l({
          kind: "aw_command_result",
          commandId: command.command.commandId,
          accepted,
          ...(reason ? { reason } : {}),
        } as AwServerFrame);
      }
    },
  };
}

/** Last element, spelled out: the FE's TS lib target predates `Array.prototype.at`. */
const last = <T,>(items: T[]): T => items[items.length - 1]!;

const commandsOf = (frames: AwClientFrame[]): CommandEnvelope[] =>
  frames.filter((f): f is Extract<AwClientFrame, { kind: "aw_command" }> => f.kind === "aw_command").map((f) => f.command);

describe("START_RUN carries exactly one binding ref, chosen by kind", () => {
  it("sends a discoveryRef for a discovery run, and no other ref", async () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const started = runtime.start({ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" });
    t.ack();
    await started;

    const [command] = commandsOf(t.sent);
    const payload = command!.payload as Record<string, unknown>;
    expect(command!.type).toBe("START_RUN");
    expect(payload.intent).toBe("INITIAL_REVIEW_IMPORT_DISCOVERY");
    expect(payload.discoveryRef).toBe("0f1e2d3c4b5a6978");
    expect(payload.importRef).toBeUndefined();
    expect(payload.submissionRef).toBeUndefined();
  });

  it("sends an importRef for a segment run, and no other ref", async () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const started = runtime.start({ launchRef: "9a8b7c6d5e4f3021", kind: "SEGMENT" });
    t.ack();
    await started;

    const payload = commandsOf(t.sent)[0]!.payload as Record<string, unknown>;
    expect(payload.intent).toBe("INITIAL_REVIEW_IMPORT_SEGMENT");
    expect(payload.importRef).toBe("9a8b7c6d5e4f3021");
    expect(payload.discoveryRef).toBeUndefined();
  });

  /** The channel a run touches is the agent's own announced one, never a value the caller chose. */
  it("uses the agent's announced channel code", async () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const started = runtime.start({ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" });
    t.ack();
    await started;
    expect((commandsOf(t.sent)[0]!.payload as Record<string, unknown>).channelCode).toBe("naver");
  });

  it("emits contract-valid envelopes", async () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const started = runtime.start({ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" });
    t.ack();
    await started;
    t.deliver({ kind: "aw_view", view: view() });
    runtime.send("REQUEST_STEP_RECHECK");

    for (const command of commandsOf(t.sent)) {
      expect(validateCommandEnvelope(command).ok, command.type).toBe(true);
    }
  });
});

describe("start settles on the agent's answer, not on hope", () => {
  it("resolves when the agent accepts", async () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const started = runtime.start({ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" });
    t.ack();
    await expect(started).resolves.toBeUndefined();
  });

  /** A refusal must land immediately: the caller's ticket is unspent and it can hand it back. */
  it("rejects with the sanitized reason when the agent refuses", async () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const started = runtime.start({ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" });
    t.ack(false, "INVALID_FOR_STATE");
    await expect(started).rejects.toBeInstanceOf(GuidedImportStartRejectedError);
  });

  it("rejects rather than hang when the agent never answers", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTransport();
      const runtime = createGuidedImportRuntime(
        { transport: t.transport, runId: "run_announce01", channelCode: "naver" },
        { startTimeoutMs: 50 },
      );
      const started = runtime.start({ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" });
      const assertion = expect(started).rejects.toBeInstanceOf(GuidedImportStartTimeoutError);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no result listener behind once start settles", async () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const before = t.listenerCount();
    const started = runtime.start({ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" });
    t.ack();
    await started;
    expect(t.listenerCount()).toBe(before);
  });
});

describe("the run identity comes from the agent", () => {
  /**
   * The import host mints a fresh identity per run and re-announces it. An FE that kept the attach-time value
   * would address the next segment's commands to the finished run, and its `expectedRevision` would never line
   * up again.
   */
  it("adopts the runId from the latest view, not the attach-time announcement", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });

    t.deliver({ kind: "aw_view", view: view({ runId: "run_segment0002" }) });
    runtime.send("REQUEST_STEP_RECHECK");

    expect(last(commandsOf(t.sent)).runId).toBe("run_segment0002");
  });

  it("carries the freshest revision it has seen", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    t.deliver({ kind: "aw_view", view: view({ revision: 11 }) });
    runtime.send("CANCEL_RUN");
    expect(last(commandsOf(t.sent)).expectedRevision).toBe(11);
  });
});

describe("commands come from allowedCommands alone", () => {
  it("sends a command the view allows", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    t.deliver({ kind: "aw_view", view: view({ allowedCommands: ["REQUEST_STEP_RECHECK"] }) });
    runtime.send("REQUEST_STEP_RECHECK");
    expect(commandsOf(t.sent).map((c) => c.type)).toEqual(["REQUEST_STEP_RECHECK"]);
  });

  /** A client deciding what is permitted is a client driving a state machine that is not its own. */
  it.each(["CANCEL_RUN", "PAUSE_RUN", "RESUME_RUN", "SWITCH_TO_MANUAL"] as CommandType[])(
    "refuses %s when the view does not allow it",
    (type) => {
      const t = fakeTransport();
      const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
      t.deliver({ kind: "aw_view", view: view({ allowedCommands: ["REQUEST_STEP_RECHECK"] }) });
      runtime.send(type);
      expect(commandsOf(t.sent)).toEqual([]);
    },
  );

  it("sends nothing at all before the first view", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    runtime.send("REQUEST_STEP_RECHECK");
    expect(t.sent).toEqual([]);
  });

  it("sends nothing after a completed run withdraws every command", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    t.deliver({ kind: "aw_view", view: view({ status: "COMPLETED", allowedCommands: [] }) });
    runtime.send("REQUEST_STEP_RECHECK");
    expect(commandsOf(t.sent)).toEqual([]);
  });
});

describe("published state mirrors the runtime, and nothing else", () => {
  it("projects the step, blocker and allowed commands from the view", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    const seen: (GuidedImportSnapshot | null)[] = [];
    runtime.subscribe((s) => seen.push(s));

    t.deliver({ kind: "aw_view", view: view({ blocker: { code: "SCOPE_MISMATCH", recoverable: true } as never }) });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      runId: "run_aaaaaaaaaaaa",
      status: "WAITING_FOR_HUMAN",
      intent: "INITIAL_REVIEW_IMPORT_SEGMENT",
      blocker: { code: "SCOPE_MISMATCH", recoverable: true },
      allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    });
    expect(seen[0]?.step).toMatchObject({ stepNumber: 3, totalSteps: 8, copyKey: "actionWindow.import.setStartDate" });
  });

  it("recovers an in-flight run from a resync, so a page refresh does not hide it", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    runtime.resync();
    expect(t.sent[t.sent.length - 1]).toEqual({ kind: "aw_resync", runId: "run_announce01", sinceSequence: 0 });

    t.deliver({ kind: "aw_resync_result", view: view({ runId: "run_inflight01" }), events: [] });
    expect(runtime.snapshot()?.runId).toBe("run_inflight01");
  });

  /** An idle agent is reported as idle. Inventing a PREPARING state would show a run that does not exist. */
  it("reports null when a resync finds nothing hosted", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    t.deliver({ kind: "aw_view", view: view() });
    t.deliver({ kind: "aw_resync_result", view: null, events: [] });
    expect(runtime.snapshot()).toBeNull();
  });

  it("stops publishing and stops sending once disposed", () => {
    const t = fakeTransport();
    const runtime = createGuidedImportRuntime({ transport: t.transport, runId: "run_announce01", channelCode: "naver" });
    t.deliver({ kind: "aw_view", view: view() });
    runtime.dispose();

    t.deliver({ kind: "aw_view", view: view({ revision: 99 }) });
    expect(runtime.snapshot()?.revision).toBe(5);
    runtime.send("REQUEST_STEP_RECHECK");
    expect(commandsOf(t.sent)).toEqual([]);
    expect(t.listenerCount()).toBe(0);
  });
});
