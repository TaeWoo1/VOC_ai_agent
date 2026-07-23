// Isolated v2 reply-submission runtime: the offline simulated runtime and the dev-bridge runtime.
// Proves the runtime terminal is the sole source of the recorded outcome + a real run_<hex> runId,
// and that the dev-bridge path speaks v2 with LAN-safe command ids.
import { afterEach, describe, it, expect, vi } from "vitest";
import type { CommandEnvelope, EventEnvelope } from "../../../../../contracts/action-window/v2/index";
import {
  resolveReplyRuntime,
  createBridgeReplyRuntime,
  createSimulatedReplyRuntime,
  startReplySubmission,
  type ReplyClientTransport,
} from "./replyRuntime";

const RUN_HEX = /^run_[0-9a-f]{12}$/;

describe("simulated reply runtime", () => {
  it("startReplySubmission assigns a real run_<hex> runId (never fabricated by the caller)", async () => {
    const runtime = createSimulatedReplyRuntime();
    const handle = await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });
    expect(handle.runId).toMatch(RUN_HEX);
  });

  it("reportSubmitted / abortSubmission resolve a terminal sourced from the runtime, always UNVERIFIED", async () => {
    const runtime = createSimulatedReplyRuntime();
    const submitted = await (await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" })).reportSubmitted();
    expect(submitted).toEqual({ runId: submitted.runId, operatorOutcome: "OPERATOR_REPORTED_SUBMITTED", verification: "UNVERIFIED" });
    expect(submitted.runId).toMatch(RUN_HEX);

    const aborted = await (await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" })).abortSubmission();
    expect(aborted.operatorOutcome).toBe("SUBMISSION_ABORTED");
    expect(aborted.verification).toBe("UNVERIFIED");
  });

  it("each run gets a distinct runId", async () => {
    const runtime = createSimulatedReplyRuntime();
    const a = await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });
    const b = await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });
    expect(a.runId).not.toBe(b.runId);
  });
});

describe("dev-bridge reply runtime (v2 over an injected transport)", () => {
  function fakeTransport(): { transport: ReplyClientTransport; sent: CommandEnvelope[]; emit: (e: EventEnvelope) => void } {
    const sent: CommandEnvelope[] = [];
    const listeners = new Set<(e: EventEnvelope) => void>();
    return {
      sent,
      emit: (e) => listeners.forEach((l) => l(e)),
      transport: {
        send: (c) => sent.push(c),
        subscribe: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
    };
  }

  it("start dispatches a v2 START_RUN(REPLY_SUBMISSION, submissionRef) with a LAN-safe command id", async () => {
    const { transport, sent } = fakeTransport();
    const runtime = createBridgeReplyRuntime({ transport, runId: "run_agentabcd12" });
    await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });
    expect(sent).toHaveLength(1);
    const start = sent[0]!;
    expect(start.type).toBe("START_RUN");
    expect(start.protocolVersion).toBe(2);
    expect(start.runId).toBe("run_agentabcd12");
    expect(start.commandId.length).toBeGreaterThan(0);
    expect(start.payload).toEqual({ channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" });
  });

  it("report carries a FRESH expectedRevision from the agent's events (never a stale 0)", async () => {
    const { transport, sent, emit } = fakeTransport();
    const runtime = createBridgeReplyRuntime({ transport, runId: "run_agentabcd12" });
    const handle = await startReplySubmission(runtime, { channelCode: "naver", submissionRef: "a1b2c3d4e5f60718" });
    // The agent advances the run to the human barrier — the FE tracks the revision from these events.
    for (let rev = 1; rev <= 6; rev++) {
      emit({ protocolVersion: 2, eventId: `run_agentabcd12-e${rev}`, runId: "run_agentabcd12", sequence: rev, revision: rev,
        type: "RUN_STATUS_CHANGED", occurredAt: "2026-01-01T00:00:00.000001Z", payload: { status: "WAITING_FOR_HUMAN" } });
    }

    const pending = handle.reportSubmitted();
    // Without revision tracking this would be 0 and a real engine would reject it STALE_REVISION.
    expect(sent[1]!.type).toBe("REQUEST_STEP_RECHECK");
    expect(sent[1]!.expectedRevision).toBe(6);

    // The agent drives to its terminal; the FE reads the outcome FROM that event.
    emit({
      protocolVersion: 2, eventId: "run_agentabcd12-e9", runId: "run_agentabcd12", sequence: 9, revision: 9,
      type: "RUN_OPERATOR_REPORTED", occurredAt: "2026-01-01T00:00:00.000009Z",
      payload: { status: "OPERATOR_REPORTED", operatorOutcome: "OPERATOR_REPORTED_SUBMITTED", verification: "UNVERIFIED" },
    });
    expect(await pending).toEqual({ runId: "run_agentabcd12", operatorOutcome: "OPERATOR_REPORTED_SUBMITTED", verification: "UNVERIFIED" });
  });
});

describe("resolveReplyRuntime — production may not mint a run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns NULL in a production build, so nothing can simulate a run", () => {
    // The defect this replaced: with no bridge wired, the panel silently fell back to the simulated
    // runtime in EVERY shipped build — minting a `run_<hex>` locally, synthesising a terminal, and
    // persisting that fabricated identity into review_reply_outcome.aw_run_ref. The database could
    // not tell it from a real guided run.
    vi.stubEnv("DEV", false);

    expect(resolveReplyRuntime()).toBeNull();
  });

  it("gives DEV builds the simulated runtime, which is the only place it belongs", () => {
    vi.stubEnv("DEV", true);

    expect(resolveReplyRuntime()).not.toBeNull();
  });

  it("a null runtime is not a broken runtime — there is simply nothing to drive", () => {
    // Stated as a test so the null is read as a capability statement rather than an error state:
    // callers branch on it to offer a manual handoff, they do not retry it.
    vi.stubEnv("DEV", false);

    const runtime = resolveReplyRuntime();

    expect(runtime).toBeNull();
    expect(() => resolveReplyRuntime()).not.toThrow();
  });
});
