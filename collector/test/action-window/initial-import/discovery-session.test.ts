/**
 * The range-discovery run, end to end over a v2 loopback.
 *
 * This is the run that creates the plan, so its two failure modes are the expensive ones: reporting a range
 * nobody established, and recording a range the seller chose as though SellerOps had measured it. Both are
 * pinned here, alongside the sequencing.
 */
import { describe, expect, it } from "vitest";
import { createLoopbackChannel } from "../../../../contracts/action-window/v2/transport";
import { assembleDiscoveryRun } from "../../../src/action-window/initial-import/import-dispatch";
import { ImportFixtureDriver } from "../../../src/action-window/initial-import/import-fixture-driver";
import { makeDiscoveryClock } from "../../../src/action-window/initial-import/discovery-engine";
import { DISCOVERY_TOTAL_STEPS } from "../../../src/action-window/initial-import/discovery-stages";
import type { ActionWindowRunView, CommandType, EventEnvelope } from "../../../../contracts/action-window/v2/index";
import type { ImportFixtureScript } from "../../../src/action-window/initial-import/import-fixture-driver";

const REF = "9f2a1c7b4e6d0835";

function harness(script: ImportFixtureScript = {}) {
  const channel = createLoopbackChannel();
  const driver = new ImportFixtureDriver(script);
  const assembly = assembleDiscoveryRun(channel.server, {
    runId: "run_d15c0000",
    channelCode: "naver",
    discoveryRef: REF,
    driver,
    clock: makeDiscoveryClock(),
  });
  assembly.session.attach();

  const views: ActionWindowRunView[] = [];
  const events: EventEnvelope[] = [];
  channel.client.subscribe((frame) => {
    if (frame.kind === "aw_view") views.push(frame.view);
    if (frame.kind === "aw_event") events.push(frame.event);
  });

  let commandNo = 0;
  const send = (type: CommandType, payload?: Record<string, unknown>): void => {
    commandNo += 1;
    channel.client.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: `c${commandNo}`,
        runId: "run_d15c0000",
        expectedRevision: views.at(-1)?.revision ?? 0,
        type,
        ...(payload ? { payload: payload as never } : {}),
      },
    });
  };

  const start = async (): Promise<void> => {
    send("START_RUN", { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef: REF });
    await assembly.session.whenSettled();
  };

  return { channel, driver, assembly, views, events, send, start, last: () => views.at(-1)! };
}

describe("range discovery — the operator-confirmed path", () => {
  /** The live NAVER surface declares no bounds, so this is the path a real run takes. */
  it("guides both date controls, reads the selection back, and reports it as OPERATOR_CONFIRMED", async () => {
    const h = harness({ selectedRange: { start: "2023-08-01", end: "2026-07-25" } });
    await h.start();

    expect(h.driver.calls).toEqual([
      "prepareSurface",
      "readRangeControls",
      "locate:start_date",
      "highlight:start_date",
      "observe:start_date",
      "wait:start_date",
      "locate:end_date",
      "highlight:end_date",
      "observe:end_date",
      "wait:end_date",
      "readSelectedRange",
      "reportRange:OPERATOR_CONFIRMED:2023-08-01..2026-07-25",
      "cleanup",
    ]);
    expect(h.last().status).toBe("COMPLETED");
    expect(h.assembly.engine.recordedEvidence()).toBe("OPERATOR_CONFIRMED");
  });

  it("never performs a marketplace action — no date is set, applied or submitted for the seller", async () => {
    const h = harness();
    await h.start();
    for (const forbidden of ["click", "type", "fill", "apply_range", "export", "consent"]) {
      expect(h.driver.calls.some((c) => c.includes(forbidden)), forbidden).toBe(false);
    }
  });

  it("keeps totalSteps fixed at five for the whole run", async () => {
    const h = harness();
    await h.start();
    const totals = new Set(h.views.map((v) => v.currentStep?.totalSteps));
    expect([...totals]).toEqual([DISCOVERY_TOTAL_STEPS]);
  });

  it("puts no date on the wire — not in a view, not in an event", async () => {
    const h = harness({ selectedRange: { start: "2023-08-01", end: "2026-07-25" } });
    await h.start();
    const wire = JSON.stringify({ views: h.views, events: h.events });
    expect(wire).not.toContain("2023-08-01");
    expect(wire).not.toContain("2026-07-25");
  });

  it("never puts the discovery ref on the wire", async () => {
    const h = harness();
    await h.start();
    expect(JSON.stringify({ views: h.views, events: h.events })).not.toContain(REF);
  });
});

describe("range discovery — the machine-read path", () => {
  it("skips both seller barriers and records MACHINE_DISCOVERED", async () => {
    const h = harness({
      bounds: { minAttrs: ["2022-05-01"], maxAttrs: ["2026-07-25"], noticeTexts: [] },
    });
    await h.start();

    expect(h.driver.calls).toEqual([
      "prepareSurface",
      "readRangeControls",
      "reportRange:MACHINE_DISCOVERED:2022-05-01..2026-07-25",
      "cleanup",
    ]);
    expect(h.assembly.engine.recordedEvidence()).toBe("MACHINE_DISCOVERED");
    expect(h.last().status).toBe("COMPLETED");
  });

  /**
   * SKIPPED, not removed. A four-step plan on this path and a six-step plan on the other would move
   * `totalSteps` the instant the bounds read answers — mid-run, under the frontend.
   */
  it("reports the two unused barrier steps as SKIPPED", async () => {
    const h = harness({ bounds: { minAttrs: ["2022-05-01"], maxAttrs: ["2026-07-25"], noticeTexts: [] } });
    await h.start();
    const skipped = h.events.filter((e) => e.payload.stepStatus === "SKIPPED").map((e) => e.payload.stepId);
    expect(skipped).toEqual(["aw.import_discovery_set_earliest", "aw.import_discovery_set_latest"]);
  });

  /** A half-known range is not a range: with only a `min` the end would have to be invented. */
  it("falls back to guiding the seller when only one bound is declared", async () => {
    const h = harness({ bounds: { minAttrs: ["2022-05-01"], maxAttrs: [], noticeTexts: [] } });
    await h.start();
    expect(h.driver.calls).toContain("locate:start_date");
    expect(h.assembly.engine.recordedEvidence()).toBe("OPERATOR_CONFIRMED");
  });
});

describe("range discovery — fail closed", () => {
  /** No guessed depth. A plausible start date would be indistinguishable downstream from a measured one. */
  it("fails rather than report a range when the selection is unreadable", async () => {
    const h = harness({ selectedRange: null });
    await h.start();

    expect(h.driver.calls.some((c) => c.startsWith("reportRange"))).toBe(false);
    expect(h.last().status).toBe("FAILED");
    expect(h.last().blocker?.code).toBe("UNSUPPORTED_STATE");
    expect(h.assembly.engine.establishedRange()).toBeNull();
  });

  it("fails when the server refuses the range, instead of claiming a plan exists", async () => {
    const h = harness({ reportOk: false });
    await h.start();
    expect(h.last().status).toBe("FAILED");
    expect(h.last().blocker?.code).toBe("INGEST_FAILED");
  });

  it("fails closed when a date control cannot be located", async () => {
    const h = harness({ locate: { start_date: { count: 0 } } });
    await h.start();
    expect(h.last().status).toBe("FAILED");
    expect(h.last().blocker?.code).toBe("TARGET_NOT_FOUND");
  });

  it("fails closed when the date controls are ambiguous", async () => {
    const h = harness({ locate: { end_date: { count: 3 } } });
    await h.start();
    expect(h.last().status).toBe("FAILED");
    expect(h.last().blocker?.code).toBe("TARGET_AMBIGUOUS");
  });

  /** The anti-drift rule: a unique match that moved between locate and highlight is not annotated. */
  it("fails closed when the match drifts between locate and highlight", async () => {
    const h = harness({ highlight: { start_date: { count: 1, sig: "ffffffffffffffff" } } });
    await h.start();
    expect(h.last().status).toBe("FAILED");
    expect(h.last().blocker?.code).toBe("TARGET_NOT_FOUND");
  });

  it("reports an unusable surface as recoverable when the seller can clear it themselves", async () => {
    const h = harness({ surface: { ok: false, blockerCode: "LOGIN_REQUIRED" } });
    await h.start();
    expect(h.last().blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
  });

  it("refuses a malformed ref at construction, before the seller does anything", () => {
    const channel = createLoopbackChannel();
    expect(() =>
      assembleDiscoveryRun(channel.server, {
        runId: "run_d15c0000",
        channelCode: "naver",
        discoveryRef: "NOT-HEX",
        driver: new ImportFixtureDriver(),
      }),
    ).toThrow(/16 lowercase hex/);
  });
});

describe("range discovery — barriers", () => {
  /**
   * A human barrier has no deadline that kills the run. Scrolling a calendar back through years of months is
   * exactly what this run asks for, and an expired observation window means "not yet", not "they refused".
   */
  it("re-arms an expired observation window instead of stranding the run", async () => {
    let attempts = 0;
    const driver = new ImportFixtureDriver();
    const originalWait = driver.waitForTargetAction.bind(driver);
    driver.waitForTargetAction = async (target) => {
      if (target === "start_date") {
        attempts += 1;
        if (attempts < 3) return false;
      }
      return originalWait(target);
    };
    const channel = createLoopbackChannel();
    const assembly = assembleDiscoveryRun(channel.server, {
      runId: "run_d15c0000",
      channelCode: "naver",
      discoveryRef: REF,
      driver,
      clock: makeDiscoveryClock(),
    });
    assembly.session.attach();
    channel.client.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: "c1",
        runId: "run_d15c0000",
        expectedRevision: 0,
        type: "START_RUN",
        payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef: REF },
      },
    });
    // Bounded wait: three attempts at the 250ms re-arm floor, plus the rest of the chain.
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 50));
    await assembly.session.whenSettled();

    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(assembly.engine.currentStage()).toBe("COMPLETED");
  });

  it("offers the recheck and the manual escape only while resting on the seller", async () => {
    const h = harness({ action: { start_date: false } });
    h.send("START_RUN", { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef: REF });
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    const atBarrier = h.views.find((v) => v.status === "WAITING_FOR_HUMAN");
    expect(atBarrier?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(atBarrier?.allowedCommands).toContain("SWITCH_TO_MANUAL");
    // Nothing that would set a date, apply a range, or create a plan on the client's word.
    expect(atBarrier?.allowedCommands).not.toContain("START_RUN");
  });

  it("a completed run offers no commands at all", async () => {
    const h = harness();
    await h.start();
    expect(h.last().allowedCommands).toEqual([]);
  });
});
