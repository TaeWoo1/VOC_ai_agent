/**
 * Cross-stack, FE-FREE: the REAL import runtime (engine + session + transport) runs a segment, and the
 * LangGraph shadow — connected only through the journey ports — observes it live to divergence 0. No React is
 * imported, nothing is rendered, and the browser is stood in by the offline fixture driver.
 *
 * Also proves the Agent-first boundary: a segment already started keeps running when the projection consumer
 * (the "FE tab") detaches. The runtime drives the run; the FE only watches.
 */
import { describe, expect, it } from "vitest";
import { createLoopbackChannel } from "../../../contracts/action-window/v2/transport";
import { ImportSegmentEngine, makeImportClock } from "../../src/action-window/initial-import/import-engine";
import { ImportFixtureDriver, type ImportFixtureScript } from "../../src/action-window/initial-import/import-fixture-driver";
import { ImportSegmentSession } from "../../src/action-window/initial-import/import-session";
import { JourneyShadow } from "../../src/action-window/initial-import/journey-shadow";
import { TransportJourneyCommandPort, connectTransportViewsToPort } from "../../src/action-window/initial-import/journey-live";

const RUN_ID = "run_import01";
const REF = "9f2a1c7b4e6d0835";
const REQUIRED = { start: "2026-01-01", end: "2026-01-31" };

function buildRuntime(script: ImportFixtureScript = {}) {
  const { client, server } = createLoopbackChannel();
  const engine = new ImportSegmentEngine(
    { runId: RUN_ID, channelCode: "naver", importRef: REF, required: REQUIRED },
    { clock: makeImportClock() },
  );
  const driver = new ImportFixtureDriver(script);
  const session = new ImportSegmentSession(engine, driver, server, REQUIRED);
  session.attach();
  return { client, engine, driver, session };
}

describe("cross-stack: LangGraph shadow observes the REAL import runtime, with no FE", () => {
  it("runs a segment start → running → completion and stays at divergence 0", async () => {
    const { client, engine, session } = buildRuntime();

    // The shadow connects ONLY through the ports: it starts at UNOBSERVED_EXTERNAL (it did not witness
    // auth/account/plan) and reads the same views the FE would.
    const shadow = new JourneyShadow("live-headless", "UNOBSERVED_EXTERNAL");
    connectTransportViewsToPort(client, shadow);

    // A headless command adapter starts the segment — no React, no rendered card.
    const commands = new TransportJourneyCommandPort(client);
    commands.send({ kind: "START_SEGMENT", runId: RUN_ID, launchRef: REF, channelCode: "naver" });
    await session.whenSettled();
    await shadow.whenIdle(); // drain the observations the run streamed while it ran

    expect(engine.currentStage()).toBe("COMPLETED"); // the real runtime finished the segment
    expect(shadow.currentPhase()).toBe("SEGMENT_DONE"); // the shadow tracked it from the observable boundary
    expect(shadow.divergenceCount()).toBe(0); // real run status and shadow phase agreed at every step
  });

  it("keeps running a started segment after the projection consumer detaches (the FE tab closes)", async () => {
    const { client, engine, session } = buildRuntime();
    const shadow = new JourneyShadow("live-detach", "UNOBSERVED_EXTERNAL");
    const detach = connectTransportViewsToPort(client, shadow);

    const commands = new TransportJourneyCommandPort(client);
    commands.send({ kind: "START_SEGMENT", runId: RUN_ID, launchRef: REF, channelCode: "naver" });

    // The seller closes SellerOps mid-journey: the only view consumer unsubscribes. The run must not care.
    detach();
    await session.whenSettled();

    expect(engine.currentStage()).toBe("COMPLETED"); // the runtime drove the run to completion regardless
  });
});
