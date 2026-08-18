import { describe, it, expect, beforeEach } from "vitest";
import { createLoopbackChannel, type AwClientFrame } from "./contract";
import { UI_SCENARIOS } from "./fixtures";
import { createBridgeClient } from "./bridgeAdapter";
import {
  connectBridgeIfEnabled,
  createBridgeSource,
  resetBridgeBootForTests,
  retryBridgeBoot,
} from "./bridgeSource";
import {
  adoptBridgeSource,
  dispatchOperationsCommand,
  getOperationsState,
  loadRunScenario,
  resetOperationsStateForTests,
} from "./operationsStore";

const RUN_ID = "run_demo_esm";

/** Full FE stack below the seam: loopback wire → real BridgeClient → bridgeSource → store. */
function adoptLiveBridge() {
  const { client: clientTransport, server } = createLoopbackChannel();
  const received: AwClientFrame[] = [];
  server.subscribe((frame) => received.push(frame));
  const client = createBridgeClient(clientTransport, { runId: RUN_ID, channelCode: "esm_plus" });
  const source = createBridgeSource(client);
  let closed = false;
  adoptBridgeSource(source, () => {
    source.close();
    closed = true;
  });
  return { server, received, source, isClosed: () => closed };
}

describe("Action Window FE-3 bridge source (loopback wire)", () => {
  beforeEach(() => {
    resetOperationsStateForTests();
    resetBridgeBootForTests();
  });

  it("adopting the bridge source starts a fresh bridge world and requests a resync", () => {
    const { received } = adoptLiveBridge();
    const s = getOperationsState();
    expect(s.sourceMode).toBe("bridge");
    expect(s.run).toBeNull();
    expect(received[0]).toEqual({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 });
  });

  it("server views flow through the seam into the store", () => {
    const { server } = adoptLiveBridge();
    server.send({ kind: "aw_view", view: UI_SCENARIOS["human-action-required"].run! });
    expect(getOperationsState().run?.status).toBe("WAITING_FOR_HUMAN");
    server.send({ kind: "aw_view", view: UI_SCENARIOS["observing"].run! }); // revision 6
    expect(getOperationsState().run?.status).toBe("RUNNING");
  });

  it("commands go out as real contract envelopes with expectedRevision", () => {
    const { server, received } = adoptLiveBridge();
    server.send({ kind: "aw_view", view: UI_SCENARIOS["human-action-required"].run! }); // revision 4
    dispatchOperationsCommand("REQUEST_STEP_RECHECK");
    const frame = received[received.length - 1]!;
    expect(frame.kind).toBe("aw_command");
    if (frame.kind !== "aw_command") return;
    expect(frame.command.type).toBe("REQUEST_STEP_RECHECK");
    expect(frame.command.expectedRevision).toBe(4);
    expect(frame.command.runId).toBe(RUN_ID);
    expect(frame.command.commandId.length).toBeGreaterThan(0);
  });

  it("a rejected command surfaces a safe note and never mutates the view", () => {
    const { server, received } = adoptLiveBridge();
    server.send({ kind: "aw_view", view: UI_SCENARIOS["human-action-required"].run! });
    dispatchOperationsCommand("REQUEST_STEP_RECHECK");
    const sent = received[received.length - 1]!;
    const commandId = sent.kind === "aw_command" ? sent.command.commandId : "";
    server.send({ kind: "aw_command_result", commandId, accepted: false });
    const s = getOperationsState();
    expect(s.note.length).toBeGreaterThan(0);
    expect(s.note).not.toContain("aw_"); // safe FE copy, never a raw frame/reason code
    expect(s.run?.status).toBe("WAITING_FOR_HUMAN"); // view untouched
    expect(s.run?.currentStep?.status).not.toBe("COMPLETED");
  });

  it("disallowed commands are refused client-side with the safe note (no wire frame)", () => {
    const { received } = adoptLiveBridge(); // view is null → only START_RUN allowed
    dispatchOperationsCommand("PAUSE_RUN");
    expect(getOperationsState().note).toBe("지금은 할 수 없는 동작이라 무시했어요.");
    expect(received.filter((f) => f.kind === "aw_command")).toHaveLength(0);
  });

  it("a resync reply hydrates the view (reconnect-snapshot equivalent)", () => {
    const { server } = adoptLiveBridge();
    server.send({ kind: "aw_resync_result", view: UI_SCENARIOS["completed"].run!, events: [] });
    expect(getOperationsState().run?.status).toBe("COMPLETED");
  });

  it("stale view revisions never regress the adopted view", () => {
    const { server } = adoptLiveBridge();
    server.send({ kind: "aw_view", view: UI_SCENARIOS["observing"].run! }); // revision 6
    server.send({ kind: "aw_view", view: UI_SCENARIOS["human-action-required"].run! }); // revision 4
    expect(getOperationsState().run?.revision).toBe(6);
    expect(getOperationsState().run?.status).toBe("RUNNING");
  });

  it("loading a fixture scenario tears the bridge down and returns to the fixture world", () => {
    const { received, isClosed } = adoptLiveBridge();
    loadRunScenario("observing");
    const s = getOperationsState();
    expect(s.sourceMode).toBe("fixture");
    expect(isClosed()).toBe(true);
    dispatchOperationsCommand("CANCEL_RUN"); // fixture transition works again
    expect(getOperationsState().run).toBeNull();
    expect(received.filter((f) => f.kind === "aw_command")).toHaveLength(0); // nothing leaked to the wire
  });

  it("resetting the store tears down an adopted bridge", () => {
    const { isClosed } = adoptLiveBridge();
    resetOperationsStateForTests();
    expect(isClosed()).toBe(true);
    expect(getOperationsState().sourceMode).toBe("fixture");
    expect(getOperationsState().run).toBeNull(); // the product surface's initial world is empty (A7)
  });

  it("connectBridgeIfEnabled is a no-op without the env opt-in (honest fallback)", async () => {
    const connected = await connectBridgeIfEnabled(); // VITE_AW_BRIDGE unset in tests
    expect(connected).toBe(false);
    expect(getOperationsState().sourceMode).toBe("fixture");
  });

  it("real transport status drives the store's connection state (banner + suppression)", () => {
    const { source, server } = adoptLiveBridge();
    server.send({ kind: "aw_view", view: UI_SCENARIOS["observing"].run! });
    expect(getOperationsState().connection).toBe("connected");

    source.notifyStatus("reconnecting"); // socket dropped, retry loop running
    expect(getOperationsState().connection).toBe("reconnecting");
    expect(getOperationsState().run?.status).toBe("RUNNING"); // last view stays, read-only

    source.notifyStatus("offline"); // retries exhausted / dormant
    expect(getOperationsState().connection).toBe("offline");

    source.notifyStatus("connected"); // restored (transport already resynced)
    expect(getOperationsState().connection).toBe("connected");
  });

  it("FE-4: re-adopting after offline restores a fresh connected world and resyncs from zero", () => {
    const first = adoptLiveBridge();
    first.server.send({ kind: "aw_view", view: UI_SCENARIOS["observing"].run! });
    first.source.notifyStatus("offline"); // transport gave up (retries exhausted / dormant)
    expect(getOperationsState().connection).toBe("offline");

    // A successful manual reconnect adopts a FRESH bridge world — exactly what
    // `retryBridgeBoot()` does on success: the offline source is closed, the world
    // is reset to connected, and the new session resyncs from sequence 0.
    const second = adoptLiveBridge();
    expect(first.isClosed()).toBe(true);
    const s = getOperationsState();
    expect(s.connection).toBe("connected");
    expect(s.sourceMode).toBe("bridge");
    expect(s.run).toBeNull();
    expect(second.received[0]).toEqual({ kind: "aw_resync", runId: RUN_ID, sinceSequence: 0 });
  });

  it("retryBridgeBoot permits another opt-in attempt after a failed boot", async () => {
    expect(await connectBridgeIfEnabled()).toBe(false); // first attempt (env off)
    expect(await connectBridgeIfEnabled()).toBe(false); // guarded: once per session
    const retried = await retryBridgeBoot(); // resets the guard and re-attempts
    expect(retried).toBe(false); // env still off → honest fallback stays
    expect(getOperationsState().sourceMode).toBe("fixture");
  });

  it("records bootAttempted in the REACTIVE store even on the fixture-fallback path", async () => {
    expect(getOperationsState().bootAttempted).toBe(false); // reset in beforeEach → never tried yet
    expect(await connectBridgeIfEnabled()).toBe(false); // env off → fixture fallback (no adopt, no other store change)
    // The boot-attempted flag still reaches reactive state, so the DEV panel re-renders (no stale "아니오").
    expect(getOperationsState().bootAttempted).toBe(true);
    expect(getOperationsState().sourceMode).toBe("fixture");
  });
});
