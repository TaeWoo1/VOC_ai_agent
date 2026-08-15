/**
 * **The locate carrier, as a thing a frontend can attach to.**
 *
 * Two properties, and both are about mis-attachment rather than about locating anything. An agent hosting a
 * locate run must ANNOUNCE that it is one — a frontend expecting a guided issuance walk would otherwise build
 * a correctly-versioned client against it and sit dormant. And an agent must host exactly one carrier: two
 * configured at once is a wiring bug that would let a seller's press reach the wrong run.
 */
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AW_CARRIER_KINDS, parseAwCarrierKind } from "../../../contracts/action-window/aw-carrier-kind";
import { ReviewLocateEndpoint } from "../../src/bridge/review-locate-endpoint";
import { createAgentBridge } from "../../src/agent/agent-bridge";
import { ReviewLocateFixtureDriver } from "../../src/action-window/coupang-review/review-locate-fixture-driver";
import { CoupangIssuanceFixtureDriver } from "../../src/action-window/coupang-issuance/coupang-issuance-fixture-driver";

/** A socket stand-in that records what was written to it. `readyState` OPEN so sends are not dropped. */
function fakeSocket(): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: (text: string) => sent.push(text),
  } as unknown as WebSocket;
  return { ws, sent };
}

const BRIDGE_BASE = {
  port: 0,
  allowedOrigins: ["http://127.0.0.1:5173"],
  pairingFile: "/dev/null",
  agentVersion: "test",
  refSalt: "salt",
};

describe("the review-locate carrier", () => {
  it("is a carrier kind of its own, and a known one", () => {
    expect(AW_CARRIER_KINDS).toContain("locate");
    expect(parseAwCarrierKind("locate")).toBe("locate");
  });

  it("announces `locate` on attach, so a client expecting another carrier fails closed", () => {
    const endpoint = new ReviewLocateEndpoint({ runId: "run_l1", channelCode: "coupang" });
    const { ws, sent } = fakeSocket();

    endpoint.onClientConnected(ws);

    expect(sent).toHaveLength(1);
    const announcement = JSON.parse(sent[0]!) as Record<string, unknown>;
    expect(announcement.type).toBe("aw_session");
    expect(announcement.carrier).toBe("locate");
    expect(announcement.runId).toBe("run_l1");
    expect(announcement.channelCode).toBe("coupang");
  });

  it("drops a malformed carrier payload instead of surfacing it", () => {
    const endpoint = new ReviewLocateEndpoint({ runId: "run_l1", channelCode: "coupang" });
    const seen: unknown[] = [];
    endpoint.transport.subscribe((frame) => seen.push(frame));
    const { ws } = fakeSocket();

    endpoint.onClientPayload(ws, "{not json");
    endpoint.onClientPayload(ws, JSON.stringify({ kind: "aw_view", view: {} }));

    expect(seen).toEqual([]);
  });

  it("refuses to host a second carrier beside it", () => {
    expect(() =>
      createAgentBridge({
        ...BRIDGE_BASE,
        reviewLocate: {
          runId: "run_l1",
          channelCode: "coupang",
          createDriver: () => new ReviewLocateFixtureDriver(),
          resolveTarget: async () => null,
        },
        coupangIssuance: {
          runId: "run_i1",
          channelCode: "coupang",
          createDriver: () => new CoupangIssuanceFixtureDriver(),
        },
      }),
    ).toThrow(/exactly one carrier/);
  });
});
