import { describe, it, expect, vi } from "vitest";
import type { AwClientFrame, AwServerFrame, ActionWindowRunView } from "../contract";
import { AcquireStartRejectedError, createAcquireRuntime, startPayload } from "./acquireRuntime";

function fakeTransport() {
  const sent: AwClientFrame[] = [];
  const listeners = new Set<(f: AwServerFrame) => void>();
  return {
    sent,
    send: (f: AwClientFrame) => sent.push(f),
    subscribe: (l: (f: AwServerFrame) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit: (f: AwServerFrame) => listeners.forEach((l) => l(f)),
  };
}

const VIEW: ActionWindowRunView = {
  runId: "run_1", channelCode: "coupang", status: "WAITING_FOR_HUMAN", revision: 3,
  runCopyKey: "actionWindow.run.export", currentStep: null, progress: { completedSteps: 0, totalSteps: 2 },
  blocker: null, allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"], updatedAt: "2026-08-28T00:00:00Z",
} as unknown as ActionWindowRunView;

describe("acquire runtime — one START_RUN, bound by intent", () => {
  it("EXPORT is sent v1-clean; REVIEW_ACQUISITION carries exactly its own ref", () => {
    expect(startPayload("naver", { intent: "EXPORT" })).toEqual({ channelCode: "naver" });
    expect(startPayload("coupang", { intent: "REVIEW_ACQUISITION", acquisitionRef: "acq-1" })).toEqual({
      channelCode: "coupang", intent: "REVIEW_ACQUISITION", acquisitionRef: "acq-1",
    });
  });

  it("start resolves on the agent's ack and uses the announced channel, never a caller value", async () => {
    const t = fakeTransport();
    const rt = createAcquireRuntime({ transport: t, runId: "run_0", channelCode: "coupang" }, { startTimeoutMs: 500 });
    const p = rt.start({ intent: "REVIEW_ACQUISITION", acquisitionRef: "acq-1" });
    const cmd = t.sent[0] as Extract<AwClientFrame, { kind: "aw_command" }>;
    expect(cmd.command.type).toBe("START_RUN");
    expect(cmd.command.payload).toEqual({ channelCode: "coupang", intent: "REVIEW_ACQUISITION", acquisitionRef: "acq-1" });
    t.emit({ kind: "aw_command_result", commandId: cmd.command.commandId, accepted: true });
    await expect(p).resolves.toBeUndefined();
  });

  it("a refused start rejects with the sanitized reason; views drive allowedCommands", async () => {
    const t = fakeTransport();
    const rt = createAcquireRuntime({ transport: t, runId: "run_0", channelCode: "naver" }, { startTimeoutMs: 500 });
    const p = rt.start({ intent: "EXPORT" });
    const cmd = t.sent[0] as Extract<AwClientFrame, { kind: "aw_command" }>;
    t.emit({ kind: "aw_command_result", commandId: cmd.command.commandId, accepted: false, reason: "INVALID_FOR_STATE" });
    await expect(p).rejects.toBeInstanceOf(AcquireStartRejectedError);
    const seen = vi.fn();
    rt.subscribe(seen);
    t.emit({ kind: "aw_view", view: VIEW });
    expect(seen).toHaveBeenCalledWith(VIEW);
    rt.send("SWITCH_TO_MANUAL"); // not allowed by the view ⇒ nothing sent
    expect(t.sent).toHaveLength(1);
    rt.send("REQUEST_STEP_RECHECK");
    expect(t.sent).toHaveLength(2);
    expect((t.sent[1] as Extract<AwClientFrame, { kind: "aw_command" }>).command.runId).toBe("run_1");
    rt.dispose();
  });
});
