import { describe, expect, it } from "vitest";
import {
  LocalAgentRuntime,
  type CatchUpRequestSink,
  type LocalAgentDeps,
  type LocalAgentNotification,
  type LocalAgentNotifier,
  type LoginModeNormalizer,
  type LoginModeScan,
  type LoginSubmitter,
  type OperationalStateSink,
  type ReconnectSurface,
  type ReconnectSurfacePrep,
} from "../../src/agent/local-agent-runtime";
import type {
  ContextLauncher,
  SessionInspector,
  SyntheticCycle,
  SyntheticCycleOutcome,
  WorkerContext,
} from "../../src/esm/esm-worker-runtime";
import {
  CANDIDATE_SIGNATURE_SCHEMA_VERSION,
  computeCandidateSignature,
  type CandidateShape,
} from "../../src/esm/esm-candidate-signature";
import type {
  CredentialPopulationObservation,
  LocalAgentConnection,
  SanitizedAccountRef,
} from "../../src/agent/local-agent-state";
import type { ConnectorSyncState } from "../../src/connection/sync-state";
import type { InspectionVerdict } from "../../src/esm/worker-session-state";

const SALT = "local-agent-test-salt";
const NOW = "2026-07-03T00:00:00Z";

const ACCOUNT: SanitizedAccountRef = {
  connectionId: "conn-agent-0001",
  boundStoreFingerprintHash: "hash-store-xyz",
  fingerprintSourceCategory: "account-scope",
};

/** The sanitized shape of the approved GMARKET login-mode selector (per M-Agent-0C). */
const MODE_SHAPE: CandidateShape = {
  category: "export-like",
  actionable: true,
  scope: "allowlisted-frame",
  labelShape: { tokenCountBucket: "few", script: "hangul", hasExportWord: false },
};

function makeConnection(overrides: Partial<LocalAgentConnection> = {}): LocalAgentConnection {
  return {
    account: ACCOUNT,
    loginMode: "GMARKET",
    loginModeSignatureVersion: CANDIDATE_SIGNATURE_SCHEMA_VERSION,
    loginModeSignature: computeCandidateSignature(MODE_SHAPE, SALT),
    sessionInspectionConsent: true,
    loginModeAutoSelectionConsent: true,
    assistedReconnectConsent: true,
    autoSubmitAfterCredentialSelectionConsent: true,
    reviewExportConsent: true,
    uploadConsent: true,
    ...overrides,
  };
}

function makeScan(overrides: Partial<LoginModeScan> = {}): LoginModeScan {
  return {
    candidatePresent: true,
    candidate: { ...MODE_SHAPE, labelShape: { ...MODE_SHAPE.labelShape } },
    alreadyActive: false,
    ...overrides,
  };
}

function bothPopulated(overrides: Partial<CredentialPopulationObservation> = {}): CredentialPopulationObservation {
  return { usernamePopulated: true, passwordPopulated: true, challengePresent: false, formSignatureMatch: true, ...overrides };
}

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
  scan: LoginModeScan = makeScan();
  scanCalls = 0;
  selectCalls = 0;
  async scanModeCandidate(): Promise<LoginModeScan> {
    this.scanCalls += 1;
    return this.scan;
  }
  async selectMode(): Promise<void> {
    this.selectCalls += 1;
  }
}

class FakeSurface implements ReconnectSurface {
  result: ReconnectSurfacePrep = { formShapeMatches: true };
  calls = 0;
  async prepare(): Promise<ReconnectSurfacePrep> {
    this.calls += 1;
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
  async notify(notification: LocalAgentNotification): Promise<void> {
    this.notifications.push(notification);
  }
  countOf(kind: LocalAgentNotification["kind"]): number {
    return this.notifications.filter((n) => n.kind === kind).length;
  }
}

class FakeCatchUp implements CatchUpRequestSink {
  requests: SanitizedAccountRef[] = [];
  async request(account: SanitizedAccountRef): Promise<void> {
    this.requests.push(account);
  }
}

class FakeCycle implements SyntheticCycle {
  calls = 0;
  contexts: string[] = [];
  outcome: SyntheticCycleOutcome = "SUCCESS";
  gate: Promise<void> | null = null;
  async run(context: WorkerContext): Promise<SyntheticCycleOutcome> {
    this.calls += 1;
    this.contexts.push(context.id);
    if (this.gate) await this.gate;
    return this.outcome;
  }
}

class FakeSink implements OperationalStateSink {
  states: ConnectorSyncState[] = [];
  async record(state: ConnectorSyncState): Promise<void> {
    this.states.push(state);
  }
}

interface Harness {
  runtime: LocalAgentRuntime;
  launcher: FakeLauncher;
  inspector: FakeInspector;
  normalizer: FakeNormalizer;
  surface: FakeSurface;
  submitter: FakeSubmitter;
  notifier: FakeNotifier;
  catchUp: FakeCatchUp;
  cycle: FakeCycle;
  sink: FakeSink;
}

function makeHarness(): Harness {
  const launcher = new FakeLauncher();
  const inspector = new FakeInspector();
  const normalizer = new FakeNormalizer();
  const surface = new FakeSurface();
  const submitter = new FakeSubmitter();
  const notifier = new FakeNotifier();
  const catchUp = new FakeCatchUp();
  const cycle = new FakeCycle();
  const sink = new FakeSink();
  const deps: LocalAgentDeps = {
    launcher,
    inspector,
    loginModeNormalizer: normalizer,
    reconnectSurface: surface,
    submitter,
    notifier,
    catchUp,
    cycle,
    operationalSink: sink,
    salt: SALT,
  };
  return { runtime: new LocalAgentRuntime(deps), launcher, inspector, normalizer, surface, submitter, notifier, catchUp, cycle, sink };
}

/** Start a logged-out session and drive it to WAITING_FOR_CREDENTIAL_SELECTION. */
async function startLoggedOut(h: Harness, conn: LocalAgentConnection = makeConnection()): Promise<void> {
  h.inspector.standing = "NOT_LOGGED_IN";
  await h.runtime.start(conn, NOW);
}

// ── Startup ────────────────────────────────────────────────────────────────────────────────────────

describe("LocalAgentRuntime — startup", () => {
  it("[1] startup LOGGED_IN → READY", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    const state = await h.runtime.start(makeConnection(), NOW);
    expect(state).toBe("READY");
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
  });

  it("[2] startup LOGGED_IN requests exactly one catch-up sync", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    expect(h.catchUp.requests).toHaveLength(1);
  });

  it("[3] startup logged out enters reconnect preparation (→ WAITING_FOR_CREDENTIAL_SELECTION)", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    expect(h.runtime.getState(ACCOUNT)).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(h.catchUp.requests).toHaveLength(0); // not READY → no catch-up yet
  });

  it("(extra) no session-inspection consent halts at PAUSED without inspecting", async () => {
    const h = makeHarness();
    const state = await h.runtime.start(makeConnection({ sessionInspectionConsent: false }), NOW);
    expect(state).toBe("PAUSED");
    expect(h.inspector.calls).toBe(0);
  });
});

// ── Assisted reconnect gates ─────────────────────────────────────────────────────────────────────

describe("LocalAgentRuntime — assisted reconnect gates", () => {
  it("[4] a configured (version-matched) login mode is required — an unbound mode fails closed", async () => {
    const h = makeHarness();
    await startLoggedOut(h, makeConnection({ loginModeSignatureVersion: 999 }));
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(h.normalizer.selectCalls).toBe(0);
  });

  it("[5] an exact mode-signature match allows exactly one normalization click", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    expect(h.normalizer.selectCalls).toBe(1);
    expect(h.runtime.getState(ACCOUNT)).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });

  it("[6] a signature mismatch causes ZERO mode clicks", async () => {
    const h = makeHarness();
    h.normalizer.scan = makeScan({
      candidate: { ...MODE_SHAPE, labelShape: { ...MODE_SHAPE.labelShape, hasExportWord: true } }, // different shape → different sig
    });
    await startLoggedOut(h);
    expect(h.normalizer.selectCalls).toBe(0);
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[7] mode normalization occurs at most once (and zero clicks when already active)", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    expect(h.normalizer.selectCalls).toBe(1); // never 2 in one reconnect lifecycle

    const h2 = makeHarness();
    h2.normalizer.scan = makeScan({ alreadyActive: true });
    await startLoggedOut(h2);
    expect(h2.normalizer.selectCalls).toBe(0); // already active → no click
    expect(h2.runtime.getState(ACCOUNT)).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });

  it("[8] the reconnect notification is emitted exactly once", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    expect(h.notifier.countOf("CREDENTIAL_SELECTION_REQUIRED")).toBe(1);
  });

  it("[9] state becomes WAITING_FOR_CREDENTIAL_SELECTION after preparation", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    expect(h.runtime.getState(ACCOUNT)).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });

  it("(extra) missing assisted-reconnect consent fails closed with zero scan", async () => {
    const h = makeHarness();
    await startLoggedOut(h, makeConnection({ assistedReconnectConsent: false }));
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(h.normalizer.scanCalls).toBe(0);
    expect(h.normalizer.selectCalls).toBe(0);
  });

  it("(extra) missing mode-auto-selection consent fails closed with zero clicks", async () => {
    const h = makeHarness();
    await startLoggedOut(h, makeConnection({ loginModeAutoSelectionConsent: false }));
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(h.normalizer.selectCalls).toBe(0);
  });

  it("(extra) a login-form-shape mismatch after normalization fails closed", async () => {
    const h = makeHarness();
    h.surface.result = { formShapeMatches: false };
    await startLoggedOut(h);
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });
});

// ── Credential-selection submit gate ─────────────────────────────────────────────────────────────

describe("LocalAgentRuntime — submit gate", () => {
  it("[10] username-only population causes zero submits", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    const r = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated({ passwordPopulated: false }), NOW);
    expect(r.disposition).toBe("AWAITING_POPULATION");
    expect(h.submitter.calls).toBe(0);
    expect(h.runtime.getState(ACCOUNT)).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });

  it("[11] password-only population causes zero submits", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    const r = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated({ usernamePopulated: false }), NOW);
    expect(r.disposition).toBe("AWAITING_POPULATION");
    expect(h.submitter.calls).toBe(0);
  });

  it("[12] both fields populated with missing auto-submit consent causes zero submits", async () => {
    const h = makeHarness();
    await startLoggedOut(h, makeConnection({ autoSubmitAfterCredentialSelectionConsent: false }));
    const r = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    expect(r.disposition).toBe("NO_SUBMIT_CONSENT");
    expect(h.submitter.calls).toBe(0);
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[13] a challenge causes zero submits and a human reconnect", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    const r = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated({ challengePresent: true }), NOW);
    expect(r.disposition).toBe("CHALLENGE");
    expect(h.submitter.calls).toBe(0);
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[14] a form-signature mismatch causes zero submits", async () => {
    const h = makeHarness();
    await startLoggedOut(h);
    const r = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated({ formSignatureMatch: false }), NOW);
    expect(r.disposition).toBe("FORM_DRIFT");
    expect(h.submitter.calls).toBe(0);
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[15] all gates passing allows exactly one submit", async () => {
    const h = makeHarness();
    h.inspector.standing = "NOT_LOGGED_IN"; // logged out at startup...
    await h.runtime.start(makeConnection(), NOW);
    h.inspector.queue = ["LOGGED_IN"]; // ...then the post-submit verification passes
    const r = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    expect(r.submitted).toBe(true);
    expect(h.submitter.calls).toBe(1);
    expect(r.disposition).toBe("LOGGED_IN");
  });

  it("[16] duplicate population events do not double-submit", async () => {
    const h = makeHarness();
    h.inspector.standing = "NOT_LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    h.inspector.queue = ["LOGGED_IN"];
    await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    const dup = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    expect(dup.disposition).toBe("IGNORED_NOT_WAITING");
    expect(dup.submitted).toBe(false);
    expect(h.submitter.calls).toBe(1);
  });

  it("[17] a successful post-submit inspection → READY", async () => {
    const h = makeHarness();
    h.inspector.standing = "NOT_LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    h.inspector.queue = ["LOGGED_IN"];
    await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
  });

  it("[18] a successful reconnect requests exactly one catch-up sync", async () => {
    const h = makeHarness();
    h.inspector.standing = "NOT_LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    expect(h.catchUp.requests).toHaveLength(0);
    h.inspector.queue = ["LOGGED_IN"];
    await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    expect(h.catchUp.requests).toHaveLength(1);
  });

  it("[19] a failed post-submit inspection causes no retry", async () => {
    const h = makeHarness();
    h.inspector.standing = "NOT_LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    const inspectCallsBefore = h.inspector.calls;
    h.inspector.queue = ["NOT_LOGGED_IN"]; // verification fails
    const r = await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);
    expect(r.disposition).toBe("VERIFY_FAILED");
    expect(h.submitter.calls).toBe(1); // exactly one submit, never retried
    expect(h.inspector.calls).toBe(inspectCallsBefore + 1); // exactly one verification, no retry loop
    expect(h.runtime.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });
});

// ── Restart / workday collection seam ────────────────────────────────────────────────────────────

describe("LocalAgentRuntime — restart & workday seam", () => {
  it("[20] restart cannot inherit READY", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
    h.inspector.standing = "NOT_LOGGED_IN"; // the cold restart is a session break
    const state = await h.runtime.restart(ACCOUNT, NOW);
    expect(state).not.toBe("READY");
  });

  it("[21] restart requires a fresh inspection (and a fresh context)", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    const inspectCallsBefore = h.inspector.calls;
    const contextBefore = h.runtime.getContextId(ACCOUNT);
    await h.runtime.restart(ACCOUNT, NOW);
    expect(h.inspector.calls).toBe(inspectCallsBefore + 1);
    expect(h.launcher.count).toBe(2);
    expect(h.runtime.getContextId(ACCOUNT)).not.toBe(contextBefore);
  });

  it("[22] a sync tick is blocked during a reconnect", async () => {
    const h = makeHarness();
    await startLoggedOut(h); // → WAITING_FOR_CREDENTIAL_SELECTION
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("RECONNECT_REQUIRED");
    expect(h.cycle.calls).toBe(0);
  });

  it("(extra) a tick is blocked before the catch-up request is acknowledged", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    const r = await h.runtime.tick(ACCOUNT, NOW);
    expect(r.disposition).toBe("SKIPPED_CATCHUP_PENDING");
    expect(h.cycle.calls).toBe(0);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const r2 = await h.runtime.tick(ACCOUNT, NOW);
    expect(r2.disposition).toBe("SYNCED");
  });

  it("[23] manual workday ticks reuse the same context identity", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    const ctx = h.runtime.getContextId(ACCOUNT);
    await h.runtime.tick(ACCOUNT, NOW);
    await h.runtime.tick(ACCOUNT, NOW);
    expect(h.launcher.count).toBe(1);
    expect(h.cycle.contexts).toEqual([ctx, ctx]);
  });

  it("[24] overlapping same-account sync ticks do not double-run", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    let release!: () => void;
    h.cycle.gate = new Promise<void>((r) => (release = r));
    const first = h.runtime.tick(ACCOUNT, NOW); // enters the cycle and blocks on the gate
    await Promise.resolve();
    const second = await h.runtime.tick(ACCOUNT, NOW); // overlapping
    expect(second.disposition).toBe("SKIPPED_BUSY");
    release();
    const firstResult = await first;
    expect(firstResult.disposition).toBe("SYNCED");
    expect(h.cycle.calls).toBe(1);
  });

  it("(extra) a duplicate READY (re-inspection) does not request a second catch-up", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    expect(h.catchUp.requests).toHaveLength(1);
    await h.runtime.reinspect(ACCOUNT, NOW); // LOGGED_IN again
    expect(h.runtime.getState(ACCOUNT)).toBe("READY");
    expect(h.catchUp.requests).toHaveLength(1);
  });
});

// ── Separation / sanitization invariants ─────────────────────────────────────────────────────────

describe("LocalAgentRuntime — separation & sanitization", () => {
  it("[25] CapabilityStatus never changes across ticks (success and failure)", async () => {
    const h = makeHarness();
    h.inspector.standing = "LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    h.runtime.acknowledgeCatchUp(ACCOUNT);
    h.cycle.outcome = "SUCCESS";
    await h.runtime.tick(ACCOUNT, NOW);
    h.cycle.outcome = "DOWNLOAD_FAILED";
    await h.runtime.tick(ACCOUNT, NOW);
    expect(h.runtime.getOperationalState(ACCOUNT)?.capabilityStatus).toBe("NEEDS_DISCOVERY");
    for (const s of h.sink.states) expect(s.capabilityStatus).toBe("NEEDS_DISCOVERY");
    expect(h.runtime.getReconnectInteractionCategory(ACCOUNT)).toBe("UNKNOWN"); // never claimed in 1A
  });

  it("[26] emitted notifications carry only sanitized enums + a hash-only account ref", async () => {
    const h = makeHarness();
    h.inspector.standing = "NOT_LOGGED_IN";
    await h.runtime.start(makeConnection(), NOW);
    h.inspector.queue = ["LOGGED_IN"];
    await h.runtime.submitCredentialObservation(ACCOUNT, bothPopulated(), NOW);

    const allowedKinds = new Set(["CREDENTIAL_SELECTION_REQUIRED", "HUMAN_RECONNECT_REQUIRED"]);
    const accountKeys = ["connectionId", "boundStoreFingerprintHash", "fingerprintSourceCategory"].sort();
    for (const n of h.notifier.notifications) {
      expect(Object.keys(n).sort()).toEqual(["account", "kind"]);
      expect(allowedKinds.has(n.kind)).toBe(true);
      expect(Object.keys(n.account).sort()).toEqual(accountKeys);
    }
    // No raw URL / path / DOM / selector / credential leaked into any emitted surface.
    const blob = JSON.stringify({
      notifications: h.notifier.notifications,
      operational: h.sink.states,
    });
    expect(blob).not.toMatch(/https?:\/\//i);
    expect(blob).not.toMatch(/password|username|cookie|token|\/Users\/|select\(|\.click\(/i);
  });
});
