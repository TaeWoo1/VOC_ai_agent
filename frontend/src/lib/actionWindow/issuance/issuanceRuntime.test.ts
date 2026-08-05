// The guided-issuance run host. Proves the exactly-once + refresh-safe START_RUN discipline against a fake v2
// transport: resync-then-start when idle, reattach (no start) when a run is already hosted, command gating from
// allowedCommands, START_RUN refusal surfacing, and dispose. No socket, no browser.
import { describe, it, expect, vi } from "vitest";
import type {
  AwClientFrame,
  AwClientTransport,
  AwServerFrame,
} from "../../../../../contracts/action-window/v2/transport";
import type { ActionWindowRunView, CommandType } from "../../../../../contracts/action-window/v2/index";
import { createGuidedIssuanceRuntime } from "./issuanceRuntime";

/** A fake v2 transport: records what the host sends and lets a test push server frames back. */
function fakeTransport() {
  const sent: AwClientFrame[] = [];
  let listener: ((f: AwServerFrame) => void) | null = null;
  const transport: AwClientTransport = {
    send: (f) => sent.push(f),
    subscribe: (l) => {
      listener = l;
      return () => {
        if (listener === l) listener = null;
      };
    },
  };
  return {
    transport,
    sent,
    emit: (f: AwServerFrame) => listener?.(f),
    hasListener: () => listener !== null,
  };
}

function view(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 2,
    runId: "run_hosted01",
    revision: 4,
    channelCode: "naver",
    runCopyKey: "actionWindow.issuance.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "API_ISSUANCE_GUIDANCE",
    currentStep: {
      stepId: "aw.issuance_api_group",
      stepNumber: 3,
      totalSteps: 5,
      copyKey: "actionWindow.issuance.apiGroup",
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
    progress: { completedSteps: 2, totalSteps: 5 },
    updatedAt: "2026-01-01T00:00:00.000004Z",
    ...over,
  };
}

const commands = (sent: AwClientFrame[]) =>
  sent.filter((f): f is Extract<AwClientFrame, { kind: "aw_command" }> => f.kind === "aw_command");
const startRuns = (sent: AwClientFrame[]) => commands(sent).filter((f) => f.command.type === "START_RUN");
const resyncs = (sent: AwClientFrame[]) => sent.filter((f) => f.kind === "aw_resync");

describe("createGuidedIssuanceRuntime", () => {
  it("ensureStarted resyncs first, then START_RUN exactly once when the agent is idle", () => {
    const t = fakeTransport();
    const rt = createGuidedIssuanceRuntime({ transport: t.transport, runId: "run_seed", channelCode: "naver" });

    rt.ensureStarted();
    // Resync first; NO START_RUN before we know nothing is hosted.
    expect(resyncs(t.sent).length).toBe(1);
    expect(startRuns(t.sent).length).toBe(0);

    // Agent is idle → one START_RUN, addressed to the announced run, carrying intent + channel and NO ref.
    t.emit({ kind: "aw_resync_result", view: null, events: [] });
    const starts = startRuns(t.sent);
    expect(starts.length).toBe(1);
    const cmd = starts[0]!.command;
    expect(cmd.type).toBe("START_RUN");
    expect(cmd.expectedRevision).toBe(0);
    expect(cmd.payload).toEqual({ channelCode: "naver", intent: "API_ISSUANCE_GUIDANCE" });
    // Issuance binds to no approved work — none of the ref keys may be present.
    expect(cmd.payload).not.toHaveProperty("submissionRef");
    expect(cmd.payload).not.toHaveProperty("importRef");
    expect(cmd.payload).not.toHaveProperty("discoveryRef");
  });

  it("START_RUN fires once even if ensureStarted is called repeatedly (StrictMode / re-render safe)", () => {
    const t = fakeTransport();
    const rt = createGuidedIssuanceRuntime({ transport: t.transport, runId: "run_seed", channelCode: "naver" });

    rt.ensureStarted();
    rt.ensureStarted();
    rt.ensureStarted();
    // Only ONE resync even under repeated calls (subsequent calls are no-ops while resyncing).
    expect(resyncs(t.sent).length).toBe(1);

    t.emit({ kind: "aw_resync_result", view: null, events: [] });
    rt.ensureStarted(); // after start, still a no-op
    expect(startRuns(t.sent).length).toBe(1);
  });

  it("reattaches WITHOUT starting when a run is already hosted (page-refresh safe)", () => {
    const t = fakeTransport();
    const rt = createGuidedIssuanceRuntime({ transport: t.transport, runId: "run_seed", channelCode: "naver" });

    rt.ensureStarted();
    // The agent is already hosting a run → adopt it, send NO START_RUN.
    const hosted = view({ runId: "run_live99" });
    t.emit({ kind: "aw_resync_result", view: hosted, events: [] });

    expect(startRuns(t.sent).length).toBe(0);
    expect(rt.view()).toEqual(hosted);
  });

  it("a view arriving before the resync result adopts the run, so a late idle result never starts a second", () => {
    const t = fakeTransport();
    const rt = createGuidedIssuanceRuntime({ transport: t.transport, runId: "run_seed", channelCode: "naver" });

    rt.ensureStarted();
    t.emit({ kind: "aw_view", view: view({ runId: "run_live99" }) }); // adopts
    t.emit({ kind: "aw_resync_result", view: null, events: [] }); // stale idle result — must NOT start
    expect(startRuns(t.sent).length).toBe(0);
  });

  it("adopts the runId + view from the frame stream and publishes to subscribers", () => {
    const t = fakeTransport();
    const rt = createGuidedIssuanceRuntime({ transport: t.transport, runId: "run_seed", channelCode: "naver" });
    const seen: (ActionWindowRunView | null)[] = [];
    rt.subscribe((v) => seen.push(v));

    const v = view({ runId: "run_live99", revision: 7 });
    t.emit({ kind: "aw_view", view: v });
    expect(rt.view()).toEqual(v);
    expect(seen[seen.length - 1]).toEqual(v);
  });

  it("send() forwards only commands the current view allows", () => {
    const t = fakeTransport();
    const rt = createGuidedIssuanceRuntime({ transport: t.transport, runId: "run_seed", channelCode: "naver" });
    t.emit({ kind: "aw_view", view: view({ allowedCommands: ["REQUEST_STEP_RECHECK"] }) });

    rt.send("CANCEL_RUN" as CommandType); // not allowed → dropped
    expect(commands(t.sent).length).toBe(0);

    rt.send("REQUEST_STEP_RECHECK"); // allowed → forwarded with the freshest revision
    const cmds = commands(t.sent);
    expect(cmds.length).toBe(1);
    expect(cmds[0]!.command.type).toBe("REQUEST_STEP_RECHECK");
    expect(cmds[0]!.command.expectedRevision).toBe(4);
  });

  it("surfaces a START_RUN refusal via onStartRefused", () => {
    const t = fakeTransport();
    const onStartRefused = vi.fn();
    const rt = createGuidedIssuanceRuntime(
      { transport: t.transport, runId: "run_seed", channelCode: "naver" },
      { onStartRefused },
    );
    rt.ensureStarted();
    t.emit({ kind: "aw_resync_result", view: null, events: [] });
    const startCmdId = startRuns(t.sent)[0]!.command.commandId;

    t.emit({ kind: "aw_command_result", commandId: startCmdId, accepted: false, reason: "INVALID_FOR_STATE" });
    expect(onStartRefused).toHaveBeenCalledWith("INVALID_FOR_STATE");
  });

  it("dispose() detaches the transport and stops publishing", () => {
    const t = fakeTransport();
    const rt = createGuidedIssuanceRuntime({ transport: t.transport, runId: "run_seed", channelCode: "naver" });
    const seen: (ActionWindowRunView | null)[] = [];
    rt.subscribe((v) => seen.push(v));

    rt.dispose();
    expect(t.hasListener()).toBe(false);
    t.emit({ kind: "aw_view", view: view() }); // no listener → ignored
    expect(seen.length).toBe(0);
    rt.send("REQUEST_STEP_RECHECK");
    expect(commands(t.sent).length).toBe(0);
  });
});
