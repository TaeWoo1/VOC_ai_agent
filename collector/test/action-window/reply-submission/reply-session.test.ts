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
import { FixtureReplySubmitDriver, REPLY_FIXTURE_HINT } from "../../../src/action-window/reply-submission/reply-fixture";
import { ReplySubmitSession } from "../../../src/action-window/reply-submission/reply-session";
import type { ReplyTargetHint } from "../../../src/action-window/reply-submission/reply-surface";

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

function harness(
  driver: SyntheticReplySubmitDriver | FixtureReplySubmitDriver,
  cfg?: { targetHint?: ReplyTargetHint },
) {
  const { client, server } = createLoopbackChannel();
  const engine = new ReplyEngine(
    { runId: RUN_ID, channelCode: "naver", ...(cfg?.targetHint ? { targetHint: cfg.targetHint } : {}) },
    { clock: makeReplyClock() },
  );
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

describe("reply session — guided review-row locator over the fixture driver", () => {
  it("rows-present: row barrier → operator opens row → composer barrier → reports SUBMITTED", async () => {
    const driver = new FixtureReplySubmitDriver("rows-present", REPLY_FIXTURE_HINT);
    const { client, session, frames, latestView } = harness(driver, { targetHint: REPLY_FIXTURE_HINT });

    client.send({ kind: "aw_command", command: startCommand() });
    await session.whenSettled();
    // Rests at the ROW-open barrier (step 2 of 3) — the operator opens the reply control themselves.
    expect(latestView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(latestView()?.currentStep?.stepNumber).toBe(2);
    expect(latestView()?.progress.totalSteps).toBe(3);

    driver.applyRowOpen(true);
    await session.whenSettled(); // guards the watchRowOpen(autoBusy) continuation — must converge
    // Now at the COMPOSER submit barrier (step 3 of 3).
    expect(latestView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(latestView()?.currentStep?.stepNumber).toBe(3);

    driver.applySubmit(true);
    await session.whenSettled();
    client.send({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "cmd-report", runId: RUN_ID, expectedRevision: latestView()!.revision, type: "REQUEST_STEP_RECHECK" },
    });
    await session.whenSettled();
    expect(latestView()?.status).toBe("OPERATOR_REPORTED");
    assertFramesValid(frames);
  });

  it("rows-missing → TARGET_NOT_FOUND; rows-ambiguous → TARGET_AMBIGUOUS; rows-drift → fails closed", async () => {
    for (const [mode, code] of [
      ["rows-missing", "TARGET_NOT_FOUND"],
      ["rows-ambiguous", "TARGET_AMBIGUOUS"],
      ["rows-drift", "TARGET_NOT_FOUND"],
    ] as const) {
      const driver = new FixtureReplySubmitDriver(mode, REPLY_FIXTURE_HINT);
      const { client, session, latestView } = harness(driver, { targetHint: REPLY_FIXTURE_HINT });
      client.send({ kind: "aw_command", command: startCommand() });
      await session.whenSettled();
      expect(latestView()?.status, mode).toBe("FAILED");
      expect(latestView()?.blocker?.code, mode).toBe(code);
    }
  });

  it("abort at the row-open barrier → SUBMISSION_ABORTED, not a fault", async () => {
    const driver = new FixtureReplySubmitDriver("rows-present", REPLY_FIXTURE_HINT);
    const { client, session, latestView } = harness(driver, { targetHint: REPLY_FIXTURE_HINT });
    client.send({ kind: "aw_command", command: startCommand() });
    await session.whenSettled();
    expect(latestView()?.status).toBe("WAITING_FOR_HUMAN");

    client.send({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "cmd-abort", runId: RUN_ID, expectedRevision: latestView()!.revision, type: "SWITCH_TO_MANUAL" },
    });
    await session.whenSettled();
    expect(latestView()?.status).toBe("OPERATOR_REPORTED");
    expect(latestView()?.status).not.toBe("FAILED");
  });
});
