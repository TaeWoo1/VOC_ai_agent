/**
 * Initial-review-import Bridge endpoint (v2 opaque carrier) over a fake WebSocket — no real Bridge server.
 *
 * The behaviour unique to this endpoint is RE-ARMING: an onboarding import is a sequence of runs (discovery,
 * then one per monthly segment) that a seller works through in one sitting, so the hosted run identity has
 * to change without the agent restarting. Everything else — the announcement, opaque relay, malformed-frame
 * drop, directed acks — mirrors the export/reply endpoints and is pinned here so the three cannot drift.
 */
import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { serializeFrame } from "../../../contracts/action-window/v2/transport";
import { AW_CARRIER_IMPORT } from "../../../contracts/action-window/aw-carrier-kind";
import { InitialImportEndpoint } from "../../src/bridge/initial-import-endpoint";

const RUN_ID = "run_import_1";
const NEXT_RUN_ID = "run_import_2";
const IMPORT_REF = "9a8b7c6d5e4f3021";

function fakeWs() {
  const sent: string[] = [];
  const ws = { readyState: WebSocket.OPEN, send: (s: string) => sent.push(s) } as unknown as WebSocket;
  return { ws, sent };
}

const announcements = (sent: string[]): Array<Record<string, unknown>> =>
  sent.map((s) => JSON.parse(s) as Record<string, unknown>).filter((m) => m.type === "aw_session");

const carrierFrames = (sent: string[]): string[] =>
  sent.map((s) => JSON.parse(s) as { type: string; payload?: string }).filter((m) => m.type === "aw").map((m) => m.payload!);

describe("InitialImportEndpoint — announcement", () => {
  it("announces the import carrier so an export/reply client cannot cross-attach", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);

    expect(announcements(sent)[0]).toMatchObject({
      type: "aw_session",
      carrier: AW_CARRIER_IMPORT,
      transportVersion: 1,
      runId: RUN_ID,
      channelCode: "naver",
    });
  });

  it("setAnnouncing(false) suppresses the announcement to the next socket", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    endpoint.setAnnouncing(false);
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);
    expect(sent).toEqual([]);
    expect(endpoint.isAnnouncing()).toBe(false);
  });
});

describe("InitialImportEndpoint — re-arming for the next segment", () => {
  it("re-announces the new run to clients that are ALREADY attached", () => {
    // Without this, a still-connected frontend keeps addressing the finished run and its expectedRevision
    // can never line up again — the seller would have to reconnect between every segment.
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);

    endpoint.armRun(NEXT_RUN_ID);

    const ann = announcements(sent);
    expect(ann).toHaveLength(2);
    expect(ann[1]).toMatchObject({ runId: NEXT_RUN_ID, carrier: AW_CARRIER_IMPORT });
    expect(endpoint.hostedRunId()).toBe(NEXT_RUN_ID);
  });

  it("re-announces to every attached client, not just the most recent", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const a = fakeWs();
    const b = fakeWs();
    endpoint.onClientConnected(a.ws);
    endpoint.onClientConnected(b.ws);

    endpoint.armRun(NEXT_RUN_ID);

    expect(announcements(a.sent).at(-1)).toMatchObject({ runId: NEXT_RUN_ID });
    expect(announcements(b.sent).at(-1)).toMatchObject({ runId: NEXT_RUN_ID });
  });

  it("a socket attaching after the re-arm hears the CURRENT run, not the finished one", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    endpoint.armRun(NEXT_RUN_ID);
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);
    expect(announcements(sent)[0]).toMatchObject({ runId: NEXT_RUN_ID });
  });

  it("does not announce a re-arm while announcing is paused", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);
    endpoint.setAnnouncing(false);
    endpoint.armRun(NEXT_RUN_ID);
    expect(announcements(sent)).toHaveLength(1); // only the original attach
    expect(endpoint.hostedRunId()).toBe(NEXT_RUN_ID); // state still advanced
  });

  it("a disconnected client stops receiving re-arms", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws, sent } = fakeWs();
    endpoint.onClientConnected(ws);
    endpoint.onClientDisconnected(ws);
    endpoint.armRun(NEXT_RUN_ID);
    expect(announcements(sent)).toHaveLength(1);
    expect(endpoint.clientCount()).toBe(0);
  });
});

describe("InitialImportEndpoint — opaque relay", () => {
  it("relays a START_RUN command frame to the Runtime verbatim, without inspecting it", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const received: unknown[] = [];
    endpoint.transport.subscribe((frame) => received.push(frame));
    const { ws } = fakeWs();
    endpoint.onClientConnected(ws);

    endpoint.onClientPayload(ws, serializeFrame({
      kind: "aw_command",
      command: {
        protocolVersion: 2, commandId: "c1", runId: RUN_ID, expectedRevision: 0, type: "START_RUN",
        payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: IMPORT_REF },
      },
    }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      kind: "aw_command",
      command: { type: "START_RUN", payload: { intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: IMPORT_REF } },
    });
  });

  it("relays a resync request", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const received: unknown[] = [];
    endpoint.transport.subscribe((frame) => received.push(frame));
    const { ws } = fakeWs();
    endpoint.onClientConnected(ws);
    endpoint.onClientPayload(ws, serializeFrame({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 }));
    expect(received[0]).toMatchObject({ kind: "aw_resync", sinceSequence: 0 });
  });

  it.each([
    ["not-json", "malformed JSON"],
    ['{"kind":"aw_view","view":{}}', "a SERVER frame arriving from a client"],
  ])("drops %s without throwing (%s)", (payload) => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const received: unknown[] = [];
    endpoint.transport.subscribe((frame) => received.push(frame));
    const { ws } = fakeWs();
    endpoint.onClientConnected(ws);
    expect(() => endpoint.onClientPayload(ws, payload)).not.toThrow();
    expect(received).toEqual([]);
  });

  it("broadcasts run state to all clients but directs a command ack to the asking socket only", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const a = fakeWs();
    const b = fakeWs();
    endpoint.onClientConnected(a.ws);
    endpoint.onClientConnected(b.ws);

    // An event is run state: everyone attached needs it.
    endpoint.transport.send({
      kind: "aw_event",
      event: {
        protocolVersion: 2, eventId: "e1", runId: RUN_ID, sequence: 1, revision: 1, type: "RUN_STARTED",
        occurredAt: "2026-07-25T00:00:00Z", payload: { status: "PREPARING" },
      },
    });
    expect(carrierFrames(a.sent)).toHaveLength(1);
    expect(carrierFrames(b.sent)).toHaveLength(1);

    // An ack answers one socket's request — sent from inside that socket's payload handling.
    endpoint.transport.subscribe(() => {
      endpoint.transport.send({ kind: "aw_command_result", commandId: "c1", accepted: true });
    });
    endpoint.onClientPayload(a.ws, serializeFrame({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 }));
    expect(carrierFrames(a.sent)).toHaveLength(2);
    expect(carrierFrames(b.sent)).toHaveLength(1);
  });

  it("close() detaches every client and listener", () => {
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws } = fakeWs();
    endpoint.onClientConnected(ws);
    endpoint.close();
    expect(endpoint.clientCount()).toBe(0);
  });
});

describe("InitialImportEndpoint — no launch ref in logs", () => {
  it("never logs a launch ref (it authorizes a live run, so it is treated as a credential)", async () => {
    const { getLogSink, clearLogSink } = await import("../../src/log");
    clearLogSink();
    const endpoint = new InitialImportEndpoint({ runId: RUN_ID, channelCode: "naver" });
    const { ws } = fakeWs();
    endpoint.onClientConnected(ws);
    endpoint.onClientPayload(ws, serializeFrame({
      kind: "aw_command",
      command: {
        protocolVersion: 2, commandId: "c1", runId: RUN_ID, expectedRevision: 0, type: "START_RUN",
        payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: IMPORT_REF },
      },
    }));
    endpoint.armRun(NEXT_RUN_ID);
    expect(JSON.stringify(getLogSink())).not.toContain(IMPORT_REF);
    clearLogSink();
  });
});
