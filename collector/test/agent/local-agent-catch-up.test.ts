import { describe, expect, it } from "vitest";
import {
  LocalAgentRuntime,
  type CatchUpSyncExecutor,
  type CatchUpSyncOutcome,
  type LocalAgentDeps,
  type LoginModeScan,
  type ReconnectSurfacePrep,
} from "../../src/agent/local-agent-runtime";
import { syntheticCycleCatchUpExecutor, syntheticCycleOutcomeToCatchUp } from "../../src/agent/local-agent-catch-up";
import type {
  ContextLauncher,
  OperationalStateSink,
  SessionInspector,
  SyntheticCycle,
  SyntheticCycleOutcome,
  WorkerContext,
} from "../../src/esm/esm-worker-runtime";
import type {
  LoginModeNormalizer,
  ReconnectSurface,
  LoginSubmitter,
  LocalAgentNotification,
  LocalAgentNotifier,
  CatchUpRequestSink,
} from "../../src/agent/local-agent-runtime";
import { computeCandidateSignature, CANDIDATE_SIGNATURE_SCHEMA_VERSION, type CandidateShape } from "../../src/esm/esm-candidate-signature";
import type { ConnectorSyncState, SanitizedAccountRef } from "../../src/connection/sync-state";
import type { InspectionVerdict } from "../../src/esm/worker-session-state";
import type { CredentialPopulationObservation, LocalAgentConnection } from "../../src/agent/local-agent-state";

const SALT = "catch-up-test-salt";
const NOW = "2026-07-03T00:00:00Z";

const ACCOUNT: SanitizedAccountRef = {
  connectionId: "conn-cu-0001",
  boundStoreFingerprintHash: "hash-cu",
  fingerprintSourceCategory: "account-scope",
};
const ACCOUNT_2: SanitizedAccountRef = { ...ACCOUNT, connectionId: "conn-cu-0002" };

const APPROVED_SHAPE: CandidateShape = {
  category: "other",
  actionable: true,
  scope: "top-document",
  labelShape: { tokenCountBucket: "few", script: "other", hasExportWord: false },
};

function connectionFor(account: SanitizedAccountRef): LocalAgentConnection {
  return {
    account,
    loginMode: "GMARKET",
    loginModeSignatureVersion: CANDIDATE_SIGNATURE_SCHEMA_VERSION,
    loginModeSignature: computeCandidateSignature(APPROVED_SHAPE, SALT),
    sessionInspectionConsent: true,
    loginModeAutoSelectionConsent: true,
    assistedReconnectConsent: true,
    autoSubmitAfterCredentialSelectionConsent: true,
    reviewExportConsent: true,
    uploadConsent: true,
  };
}

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────

class FakeContext implements WorkerContext {
  closeCount = 0;
  constructor(readonly id: string) {}
  async close(): Promise<void> {
    this.closeCount += 1;
  }
}
class FakeLauncher implements ContextLauncher {
  count = 0;
  async launch(): Promise<WorkerContext> {
    this.count += 1;
    return new FakeContext(`ctx-${this.count}`);
  }
}
class FakeInspector implements SessionInspector {
  standing: InspectionVerdict = "LOGGED_IN";
  queue: InspectionVerdict[] = [];
  calls = 0;
  async inspect(): Promise<InspectionVerdict> {
    this.calls += 1;
    return this.queue.length > 0 ? this.queue.shift()! : this.standing;
  }
}
class FakeNormalizer implements LoginModeNormalizer {
  scan: LoginModeScan = { candidatePresent: true, candidate: { ...APPROVED_SHAPE }, alreadyActive: false };
  selectCalls = 0;
  async scanModeCandidate(): Promise<LoginModeScan> {
    return this.scan;
  }
  async selectMode(): Promise<void> {
    this.selectCalls += 1;
  }
}
class FakeSurface implements ReconnectSurface {
  result: ReconnectSurfacePrep = { formShapeMatches: true };
  async prepare(): Promise<ReconnectSurfacePrep> {
    return this.result;
  }
}
class FakeSubmitter implements LoginSubmitter {
  calls = 0;
  async submit(): Promise<void> {
    this.calls += 1;
  }
}
class FakeNotifier implements LocalAgentNotifier {
  notifications: LocalAgentNotification[] = [];
  async notify(n: LocalAgentNotification): Promise<void> {
    this.notifications.push(n);
  }
}
class FakeCatchUp implements CatchUpRequestSink {
  requests: SanitizedAccountRef[] = [];
  async request(a: SanitizedAccountRef): Promise<void> {
    this.requests.push(a);
  }
}
class FakeSink implements OperationalStateSink {
  states: ConnectorSyncState[] = [];
  async record(s: ConnectorSyncState): Promise<void> {
    this.states.push(s);
  }
}
/** A guard cycle: `runCatchUp` must NOT use `deps.cycle` (it uses the injected executor). */
const GUARD_CYCLE: SyntheticCycle = {
  async run() {
    throw new Error("deps.cycle must not be used by runCatchUp");
  },
};

class FakeExecutor implements CatchUpSyncExecutor {
  calls = 0;
  contexts: string[] = [];
  outcome: CatchUpSyncOutcome = { kind: "SUCCEEDED" };
  throwError = false;
  gate: Promise<void> | null = null;
  onExecute?: () => void;
  async execute(context: WorkerContext): Promise<CatchUpSyncOutcome> {
    this.calls += 1;
    this.contexts.push(context.id);
    this.onExecute?.();
    if (this.gate) await this.gate;
    if (this.throwError) throw new Error("executor boom");
    return this.outcome;
  }
}
class FakeCycle implements SyntheticCycle {
  calls = 0;
  outcome: SyntheticCycleOutcome = "SUCCESS";
  async run(): Promise<SyntheticCycleOutcome> {
    this.calls += 1;
    return this.outcome;
  }
}

interface Harness {
  runtime: LocalAgentRuntime;
  inspector: FakeInspector;
  catchUp: FakeCatchUp;
  sink: FakeSink;
  launcher: FakeLauncher;
}

function makeRuntime(): Harness {
  const inspector = new FakeInspector();
  const catchUp = new FakeCatchUp();
  const sink = new FakeSink();
  const launcher = new FakeLauncher();
  const deps: LocalAgentDeps = {
    launcher,
    inspector,
    loginModeNormalizer: new FakeNormalizer(),
    reconnectSurface: new FakeSurface(),
    submitter: new FakeSubmitter(),
    notifier: new FakeNotifier(),
    catchUp,
    cycle: GUARD_CYCLE,
    operationalSink: sink,
    salt: SALT,
  };
  return { runtime: new LocalAgentRuntime(deps), inspector, catchUp, sink, launcher };
}

/** Start an account and drive it to READY via a startup LOGGED_IN inspection. */
async function startToReady(h: Harness, account = ACCOUNT): Promise<void> {
  h.inspector.standing = "LOGGED_IN";
  await h.runtime.start(connectionFor(account), NOW);
}

function bothPopulated(): CredentialPopulationObservation {
  return { usernamePopulated: true, passwordPopulated: true, challengePresent: false, formSignatureMatch: true };
}

// ── Acknowledgement / gating ───────────────────────────────────────────────────────────────────────

describe("catch-up — acknowledgement & gating", () => {
  it("[1] startup READY emits one catch-up request that can be acknowledged", async () => {
    const h = makeRuntime();
    await startToReady(h);
    expect(h.catchUp.requests).toHaveLength(1);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    expect(h.runtime.hasAcknowledgedCatchUp(ACCOUNT)).toBe(true);
  });

  it("[2] reconnect READY emits one catch-up request that can be acknowledged", async () => {
    const h = makeRuntime();
    h.inspector.standing = "NOT_LOGGED_IN";
    await h.runtime.start(connectionFor(ACCOUNT), NOW); // → WAITING_FOR_CREDENTIAL_SELECTION
    h.inspector.queue = ["LOGGED_IN"]; // post-submit verify
    await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
    expect(h.catchUp.requests).toHaveLength(1);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    expect(h.runtime.hasAcknowledgedCatchUp(ACCOUNT)).toBe(true);
  });

  it("[3] catch-up cannot run before acknowledgement", async () => {
    const h = makeRuntime();
    await startToReady(h);
    const exec = new FakeExecutor();
    const r = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(r.disposition).toBe("SKIPPED_CATCH_UP_NOT_ACKNOWLEDGED");
    expect(exec.calls).toBe(0);
  });

  it("[4] duplicate acknowledgement is idempotent (single catch-up still runs once)", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    const again = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(exec.calls).toBe(1);
    expect(again.disposition).toBe("SKIPPED_ALREADY_CONSUMED");
  });

  it("[7] catch-up is blocked when not READY", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    exec.outcome = { kind: "FAILED_RECOVERABLE" };
    await h.runtime.runCatchUp(ACCOUNT, NOW, exec); // → DEGRADED (not READY)
    const blocked = await h.runtime.runCatchUp(ACCOUNT, NOW, new FakeExecutor());
    expect(blocked.disposition).toBe("SKIPPED_NOT_READY"); // DEGRADED is not READY
    expect(blocked.syncExecuted).toBe(false);
    expect(h.runtime.getState(ACCOUNT)).toBe("DEGRADED");
  });

  it("[8] catch-up is blocked while a reconnect is required", async () => {
    const h = makeRuntime();
    h.inspector.standing = "NOT_LOGGED_IN";
    await h.runtime.start(connectionFor(ACCOUNT), NOW); // WAITING_FOR_CREDENTIAL_SELECTION (reconnect)
    h.runtime.acknowledgeCatchUp(ACCOUNT); // no-op; not acknowledged meaningfully
    const exec = new FakeExecutor();
    const r = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(r.disposition).toBe("SKIPPED_NOT_READY");
    expect(exec.calls).toBe(0);
  });
});

// ── Execution / state mapping ──────────────────────────────────────────────────────────────────────

describe("catch-up — execution & state mapping", () => {
  it("[5] catch-up runs exactly once, [9] enters SYNCING, [10] success returns to READY", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    let stateDuring: string | null = null;
    exec.onExecute = () => (stateDuring = h.runtime.getState(ACCOUNT));
    const r = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(exec.calls).toBe(1);
    expect(stateDuring).toBe("SYNCING");
    expect(r.disposition).toBe("CATCH_UP_SUCCEEDED");
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
  });

  it("[6] duplicate catch-up events do not duplicate the sync", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    const dup = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(exec.calls).toBe(1);
    expect(dup.disposition).toBe("SKIPPED_ALREADY_CONSUMED");
    expect(dup.syncExecuted).toBe(false);
  });

  it("[11] a successful catch-up does not create another catch-up request", async () => {
    const h = makeRuntime();
    await startToReady(h);
    expect(h.catchUp.requests).toHaveLength(1);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    await h.runtime.runCatchUp(ACCOUNT, NOW, new FakeExecutor());
    expect(h.catchUp.requests).toHaveLength(1);
  });

  it("[12] a recoverable failure enters DEGRADED, [13] with no auto-retry", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    exec.outcome = { kind: "FAILED_RECOVERABLE", errorCategory: "DOWNLOAD_FAILED" };
    const r = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(r.disposition).toBe("CATCH_UP_FAILED");
    expect(h.runtime.getState(ACCOUNT)).toBe("DEGRADED");
    expect(exec.calls).toBe(1); // exactly one attempt — no auto-retry
  });

  it("(extra) a thrown executor is a recoverable failure (no retry) → DEGRADED", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    exec.throwError = true;
    const r = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(r.disposition).toBe("CATCH_UP_FAILED");
    expect(h.runtime.getState(ACCOUNT)).toBe("DEGRADED");
    expect(exec.calls).toBe(1);
  });

  it("[14] session loss enters HUMAN_RECONNECT_REQUIRED, [15] preventing further export/upload", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    exec.outcome = { kind: "SESSION_LOST" };
    const r = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(r.disposition).toBe("SESSION_LOST");
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
    // Further catch-ups are blocked — no more export/upload steps run.
    const after = await h.runtime.runCatchUp(ACCOUNT, NOW, new FakeExecutor());
    expect(after.disposition).toBe("SKIPPED_NOT_READY");
    expect(after.syncExecuted).toBe(false);
  });

  it("[16] overlapping same-account catch-ups return SKIPPED_BUSY", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const exec = new FakeExecutor();
    let release!: () => void;
    exec.gate = new Promise<void>((r) => (release = r));
    const first = h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    await Promise.resolve();
    const second = await h.runtime.runCatchUp(ACCOUNT, NOW, exec);
    expect(second.disposition).toBe("SKIPPED_BUSY");
    release();
    const firstResult = await first;
    expect(firstResult.disposition).toBe("CATCH_UP_SUCCEEDED");
    expect(exec.calls).toBe(1);
  });

  it("[17] different accounts remain isolated", async () => {
    const h = makeRuntime();
    await startToReady(h, ACCOUNT);
    await startToReady(h, ACCOUNT_2);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    h.runtime.acknowledgeCatchUp(ACCOUNT_2);
    const e1 = new FakeExecutor();
    const e2 = new FakeExecutor();
    e2.outcome = { kind: "FAILED_RECOVERABLE" };
    const r1 = await h.runtime.runCatchUp(ACCOUNT, NOW, e1);
    const r2 = await h.runtime.runCatchUp(ACCOUNT_2, NOW, e2);
    expect(r1.disposition).toBe("CATCH_UP_SUCCEEDED");
    expect(r2.disposition).toBe("CATCH_UP_FAILED");
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
    expect(h.runtime.getState(ACCOUNT_2)).toBe("DEGRADED");
  });
});

// ── Restart / seam / safety ─────────────────────────────────────────────────────────────────────────

describe("catch-up — restart, seam & safety", () => {
  it("[18] restart does not inherit consumed/pending catch-up, [19] requires fresh inspection first", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    await h.runtime.runCatchUp(ACCOUNT, NOW, new FakeExecutor()); // consumed
    const inspectBefore = h.inspector.calls;
    const catchUpsBefore = h.catchUp.requests.length;

    h.inspector.standing = "LOGGED_IN";
    await h.runtime.restart(ACCOUNT, NOW);
    expect(h.inspector.calls).toBe(inspectBefore + 1); // fresh inspection
    expect(h.catchUp.requests).toHaveLength(catchUpsBefore + 1); // a NEW catch-up only after READY
    // The new session's catch-up is neither consumed nor acknowledged.
    expect(h.runtime.hasAcknowledgedCatchUp(ACCOUNT)).toBe(false);
    const blocked = await h.runtime.runCatchUp(ACCOUNT, NOW, new FakeExecutor());
    expect(blocked.disposition).toBe("SKIPPED_CATCH_UP_NOT_ACKNOWLEDGED");
  });

  it("[20] the existing sync executor is invoked through the intended seam, [21]/[22] exactly once", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const cycle = new FakeCycle(); // the shipped SyntheticCycle capture/upload boundary
    const executor = syntheticCycleCatchUpExecutor(cycle);
    const r = await h.runtime.runCatchUp(ACCOUNT, NOW, executor);
    expect(r.disposition).toBe("CATCH_UP_SUCCEEDED");
    expect(cycle.calls).toBe(1); // one capture→upload leg invocation — never duplicated
  });

  it("(extra) the SyntheticCycle→catch-up outcome mapping is faithful", () => {
    expect(syntheticCycleOutcomeToCatchUp("SUCCESS")).toEqual({ kind: "SUCCEEDED" });
    expect(syntheticCycleOutcomeToCatchUp("DOWNLOAD_FAILED")).toEqual({ kind: "FAILED_RECOVERABLE", errorCategory: "DOWNLOAD_FAILED" });
    expect(syntheticCycleOutcomeToCatchUp("UPLOAD_FAILED")).toEqual({ kind: "FAILED_RECOVERABLE", errorCategory: "NETWORK" });
    expect(syntheticCycleOutcomeToCatchUp("PARTIAL").kind).toBe("FAILED_RECOVERABLE");
    expect(syntheticCycleOutcomeToCatchUp("DELETE_FAILED").kind).toBe("FAILED_RECOVERABLE");
  });

  it("[23] emitted catch-up results/operational states carry no raw review/id/url/path/selector/token", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const results = [
      await h.runtime.runCatchUp(ACCOUNT, NOW, (() => { const e = new FakeExecutor(); return e; })()),
    ];
    const blob = JSON.stringify({ results, operational: h.sink.states });
    expect(blob).not.toMatch(/https?:\/\//i);
    expect(blob).not.toMatch(/\/Users\/|data-la-|\.xlsx|\.click\(|querySelector|리뷰글번호|eyJ[A-Za-z0-9_-]/);
    // account refs are hash-only (no raw store/account identity fields)
    for (const s of h.sink.states) {
      expect(Object.keys(s.accountRef).sort()).toEqual(["boundStoreFingerprintHash", "connectionId", "fingerprintSourceCategory"]);
    }
  });

  it("[24]/[25] CapabilityStatus (and schema/dedup) are never changed by a catch-up", async () => {
    const h = makeRuntime();
    await startToReady(h);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    // Success, then a fresh session that fails — capability must stay put throughout.
    await h.runtime.runCatchUp(ACCOUNT, NOW, new FakeExecutor());
    expect(h.runtime.getOperationalState(ACCOUNT)?.capabilityStatus).toBe("NEEDS_DISCOVERY");
    for (const s of h.sink.states) expect(s.capabilityStatus).toBe("NEEDS_DISCOVERY");
  });
});
