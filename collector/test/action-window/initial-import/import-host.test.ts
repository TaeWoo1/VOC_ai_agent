/**
 * The host is the piece that makes an onboarding import a SEQUENCE, and it is where the launch ref is
 * handled. Both properties are security-relevant, so both are pinned here.
 */
import { describe, expect, it, vi } from "vitest";
import { InitialImportEndpoint } from "../../../src/bridge/initial-import-endpoint";
import {
  ImportSegmentHost,
  declaredImportKindFromStartRun,
  importRefFromStartRun,
  type ResolvedLaunchScope,
} from "../../../src/action-window/initial-import/import-host";
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

  /**
   * **A ticket for another marketplace is refused, not coerced.**
   *
   * Found on 2026-07-26 before it could happen live: the SellerOps import screen defaulted to whichever connected
   * account came first, which was a COUPANG one. A seller could have created a plan for that account and minted a
   * ticket against it, while the only driver present guides NAVER — and nothing downstream compared the two. The
   * run would have walked them through NAVER's own export and ingested the result into the Coupang plan's
   * segment: a file covering one marketplace recorded as covering another.
   *
   * The channel is a platform target, so an unexpected one fails closed. Nothing is assembled and the marketplace
   * surface is never touched.
   */
  it("refuses a ticket whose channel is not the one this agent drives", async () => {
    const { endpoint, host, driver } = build(async () => scope({ channelCode: "coupang" }));

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).toBeNull();
    expect(driver.calls).toEqual([]);
    // No re-announcement either: a refused ticket must not move the hosted run identity.
    expect(endpoint.hostedRunId()).toBe("run_announce");
  });

  /** An empty channel is the server declining to name one, and the agent's own channel still applies. */
  it("still hosts a scope that names no channel at all", async () => {
    const { endpoint, host } = build(async () => scope({ channelCode: "" }));

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).not.toBeNull();
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

  /**
   * ONE hosted session at a time.
   *
   * Every session subscribes to the endpoint, and the host used to drop its reference without releasing that
   * subscription — so in a real sitting (discovery, then segment after segment) every finished run stayed
   * attached, answering commands and publishing its own views. A frontend part-way through segment two would
   * receive interleaved state from segment one, with whichever run had the higher revision winning.
   */
  it("releases the previous run's subscription when it hosts the next one", async () => {
    const { endpoint, host } = build(async () => scope());
    // The host's own listener, before any run exists.
    const baseline = endpoint.runtimeListenerCount();

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    const first = host.activeSession();
    expect(endpoint.runtimeListenerCount()).toBe(baseline + 1);

    endpoint.replayClientFrame(startRun(REF_B));
    await settle(host);

    expect(host.activeSession()).not.toBe(first);
    // Still exactly one hosted session — not two runs publishing over each other.
    expect(endpoint.runtimeListenerCount()).toBe(baseline + 1);
  });

  it("hosts nothing at all after close, and leaves no session attached", async () => {
    const { endpoint, host } = build(async () => scope());
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);
    expect(host.activeSession()).not.toBeNull();

    await host.close();
    expect(host.activeSession()).toBeNull();
  });
});

/* ────────────────────────── the discovery run kind ────────────────────────── */

function discoveryStartRun(discoveryRef: string): AwClientFrame {
  return {
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: "c1",
      runId: "run_announce",
      expectedRevision: 0,
      type: "START_RUN",
      payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef },
    },
  } as AwClientFrame;
}

const DISCOVERY_SCOPE: ResolvedLaunchScope = {
  kind: "DISCOVERY",
  channelCode: "naver",
  requiredStart: "",
  requiredEnd: "",
};

describe("launch ref extraction — discovery", () => {
  it("reads a discovery ref when the intent says discovery", () => {
    expect(importRefFromStartRun(discoveryStartRun(REF_A))).toBe(REF_A);
  });

  it("refuses a segment intent carrying only a discovery ref", () => {
    const frame = startRun(REF_A) as { command: { payload: Record<string, unknown> } };
    delete frame.command.payload.importRef;
    frame.command.payload.discoveryRef = REF_A;
    expect(importRefFromStartRun(frame as unknown as AwClientFrame)).toBeNull();
  });

  /** A caller presenting both does not know which run it is starting; picking one would be a guess. */
  it("refuses a start carrying both import and discovery refs", () => {
    expect(importRefFromStartRun(startRun(REF_A, { discoveryRef: REF_B }))).toBeNull();
  });

  it("reports the declared kind, for cross-checking only", () => {
    expect(declaredImportKindFromStartRun(discoveryStartRun(REF_A))).toBe("DISCOVERY");
    expect(declaredImportKindFromStartRun(startRun(REF_A))).toBe("SEGMENT");
    expect(declaredImportKindFromStartRun({ kind: "aw_resync", runId: "r", sinceSequence: 0 })).toBeNull();
  });
});

/*
 * A `DISCOVERY` ticket is no longer hostable (2026-07-26). How far back to import is the seller's own choice,
 * made in SellerOps before any marketplace window opens, so there is no run to host and nothing for the
 * runtime to drive. These tests pin the REFUSAL, because the ticket kind still exists server-side and an
 * agent that quietly hosted something for it would be guiding a choreography that no longer exists.
 */
describe("import host — a discovery ticket is refused", () => {
  it("hosts nothing and touches no driver when the server reports a DISCOVERY ticket", async () => {
    const resolve = vi.fn(async () => DISCOVERY_SCOPE);
    const { endpoint, host, driver } = build(resolve);

    endpoint.replayClientFrame(discoveryStartRun(REF_A));
    await settle(host);

    expect(resolve).toHaveBeenCalledWith(REF_A);
    expect(host.activeSession()).toBeNull();
    // Nothing was located, highlighted or observed — the refusal happens before the surface is touched.
    expect(driver.calls).toEqual([]);
    // And the announced identity is unchanged: no run was minted for work that cannot be hosted.
    expect(endpoint.hostedRunId()).toBe("run_announce");
  });

  /** The client declared one kind and holds the other's ticket. Neither answer is safe. */
  it("refuses when the declared intent disagrees with the server's kind", async () => {
    const { endpoint, host, driver } = build(async () => DISCOVERY_SCOPE);

    // Declares SEGMENT, presents a ticket the server says is a DISCOVERY one.
    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).toBeNull();
    expect(driver.calls).toEqual([]);
  });

  it("never logs the refused ref", async () => {
    clearLogSink();
    const { endpoint, host } = build(async () => DISCOVERY_SCOPE);

    endpoint.replayClientFrame(discoveryStartRun(REF_A));
    await settle(host);

    expect(JSON.stringify(getLogSink())).not.toContain(REF_A);
    clearLogSink();
  });

  it("refuses a segment scope with no window", async () => {
    const { endpoint, host, driver } = build(async () => scope({ requiredStart: "", requiredEnd: "" }));

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).toBeNull();
    expect(driver.calls).toEqual([]);
  });

  it("refuses an unrecognised kind rather than guess a choreography", async () => {
    const { endpoint, host, driver } = build(async () => scope({ kind: "SOMETHING_NEW" }));

    endpoint.replayClientFrame(startRun(REF_A));
    await settle(host);

    expect(host.activeSession()).toBeNull();
    expect(driver.calls).toEqual([]);
  });

});
