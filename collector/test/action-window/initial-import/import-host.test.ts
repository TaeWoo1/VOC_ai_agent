/**
 * The host is the piece that makes an onboarding import a SEQUENCE, and it is where the launch ref is
 * handled. Both properties are security-relevant, so both are pinned here.
 */
import { describe, expect, it, vi } from "vitest";
import { InitialImportEndpoint } from "../../../src/bridge/initial-import-endpoint";
import { ImportSegmentHost, importRefFromStartRun, type ResolvedLaunchScope } from "../../../src/action-window/initial-import/import-host";
import { ImportFixtureDriver } from "../../../src/action-window/initial-import/import-fixture-driver";
import { clearLogSink, getLogSink } from "../../../src/log";
import type { AwClientFrame } from "../../../../contracts/action-window/v2/transport";

const REF_A = "9f2a1c7b4e6d0835";
const REF_B = "1122334455667788";

function scope(overrides: Partial<ResolvedLaunchScope> = {}): ResolvedLaunchScope {
  return {
    kind: "SEGMENT",
    channelCode: "naver",
    requiredStart: "2026-01-01",
    requiredEnd: "2026-01-31",
    ...overrides,
  };
}

function startRun(importRef: string, extra: Record<string, unknown> = {}): AwClientFrame {
  return {
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: "c1",
      runId: "run_announce",
      expectedRevision: 0,
      type: "START_RUN",
      payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef, ...extra },
    },
  } as AwClientFrame;
}

function build(resolve: (ref: string) => Promise<ResolvedLaunchScope | null>) {
  const endpoint = new InitialImportEndpoint({ runId: "run_announce", channelCode: "naver" });
  const driver = new ImportFixtureDriver();
  const host = new ImportSegmentHost({
    endpoint,
    channelCode: "naver",
    resolveScope: resolve,
    driver,
  });
  host.attach();
  return { endpoint, driver, host };
}

/** Let the host's async resolve + the session's drive chain settle. */
async function settle(host: ImportSegmentHost) {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  await host.activeSession()?.whenSettled();
}

describe("launch ref extraction", () => {
  it("reads a well-formed import ref", () => {
    expect(importRefFromStartRun(startRun(REF_A))).toBe(REF_A);
  });

  it("ignores anything that is not a START_RUN", () => {
    expect(importRefFromStartRun({ kind: "aw_resync", runId: "r", sinceSequence: 0 })).toBeNull();
  });

  it("refuses a malformed ref rather than passing it through", () => {
    expect(importRefFromStartRun(startRun("not-hex"))).toBeNull();
    expect(importRefFromStartRun(startRun("9F2A1C7B4E6D0835"))).toBeNull();
  });

  /** A reply or discovery ref on the import carrier is a wiring bug, not something to accommodate. */
  it("refuses a start whose intent is not the segment import", () => {
    const frame = startRun(REF_A, { intent: "REPLY_SUBMISSION" });
    expect(importRefFromStartRun(frame)).toBeNull();
  });

  it("reads only importRef, never a neighbouring binding", () => {
    const frame = {
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: "c1",
        runId: "r",
        expectedRevision: 0,
        type: "START_RUN",
        payload: { channelCode: "naver", submissionRef: REF_B, discoveryRef: REF_B },
      },
    } as AwClientFrame;
    expect(importRefFromStartRun(frame)).toBeNull();
  });
});

describe("import segment host", () => {
  it("resolves the scope from the SERVER and hosts a run with a runtime-minted identity", async () => {
    const resolve = vi.fn(async () => scope());
    const { endpoint, host } = build(resolve);

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(resolve).toHaveBeenCalledWith(REF_A);
    expect(host.activeSession()).not.toBeNull();
    // The announced identity is the runtime's, not the placeholder the client addressed.
    expect(endpoint.hostedRunId()).toMatch(/^run_[0-9a-f]{12}$/);
    expect(endpoint.hostedRunId()).not.toBe("run_announce");
  });

  /** The client sent START_RUN once; it must not have to send it twice because we built a session first. */
  it("replays the triggering command so the run actually starts", async () => {
    const { endpoint, host, driver } = build(async () => scope());

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(driver.calls).toContain("prepareSurface");
    expect(driver.calls).toContain("ingest:a1b2c3d4e5f60718");
  });

  it("hosts the NEXT segment without a restart, on a fresh identity", async () => {
    const { endpoint, host } = build(async () => scope());

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    const first = endpoint.hostedRunId();

    endpoint.replayClientFrame(startRun(REF_B));
    await settle(host);
    const second = endpoint.hostedRunId();

    expect(second).not.toBe(first);
    expect(second).toMatch(/^run_[0-9a-f]{12}$/);
  });

  /** One authorization, one run. Rebuilding would mint a second identity for the same ticket. */
  it("treats a replayed START_RUN for the hosted ref as idempotent", async () => {
    const resolve = vi.fn(async () => scope());
    const { endpoint, host } = build(resolve);

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    const runId = endpoint.hostedRunId();

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(endpoint.hostedRunId()).toBe(runId);
  });

  /**
   * Spent, expired, wrong org, never existed — all one answer. A client that could tell them apart could
   * probe the ref space.
   */
  it("hosts nothing when the server refuses the ref", async () => {
    const { endpoint, host, driver } = build(async () => null);

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).toBeNull();
    expect(driver.calls).toEqual([]);
    expect(endpoint.hostedRunId()).toBe("run_announce");
  });

  /** A discovery ticket is not a segment run — guiding a window nobody planned is worse than refusing. */
  it("refuses to host a discovery ticket as a segment", async () => {
    const { endpoint, host, driver } = build(async () => scope({ kind: "DISCOVERY" }));

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).toBeNull();
    expect(driver.calls).toEqual([]);
  });

  it("survives a resolve that throws, so the seller can retry", async () => {
    const { endpoint, host } = build(async () => {
      throw new Error("backend down");
    });

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    expect(host.activeSession()).toBeNull();

    // Still listening — a dead host would look like an agent that is not running at all.
    const { endpoint: e2, host: h2 } = build(async () => scope());
    e2.replayClientFrame(startRun(REF_A));
    await settle(h2);
    expect(h2.activeSession()).not.toBeNull();
  });

  it("uses the window the server gave, never one from the client", async () => {
    const { endpoint, host, driver } = build(async () => scope({ requiredStart: "2026-03-01", requiredEnd: "2026-03-31" }));

    endpoint.replayClientFrame(
      // A client trying to widen its own scope.
      startRun(REF_A, { requiredStart: "2020-01-01", requiredEnd: "2030-12-31" }),
    );
    await settle(host);

    expect(driver.calls).toContain("scope:2026-03-01..2026-03-31");
    expect(driver.calls.some((c) => c.includes("2020-01-01"))).toBe(false);
  });

  /** A launch ref authorizes an ingest, so it is treated like a credential. */
  it("never logs the launch ref or the required window", async () => {
    clearLogSink();
    const { endpoint, host } = build(async () => scope());

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    const logged = JSON.stringify(getLogSink());
    expect(logged).not.toContain(REF_A);
    expect(logged).not.toContain("2026-01-01");
    expect(logged).not.toContain("2026-01-31");
    clearLogSink();
  });

  it("stops listening after close", async () => {
    const resolve = vi.fn(async () => scope());
    const { endpoint, host } = build(resolve);
    await host.close();

    endpoint.replayClientFrame(startRun(REF_A));
    await new Promise((r) => setTimeout(r, 0));
    expect(resolve).not.toHaveBeenCalled();
  });
});
