import { describe, expect, it } from "vitest";
import {
  EsmWorkerRuntime,
  type CandidateScanResult,
  type ContextLauncher,
  type OperationalStateSink,
  type ScheduledBetaPolicy,
  type SessionInspector,
  type SyntheticCycle,
  type SyntheticCycleOutcome,
  type WorkerContext,
} from "../../src/esm/esm-worker-runtime";
import {
  buildCandidateSignatureRecord,
  InMemoryCandidateSignatureStore,
  type CandidateShape,
} from "../../src/esm/esm-candidate-signature";
import type { ConnectorSyncState, SanitizedAccountRef } from "../../src/connection/sync-state";
import type { InspectionVerdict } from "../../src/esm/worker-session-state";

const SALT = "runtime-test-salt";
const NOW = "2026-07-02T00:00:00Z";

const ACCOUNT: SanitizedAccountRef = {
  connectionId: "conn-esm-0001",
  boundStoreFingerprintHash: "hash-store-abc",
  fingerprintSourceCategory: "account-scope",
};
const ACCOUNT_2: SanitizedAccountRef = { ...ACCOUNT, connectionId: "conn-esm-0002" };

const APPROVED_SHAPE: CandidateShape = {
  category: "export-like",
  actionable: true,
  scope: "allowlisted-frame",
  labelShape: { tokenCountBucket: "few", script: "hangul", hasExportWord: true },
};

// ── Injected fakes (no real browser anywhere) ─────────────────────────────────────────────────────

class FakeContext implements WorkerContext {
  closeCount = 0;
  constructor(readonly id: string) {}
  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class FakeLauncher implements ContextLauncher {
  count = 0;
  contexts: FakeContext[] = [];
  async launch(): Promise<WorkerContext> {
    this.count += 1;
    const ctx = new FakeContext(`ctx-${this.count}`);
    this.contexts.push(ctx);
    return ctx;
  }
}

class FakeInspector implements SessionInspector {
  standing: InspectionVerdict = "LOGGED_IN";
  queue: InspectionVerdict[] = [];
  calls = 0;
  contexts: string[] = [];
  async inspect(context: WorkerContext): Promise<InspectionVerdict> {
    this.calls += 1;
    this.contexts.push(context.id);
    return this.queue.length > 0 ? this.queue.shift()! : this.standing;
  }
}

class FakeScanner {
  calls = 0;
  contexts: string[] = [];
  result: CandidateScanResult;
  constructor(result: CandidateScanResult) {
    this.result = result;
  }
  async scan(context: WorkerContext): Promise<CandidateScanResult> {
    this.calls += 1;
    this.contexts.push(context.id);
    return this.result;
  }
}

class FakeCycle implements SyntheticCycle {
  calls = 0;
  contexts: string[] = [];
  outcome: SyntheticCycleOutcome = "SUCCESS";
  throwError = false;
  gate: Promise<void> | null = null;
  async run(context: WorkerContext): Promise<SyntheticCycleOutcome> {
    this.calls += 1;
    this.contexts.push(context.id);
    if (this.gate) await this.gate;
    if (this.throwError) throw new Error("synthetic cycle boom");
    return this.outcome;
  }
}

class FakeSink implements OperationalStateSink {
  states: ConnectorSyncState[] = [];
  async record(state: ConnectorSyncState): Promise<void> {
    this.states.push(state);
  }
}

class FakePolicy implements ScheduledBetaPolicy {
  optedIn = true;
  isOptedIn(): boolean {
    return this.optedIn;
  }
}

function defaultScan(): CandidateScanResult {
  return {
    actionableCount: "one",
    scope: "allowlisted-frame",
    consentLikePresent: false,
    candidate: { ...APPROVED_SHAPE, labelShape: { ...APPROVED_SHAPE.labelShape } },
  };
}

interface Harness {
  runtime: EsmWorkerRuntime;
  launcher: FakeLauncher;
  inspector: FakeInspector;
  scanner: FakeScanner;
  store: InMemoryCandidateSignatureStore;
  cycle: FakeCycle;
  sink: FakeSink;
  policy: FakePolicy;
}

/** Build a runtime wired to fakes. By default the approval record is pre-seeded (happy path). */
function makeHarness(opts: { seedApproval?: boolean; scan?: CandidateScanResult } = {}): Harness {
  const launcher = new FakeLauncher();
  const inspector = new FakeInspector();
  const scanner = new FakeScanner(opts.scan ?? defaultScan());
  const store = new InMemoryCandidateSignatureStore();
  const cycle = new FakeCycle();
  const sink = new FakeSink();
  const policy = new FakePolicy();
  if (opts.seedApproval !== false) {
    // Map is set synchronously by the in-memory adapter (no await needed).
    void store.save(buildCandidateSignatureRecord(APPROVED_SHAPE, ACCOUNT, SALT, "2026-07-01T00:00:00Z"));
    void store.save(buildCandidateSignatureRecord(APPROVED_SHAPE, ACCOUNT_2, SALT, "2026-07-01T00:00:00Z"));
  }
  const runtime = new EsmWorkerRuntime({
    launcher,
    inspector,
    scanner,
    signatureStore: store,
    cycle,
    operationalSink: sink,
    policy,
    salt: SALT,
  });
  return { runtime, launcher, inspector, scanner, store, cycle, sink, policy };
}

// ── Lifecycle & context-reuse ──────────────────────────────────────────────────────────────────

describe("esm-worker-runtime — lifecycle & context reuse", () => {
  it("(1,2,3) launches exactly one context per lifecycle and reuses the SAME context across ticks", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    const cid = h.runtime.getContextId(ACCOUNT);
    expect(cid).toBe("ctx-1");

    await h.runtime.tick(ACCOUNT, NOW);
    await h.runtime.tick(ACCOUNT, NOW);

    expect(h.launcher.count).toBe(1); // one launch for the whole lifecycle — no per-tick launch
    // The exact same context id reached inspection, scan, and the synthetic cycle every time.
    expect(new Set(h.inspector.contexts)).toEqual(new Set([cid]));
    expect(new Set(h.scanner.contexts)).toEqual(new Set([cid]));
    expect(new Set(h.cycle.contexts)).toEqual(new Set([cid]));
    expect(h.cycle.calls).toBe(2); // one cycle per successful tick
  });

  it("(4) startup LOGGED_IN → READY", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    const state = await h.runtime.start(ACCOUNT, NOW);
    expect(state).toBe("READY");
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
  });

  it("(5) startup non-LOGGED_IN → RECONNECT_REQUIRED and zero cycles", async () => {
    const h = makeHarness();
    h.inspector.standing = "NOT_LOGGED_IN";
    const state = await h.runtime.start(ACCOUNT, NOW);
    expect(state).toBe("RECONNECT_REQUIRED");
    // A tick while reconnect is required re-inspects, stays reconnect-required, runs no cycle.
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("RECONNECT_REQUIRED");
    expect(h.cycle.calls).toBe(0);
  });

  it("(19) explicit stop closes the injected context exactly once (second stop is a no-op)", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    const ctx = h.launcher.contexts[0]!;
    await h.runtime.stop(ACCOUNT);
    expect(ctx.closeCount).toBe(1);
    expect(h.runtime.getState(ACCOUNT)).toBeNull(); // lifecycle removed
    await h.runtime.stop(ACCOUNT); // no lifecycle → no-op
    expect(ctx.closeCount).toBe(1);
  });
});

// ── Restart ────────────────────────────────────────────────────────────────────────────────────

describe("esm-worker-runtime — restart is a new lifecycle, never inherits READY", () => {
  it("(6) restart closes the old context, launches a fresh one, and performs a fresh inspection", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    expect(h.runtime.getContextId(ACCOUNT)).toBe("ctx-1");
    const inspectionsBefore = h.inspector.calls;

    await h.runtime.restart(ACCOUNT, NOW);

    expect(h.launcher.count).toBe(2); // a NEW context for the new lifecycle
    expect(h.runtime.getContextId(ACCOUNT)).toBe("ctx-2");
    expect(h.launcher.contexts[0]!.closeCount).toBe(1); // old context closed once
    expect(h.inspector.calls).toBeGreaterThan(inspectionsBefore); // a fresh inspection ran
  });

  it("(7) restart cannot inherit READY — a NOT_LOGGED_IN re-inspection lands on RECONNECT_REQUIRED", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    expect(await h.runtime.start(ACCOUNT, NOW)).toBe("READY");

    // The session is lost across the restart: the fresh inspection returns NOT_LOGGED_IN.
    h.inspector.standing = "NOT_LOGGED_IN";
    const state = await h.runtime.restart(ACCOUNT, NOW);
    expect(state).toBe("RECONNECT_REQUIRED"); // NOT READY — no inheritance
  });
});

// ── Account single-flight ────────────────────────────────────────────────────────────────────────

describe("esm-worker-runtime — account single-flight", () => {
  it("(8,16,17) an overlapping same-account tick is SKIPPED_BUSY and runs no extra cycle", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);

    let release!: () => void;
    h.cycle.gate = new Promise<void>((r) => (release = r));

    const p1 = h.runtime.tick(ACCOUNT, NOW); // acquires the lock synchronously, then blocks in the cycle
    const overlap = await h.runtime.tick(ACCOUNT, NOW); // lock held → immediate skip
    // The overlapping tick is skipped outright: fixed busy disposition, no cycle outcome. (It reports the
    // lifecycle's current state — whatever phase p1 is in — which is not asserted here.)
    expect(overlap.disposition).toBe("SKIPPED_BUSY");
    expect(overlap.cycleOutcome).toBeNull();

    release();
    const r1 = await p1;
    expect(r1.disposition).toBe("SYNCED");
    expect(h.cycle.calls).toBe(1); // one tick → the cycle ran at most once; the overlap added none
  });

  it("(9) different accounts do not block each other", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    await h.runtime.start(ACCOUNT_2, NOW);
    const r1 = await h.runtime.tick(ACCOUNT, NOW);
    const r2 = await h.runtime.tick(ACCOUNT_2, NOW);
    expect(r1.disposition).toBe("SYNCED");
    expect(r2.disposition).toBe("SYNCED");
    expect(h.cycle.calls).toBe(2);
  });

  it("(10) the account lock is released even when the synthetic cycle throws", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    h.cycle.throwError = true;
    await expect(h.runtime.tick(ACCOUNT, NOW)).rejects.toThrow("synthetic cycle boom");

    // Lock released → the next tick is NOT reported as busy (it proceeds to inspect/gate).
    h.cycle.throwError = false;
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).not.toBe("SKIPPED_BUSY");
  });
});

// ── Candidate-signature gate ─────────────────────────────────────────────────────────────────────

describe("esm-worker-runtime — candidate-signature gate", () => {
  it("(11) an exact signature match allows exactly one synthetic cycle", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("SYNCED");
    expect(r.cycleOutcome).toBe("SUCCESS");
    expect(h.cycle.calls).toBe(1);
  });

  it("(12) a signature mismatch → UI_CHANGED and ZERO cycle calls", async () => {
    // The live candidate drifted (same actionable count, but a different label shape).
    const drifted = defaultScan();
    drifted.candidate = { ...APPROVED_SHAPE, labelShape: { ...APPROVED_SHAPE.labelShape, script: "latin" } };
    const h = makeHarness({ scan: drifted });
    await h.runtime.start(ACCOUNT, NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("UI_CHANGED");
    expect(r.state).toBe("UI_CHANGED");
    expect(h.cycle.calls).toBe(0);
  });

  it("(12b) a missing approval record → UI_CHANGED and ZERO cycle calls", async () => {
    const h = makeHarness({ seedApproval: false });
    await h.runtime.start(ACCOUNT, NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("UI_CHANGED");
    expect(h.cycle.calls).toBe(0);
  });

  it("(13) an actionable count that is not exactly one → UI_CHANGED and ZERO cycle calls", async () => {
    for (const count of ["zero", "many"] as const) {
      const scan = defaultScan();
      scan.actionableCount = count;
      scan.candidate = count === "zero" ? null : scan.candidate;
      const h = makeHarness({ scan });
      await h.runtime.start(ACCOUNT, NOW);
      const r = await h.runtime.tick(ACCOUNT, NOW);
      expect(r.disposition).toBe("UI_CHANGED");
      expect(h.cycle.calls).toBe(0);
    }
  });

  it("(13b) a wrong candidate scope → UI_CHANGED and ZERO cycle calls", async () => {
    const scan = defaultScan();
    scan.scope = "top-document";
    const h = makeHarness({ scan });
    await h.runtime.start(ACCOUNT, NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("UI_CHANGED");
    expect(h.cycle.calls).toBe(0);
  });

  it("(14) a consent-like candidate present → ZERO cycle calls", async () => {
    const scan = defaultScan();
    scan.consentLikePresent = true;
    const h = makeHarness({ scan });
    await h.runtime.start(ACCOUNT, NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("UI_CHANGED");
    expect(h.cycle.calls).toBe(0);
  });

  it("(15) a missing scheduled-beta opt-in → ZERO cycle calls (non-running result)", async () => {
    const h = makeHarness();
    h.policy.optedIn = false;
    await h.runtime.start(ACCOUNT, NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("NO_OPT_IN");
    expect(r.state).toBe("PAUSED");
    expect(h.cycle.calls).toBe(0);
  });
});

// ── Failure / retry / hard-stop ──────────────────────────────────────────────────────────────────

describe("esm-worker-runtime — failure, no auto-retry, hard stop", () => {
  it("(16,17) a download/upload failure runs the cycle once and triggers no automatic second export", async () => {
    for (const outcome of ["DOWNLOAD_FAILED", "UPLOAD_FAILED"] as const) {
      const h = makeHarness();
      h.cycle.outcome = outcome;
      await h.runtime.start(ACCOUNT, NOW);
      const r = await h.runtime.tick(ACCOUNT, NOW);
      expect(r.disposition).toBe("SYNCED");
      expect(r.cycleOutcome).toBe(outcome);
      expect(h.cycle.calls).toBe(1); // exactly one cycle for the tick — no auto-retry
    }
  });

  it("(18) a DELETE_FAILED outcome enters the 1.5A hard-stop state; subsequent ticks run no cycle", async () => {
    const h = makeHarness();
    h.cycle.outcome = "DELETE_FAILED";
    await h.runtime.start(ACCOUNT, NOW);

    const first = await h.runtime.tick(ACCOUNT, NOW);
    expect(first.cycleOutcome).toBe("DELETE_FAILED");
    expect(h.runtime.getState(ACCOUNT)).toBe("DELETE_FAILED");

    // Hard stop: the next tick cannot re-arm (inspection is rejected) and runs no cycle.
    const second = await h.runtime.tick(ACCOUNT, NOW);
    expect(second.disposition).toBe("NOT_READY");
    expect(second.state).toBe("DELETE_FAILED");
    expect(h.cycle.calls).toBe(1); // still just the one cycle
  });
});

// ── Operational integration & sanitization ───────────────────────────────────────────────────────

describe("esm-worker-runtime — operational integration never touches capability", () => {
  it("(21) a SUCCESS advances the snapshot anchor but leaves CapabilityStatus NEEDS_DISCOVERY", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    await h.runtime.tick(ACCOUNT, NOW);
    const op = h.runtime.getOperationalState(ACCOUNT)!;
    expect(op.syncStatus).toBe("SUCCEEDED");
    expect(op.lastSuccessfulSyncAt).not.toBeNull(); // snapshot anchor advanced
    expect(op.capabilityStatus).toBe("NEEDS_DISCOVERY"); // NEVER promoted
    // Every recorded sink state preserves NEEDS_DISCOVERY too.
    expect(h.sink.states.every((s) => s.capabilityStatus === "NEEDS_DISCOVERY")).toBe(true);
  });

  it("(21b) a PARTIAL preserves the prior good snapshot and never promotes capability", async () => {
    const h = makeHarness();
    h.cycle.outcome = "SUCCESS";
    await h.runtime.start(ACCOUNT, NOW);
    await h.runtime.tick(ACCOUNT, "2026-07-02T00:00:00Z");
    const goodAnchor = h.runtime.getOperationalState(ACCOUNT)!.lastSuccessfulSyncAt;

    // Re-arm, then a partial.
    h.cycle.outcome = "PARTIAL";
    await h.runtime.tick(ACCOUNT, "2026-07-02T03:00:00Z");
    const op = h.runtime.getOperationalState(ACCOUNT)!;
    expect(op.syncStatus).toBe("PARTIAL");
    expect(op.lastSuccessfulSyncAt).toBe(goodAnchor); // partial did NOT overwrite the good snapshot
    expect(op.capabilityStatus).toBe("NEEDS_DISCOVERY");
  });

  it("(20) emitted tick results contain only sanitized enums — no raw DOM/URL/path/token/row/header", async () => {
    const h = makeHarness();
    await h.runtime.start(ACCOUNT, NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);

    expect(Object.keys(r).sort()).toEqual(["cycleOutcome", "disposition", "state"]);
    const serialized = JSON.stringify(r);
    for (const raw of ["엑셀", "리뷰관리", "http", "://", "/download", ".xlsx", "리뷰글번호", "Bearer ", "SECRET"]) {
      expect(serialized.includes(raw)).toBe(false);
    }
    // The operational states handed to the sink likewise carry no raw marketplace strings.
    const opSerialized = JSON.stringify(h.sink.states);
    for (const raw of ["엑셀", "리뷰관리", "http", "/download", ".xlsx", "리뷰글번호", "Bearer "]) {
      expect(opSerialized.includes(raw)).toBe(false);
    }
  });
});
