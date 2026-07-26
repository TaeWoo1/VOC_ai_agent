import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwClientTransport, AwServerFrame } from "../../../../contracts/action-window/v2/transport";
import type { JourneyObservation } from "../../../src/action-window/initial-import/journey-projection";
import type { JourneyProjectionPort } from "../../../src/action-window/initial-import/journey-ports";
import { TransportJourneyCommandPort, connectTransportViewsToPort } from "../../../src/action-window/initial-import/journey-live";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string, base = "../../../src/action-window/initial-import") => readFileSync(resolve(here, base, rel), "utf8");

/** A minimal view — the connector reads only runId + status. */
function view(runId: string, status: string): ActionWindowRunView {
  return { runId, revision: 1, status } as unknown as ActionWindowRunView;
}

describe("TransportJourneyCommandPort", () => {
  it("turns START_SEGMENT into a well-formed START_RUN command frame — no UI needed", () => {
    const sent: AwClientFrame[] = [];
    const client: AwClientTransport = { send: (f) => sent.push(f), subscribe: () => () => {} };
    new TransportJourneyCommandPort(client).send({
      kind: "START_SEGMENT",
      runId: "run-1",
      launchRef: "0123456789abcdef",
      channelCode: "naver",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "aw_command",
      command: {
        type: "START_RUN",
        runId: "run-1",
        expectedRevision: 0,
        payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: "0123456789abcdef" },
      },
    });
  });

  it("issues distinct command ids and passes payload-less commands through", () => {
    const sent: AwClientFrame[] = [];
    const client: AwClientTransport = { send: (f) => sent.push(f), subscribe: () => () => {} };
    const port = new TransportJourneyCommandPort(client);
    port.send({ kind: "REQUEST_STEP_RECHECK", runId: "run-1", expectedRevision: 3 });
    port.send({ kind: "CANCEL_RUN", runId: "run-1", expectedRevision: 4 });
    const ids = sent.map((f) => (f as { command: { commandId: string } }).command.commandId);
    expect(new Set(ids).size).toBe(2);
    expect(sent[0]).toMatchObject({ command: { type: "REQUEST_STEP_RECHECK", expectedRevision: 3 } });
    expect(sent[1]).toMatchObject({ command: { type: "CANCEL_RUN", expectedRevision: 4 } });
  });
});

describe("connectTransportViewsToPort", () => {
  it("maps run views to observations, marking a hosted segment once per new run", () => {
    const obs: JourneyObservation[] = [];
    const port: JourneyProjectionPort = { observe: (o) => void obs.push(o) };
    let listener: ((f: AwServerFrame) => void) | null = null;
    const client: AwClientTransport = {
      send: () => {},
      subscribe: (l) => {
        listener = l;
        return () => (listener = null);
      },
    };
    connectTransportViewsToPort(client, port);
    listener!({ kind: "aw_view", view: view("run-1", "PREPARING") });
    listener!({ kind: "aw_view", view: view("run-1", "COMPLETED") });
    listener!({ kind: "aw_view", view: view("run-2", "RUNNING") }); // a NEW run → another hosted-segment marker

    expect(obs).toEqual([
      { kind: "segment_entry", effect: "HOST_SEGMENT" },
      { kind: "run_status", status: "PREPARING" },
      { kind: "run_status", status: "COMPLETED" },
      { kind: "segment_entry", effect: "HOST_SEGMENT" },
      { kind: "run_status", status: "RUNNING" },
    ]);
  });

  it("ignores non-view frames and never sends anything back (observe-only)", () => {
    const obs: JourneyObservation[] = [];
    const port: JourneyProjectionPort = { observe: (o) => void obs.push(o) };
    let listener: ((f: AwServerFrame) => void) | null = null;
    let sends = 0;
    const client: AwClientTransport = {
      send: () => void (sends += 1),
      subscribe: (l) => {
        listener = l;
        return () => (listener = null);
      },
    };
    connectTransportViewsToPort(client, port);
    listener!({ kind: "aw_event", event: { protocolVersion: 2 } } as unknown as AwServerFrame);
    expect(obs).toHaveLength(0);
    expect(sends).toBe(0);
  });
});

describe("FE-independence source guard", () => {
  it("the kernel, graph, projection, ports, and live adapter import no React, FE module, or component", () => {
    const files: Array<[string, string]> = [
      ["journey.ts", "../../../../contracts/review-import-journey/v1"],
      ["readiness.ts", "../../../../contracts/session-readiness/v1"],
      ["journey-shadow.ts", "../../../src/action-window/initial-import"],
      ["journey-projection.ts", "../../../src/action-window/initial-import"],
      ["journey-ports.ts", "../../../src/action-window/initial-import"],
      ["journey-live.ts", "../../../src/action-window/initial-import"],
      ["session-readiness.ts", "../../../src/action-window/initial-import"],
    ];
    for (const [rel, base] of files) {
      const src = readSrc(rel, base)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"))
        .join("\n");
      expect(src).not.toMatch(/from ["']react/i);
      expect(src).not.toMatch(/from ["'][^"']*\/frontend\//);
      expect(src).not.toMatch(/\.tsx["']/);
      expect(src).not.toMatch(/useState|useEffect|from ["'][^"']*components/i);
    }
  });
});
