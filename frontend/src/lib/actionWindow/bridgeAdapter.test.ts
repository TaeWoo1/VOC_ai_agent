import { describe, it, expect } from "vitest";
import {
  createLoopbackChannel,
  findProhibitedFields,
  validateCommandEnvelope,
  type AwClientFrame,
  type EventEnvelope,
} from "./contract";
import { UI_SCENARIOS } from "./fixtures";
import { createBridgeClient } from "./bridgeAdapter";

const RUN_ID = "run_fe";
const CHANNEL = "esm_plus";

function harness() {
  const channel = createLoopbackChannel();
  const sent: AwClientFrame[] = [];
  channel.server.subscribe((f) => sent.push(f));
  const client = createBridgeClient(channel.client, { runId: RUN_ID, channelCode: CHANNEL });
  let changes = 0;
  client.subscribe(() => {
    changes += 1;
  });
  return { channel, client, sent, changes: () => changes };
}

const waitingView = UI_SCENARIOS["human-action-required"].run!;

function observedEvent(sequence: number): EventEnvelope {
  return {
    protocolVersion: 1,
    eventId: `evt-${sequence}`,
    runId: RUN_ID,
    sequence,
    revision: 5,
    type: "USER_ACTION_OBSERVED",
    occurredAt: "2026-01-01T00:00:00.1Z",
    payload: { stepId: "aw.user_target_action", observed: true },
  };
}

describe("Action Window Bridge adapter", () => {
  it("connects by resyncing and starts with no run", () => {
    const { client, sent } = harness();
    client.connect();
    expect(sent).toEqual([{ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 }]);
    expect(client.getView()).toBeNull();
    expect(client.isAllowed("START_RUN")).toBe(true);
    expect(client.isAllowed("PAUSE_RUN")).toBe(false);
  });

  it("sends a contract-valid START_RUN with the channelCode payload", () => {
    const { client, sent } = harness();
    client.connect();
    client.send("START_RUN");
    const cmdFrame = sent.find((f) => f.kind === "aw_command");
    expect(cmdFrame?.kind).toBe("aw_command");
    if (cmdFrame?.kind !== "aw_command") throw new Error("no command");
    expect(cmdFrame.command.type).toBe("START_RUN");
    expect(cmdFrame.command.expectedRevision).toBe(0);
    expect(cmdFrame.command.payload).toEqual({ channelCode: CHANNEL });
    expect(validateCommandEnvelope(cmdFrame.command)).toEqual({ ok: true });
  });

  it("adopts the Runtime's view and honors its allowedCommands", () => {
    const { channel, client } = harness();
    client.connect();
    channel.server.send({ kind: "aw_view", view: waitingView });
    expect(client.getView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(client.isAllowed("REQUEST_STEP_RECHECK")).toBe(true);
    expect(client.isAllowed("PAUSE_RUN")).toBe(false); // not in this view's allowedCommands
  });

  it("refuses a command the current view does not allow (no frame sent)", () => {
    const { channel, client, sent } = harness();
    client.connect();
    channel.server.send({ kind: "aw_view", view: waitingView });
    const before = sent.length;
    client.send("PAUSE_RUN");
    expect(sent.length).toBe(before); // nothing sent
    expect(client.getNote()).not.toBe("");
  });

  it("surfaces an FE-authored note when the Runtime rejects a command", () => {
    const { channel, client } = harness();
    client.connect();
    channel.server.send({ kind: "aw_view", view: waitingView });
    channel.server.send({ kind: "aw_command_result", commandId: "x", accepted: false, reason: "STALE_REVISION" });
    expect(client.getNote()).not.toContain("STALE_REVISION"); // never leak the raw reason as prose
    expect(client.getNote()).not.toBe("");
  });

  it("tracks sequence and resyncs from the last seen event on reconnect", () => {
    const { channel, client, sent } = harness();
    client.connect();
    channel.server.send({ kind: "aw_view", view: waitingView });
    channel.server.send({ kind: "aw_event", event: observedEvent(8) });

    // Reconnect: resync must carry the last seen sequence so the Runtime replays only what was missed.
    client.resync();
    const lastResync = [...sent].reverse().find((f) => f.kind === "aw_resync");
    expect(lastResync).toEqual({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 8 });
  });

  it("recovers the latest view + missed events from a resync reply", () => {
    const { channel, client } = harness();
    client.connect();
    channel.server.send({
      kind: "aw_resync_result",
      view: waitingView,
      events: [observedEvent(8)],
    });
    expect(client.getView()?.status).toBe("WAITING_FOR_HUMAN");
  });

  it("ignores duplicate and out-of-order events", () => {
    const { channel, client, sent } = harness();
    client.connect();
    channel.server.send({ kind: "aw_event", event: observedEvent(8) });
    channel.server.send({ kind: "aw_event", event: observedEvent(8) }); // duplicate
    channel.server.send({ kind: "aw_event", event: observedEvent(3) }); // out of order
    client.resync();
    const lastResync = [...sent].reverse().find((f) => f.kind === "aw_resync");
    expect(lastResync).toEqual({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 8 });
  });

  it("never puts a prohibited field on the wire", () => {
    const { channel, client, sent } = harness();
    client.connect();
    channel.server.send({ kind: "aw_view", view: waitingView });
    client.send("REQUEST_STEP_RECHECK");
    for (const frame of sent) expect(findProhibitedFields(frame)).toEqual([]);
  });
});
