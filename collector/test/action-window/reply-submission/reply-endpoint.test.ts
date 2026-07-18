/**
 * Reply-submission Bridge endpoint (v2 opaque carrier) driven with the shared dispatch service over a
 * fake WebSocket — no real Bridge server. Proves the aw_session announcement, that a START_RUN carrier
 * drives the hosted reply session to OPERATOR_REPORTED, and that malformed frames are dropped.
 */
import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { deserializeFrame, serializeFrame } from "../../../../contracts/action-window/v2/transport";
import { ReplySubmissionEndpoint } from "../../../src/bridge/reply-submission-endpoint";
import { assembleReplyRun } from "../../../src/action-window/reply-submission/reply-dispatch";
import { SyntheticReplySubmitDriver } from "../../../src/action-window/reply-submission/reply-driver";

const RUN_ID = "run_reply_endpoint";

function fakeWs() {
  const sent: string[] = [];
  const ws = { readyState: WebSocket.OPEN, send: (s: string) => sent.push(s) } as unknown as WebSocket;
  return { ws, sent };
}

/** Unwrap the `{type:"aw"}` carrier frames the endpoint sends and return the latest run-view status/revision. */
function latestView(sent: string[]): { status: string; revision: number } | undefined {
  let out: { status: string; revision: number } | undefined;
  for (const raw of sent) {
    const outer = JSON.parse(raw) as { type: string; payload?: string };
    if (outer.type !== "aw" || !outer.payload) continue;
    const frame = deserializeFrame(outer.payload);
    if (frame.kind === "aw_view") out = { status: frame.view.status, revision: frame.view.revision };
  }
  return out;
}

describe("ReplySubmissionEndpoint", () => {
  it("announces aw_session on connect and drives START_RUN → report → OPERATOR_REPORTED", async () => {
    const endpoint = new ReplySubmissionEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);

    const announcement = JSON.parse(sent[0]!);
    expect(announcement).toMatchObject({ type: "aw_session", transportVersion: 1, runId: RUN_ID, channelCode: "naver" });

    const driver = new SyntheticReplySubmitDriver();
    const { session } = assembleReplyRun(endpoint.transport, { runId: RUN_ID, channelCode: "naver", createDriver: () => driver });
    session.attach();

    endpoint.onClientPayload(ws, serializeFrame({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "c1", runId: RUN_ID, expectedRevision: 0, type: "START_RUN",
        payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" } },
    }));
    await session.whenSettled();
    expect(latestView(sent)?.status).toBe("WAITING_FOR_HUMAN");

    driver.completeSubmit(true);
    await session.whenSettled();

    endpoint.onClientPayload(ws, serializeFrame({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "c2", runId: RUN_ID, expectedRevision: latestView(sent)!.revision, type: "REQUEST_STEP_RECHECK" },
    }));
    await session.whenSettled();

    expect(latestView(sent)?.status).toBe("OPERATOR_REPORTED");
  });

  it("drops a malformed carrier frame without throwing", () => {
    const endpoint = new ReplySubmissionEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws } = fakeWs();
    endpoint.onClientConnected(ws);
    expect(() => endpoint.onClientPayload(ws, "not-json")).not.toThrow();
  });

  it("setAnnouncing(false) suppresses the aw_session announcement to the next socket", () => {
    const endpoint = new ReplySubmissionEndpoint({ runId: RUN_ID, channelCode: "naver" });
    endpoint.setAnnouncing(false);
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);
    expect(sent).toEqual([]);
  });
});
