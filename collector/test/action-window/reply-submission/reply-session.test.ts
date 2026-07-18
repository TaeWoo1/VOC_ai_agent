/**
 * End-to-end reply-submission session over the in-process v2 loopback transport. No browser, no
 * Bridge server. Proves the whole choreography — auto prep → human barrier → operator report →
 * OPERATOR_REPORTED — emits only valid, sanitized v2 frames, and that the session never submits.
 */
import { describe, it, expect } from "vitest";
import {
  validateEventEnvelope,
  validateRunView,
  findProhibitedFields,
  type ActionWindowRunView,
  type CommandEnvelope,
} from "../../../../contracts/action-window/v2/index";
import { createLoopbackChannel, type AwServerFrame } from "../../../../contracts/action-window/v2/transport";
import { ReplyEngine, makeReplyClock } from "../../../src/action-window/reply-submission/reply-engine";
import { SyntheticReplySubmitDriver } from "../../../src/action-window/reply-submission/reply-driver";
import { FixtureReplySubmitDriver } from "../../../src/action-window/reply-submission/reply-fixture";
import { ReplySubmitSession } from "../../../src/action-window/reply-submission/reply-session";

const RUN_ID = "run_reply_e2e";

function startCommand(): CommandEnvelope {
  return {
    protocolVersion: 2,
    commandId: "cmd-start",
    runId: RUN_ID,
    expectedRevision: 0,
    type: "START_RUN",
    payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" },
  };
}

function harness(driver: SyntheticReplySubmitDriver | FixtureReplySubmitDriver) {
  const { client, server } = createLoopbackChannel();
  const engine = new ReplyEngine({ runId: RUN_ID, channelCode: "naver" }, { clock: makeReplyClock() });
  const session = new ReplySubmitSession(engine, driver, server);
  session.attach();
  const frames: AwServerFrame[] = [];
  client.subscribe((f) => frames.push(f));
  const latestView = (): ActionWindowRunView | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]!;
      if (f.kind === "aw_view") return f.view;
    }
    return undefined;
  };
  return { client, session, frames, latestView };
}

function assertFramesValid(frames: AwServerFrame[]) {
  for (const f of frames) {
    if (f.kind === "aw_event") expect(validateEventEnvelope(f.event), f.event.type).toEqual({ ok: true });
    if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
  }
  expect(findProhibitedFields(frames)).toEqual([]);
}

describe("reply session — end to end over the v2 loopback", () => {
  it("submitted: prep → barrier → operator reports SUBMITTED → OPERATOR_REPORTED", async () => {
    const driver = new SyntheticReplySubmitDriver();
    const { client, session, frames, latestView } = harness(driver);

    client.send({ kind: "aw_command", command: startCommand() });
    await session.whenSettled();
    expect(latestView()?.status).toBe("WAITING_FOR_HUMAN");

    driver.completeSubmit(true); // the seller submitted — an observation, not completion
    await session.whenSettled();
    expect(latestView()?.status).toBe("WAITING_FOR_HUMAN"); // still awaiting the operator's report

    client.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2, commandId: "cmd-report", runId: RUN_ID,
        expectedRevision: latestView()!.revision, type: "REQUEST_STEP_RECHECK",
      },
    });
    await session.whenSettled();

    expect(latestView()?.status).toBe("OPERATOR_REPORTED");
    const reported = frames.find((f) => f.kind === "aw_event" && f.event.type === "SUBMISSION_REPORTED");
    expect(reported && reported.kind === "aw_event" && reported.event.payload.operatorOutcome)
      .toBe("OPERATOR_REPORTED_SUBMITTED");
    // Never a completion on the wire.
    expect(frames.some((f) => f.kind === "aw_event" && f.event.type === "RUN_COMPLETED")).toBe(false);
    assertFramesValid(frames);
  });

  it("aborted: operator switches to manual → SUBMISSION_ABORTED, OPERATOR_REPORTED", async () => {
    const driver = new FixtureReplySubmitDriver("composer-present");
    const { client, session, frames, latestView } = harness(driver);

    client.send({ kind: "aw_command", command: startCommand() });
    await session.whenSettled();

    client.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2, commandId: "cmd-abort", runId: RUN_ID,
        expectedRevision: latestView()!.revision, type: "SWITCH_TO_MANUAL",
      },
    });
    await session.whenSettled();

    expect(latestView()?.status).toBe("OPERATOR_REPORTED");
    const reported = frames.find((f) => f.kind === "aw_event" && f.event.type === "SUBMISSION_REPORTED");
    expect(reported && reported.kind === "aw_event" && reported.event.payload.operatorOutcome)
      .toBe("SUBMISSION_ABORTED");
    assertFramesValid(frames);
  });

  it("a missing composer fails closed before the barrier", async () => {
    const driver = new FixtureReplySubmitDriver("composer-missing");
    const { client, session, latestView } = harness(driver);
    client.send({ kind: "aw_command", command: startCommand() });
    await session.whenSettled();
    expect(latestView()?.status).toBe("FAILED");
    expect(latestView()?.blocker?.code).toBe("TARGET_NOT_FOUND");
  });
});
