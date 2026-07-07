import { describe, it, expect } from "vitest";
import {
  LocalAgentProgressiveService,
  localAgentStateFromProgressive,
  createProgressiveReconnectRuntimeFactory,
  createLocalAgentProgressiveService,
  type ProgressiveReconnectRuntimeFactory,
  type ProgressiveReconnectRuntimeLike,
} from "../../src/agent/local-agent-progressive-service";
import { ProgressiveReconnectRuntime, type ProgressiveReconnectBrowser, type ProgressiveReconnectSink } from "../../src/agent/progressive-reconnect-runtime";
import {
  dedicatedProfileIdFor,
  initialFormStrategyForMode,
  type ProgressiveReconnectConnection,
  type ProgressiveReconnectState,
} from "../../src/agent/progressive-reconnect";
import type { SanitizedAccountRef, InspectionVerdict, CredentialPopulationObservation, LocalAgentState } from "../../src/agent/local-agent-state";
import type { UserActionCategory } from "../../src/agent/progressive-reconnect";

// ── fakes / helpers ──────────────────────────────────────────────────────────────────────────────
function acct(connectionId: string): SanitizedAccountRef {
  return { connectionId, boundStoreFingerprintHash: null, fingerprintSourceCategory: null };
}
function conn(over: Partial<ProgressiveReconnectConnection> = {}): ProgressiveReconnectConnection {
  const loginMode = over.loginMode ?? "GMARKET";
  const account = over.account ?? acct("conn-A");
  return {
    account,
    loginMode,
    dedicatedProfileId: over.dedicatedProfileId ?? dedicatedProfileIdFor(account),
    initialFormStrategy: over.initialFormStrategy ?? initialFormStrategyForMode(loginMode),
    autoReconnectCapability: over.autoReconnectCapability ?? "CONDITIONAL",
    autoReconnectConsent: over.autoReconnectConsent ?? true,
    autoSubmitConsent: over.autoSubmitConsent ?? true,
    assistedReconnectConsent: over.assistedReconnectConsent ?? true,
  };
}
function obs(u: boolean, p: boolean, challengePresent = false, formSignatureMatch = true): CredentialPopulationObservation {
  return { usernamePopulated: u, passwordPopulated: p, challengePresent, formSignatureMatch };
}

// A real runtime driven by a fake browser (exercises service + runtime + policy end-to-end).
class FakeBrowser implements ProgressiveReconnectBrowser {
  closeCalls = 0;
  private readonly inspectQueue: InspectionVerdict[];
  private readonly establishObs: CredentialPopulationObservation;
  private readonly submitVerdict: InspectionVerdict;
  constructor(opts: { inspect: InspectionVerdict[]; establish?: CredentialPopulationObservation; submit?: InspectionVerdict }) {
    this.inspectQueue = [...opts.inspect];
    this.establishObs = opts.establish ?? obs(true, true);
    this.submitVerdict = opts.submit ?? "LOGGED_IN";
  }
  async inspectSession(): Promise<InspectionVerdict> { return this.inspectQueue.shift() ?? "NOT_LOGGED_IN"; }
  async establishLoginMode(): Promise<CredentialPopulationObservation> { return this.establishObs; }
  async submitLoginOnce(): Promise<InspectionVerdict> { return this.submitVerdict; }
  async close(): Promise<void> { this.closeCalls++; }
}
class FakeFactory implements ProgressiveReconnectRuntimeFactory {
  readonly browsers = new Map<string, FakeBrowser>();
  constructor(private readonly makeBrowser: (c: ProgressiveReconnectConnection) => FakeBrowser) {}
  create(connection: ProgressiveReconnectConnection, sink: ProgressiveReconnectSink): ProgressiveReconnectRuntimeLike {
    const b = this.makeBrowser(connection);
    this.browsers.set(connection.account.connectionId, b);
    return new ProgressiveReconnectRuntime(connection, b, sink);
  }
}
const factoryFor = (b: FakeBrowser) => new FakeFactory(() => b);

// A spy runtime (records which lifecycle methods the service delegates to).
function mkState(phase: LocalAgentState): ProgressiveReconnectState {
  return { phase, path: null, attemptConsumed: false, submitEmitted: false, pendingUserAction: null };
}
class SpyRuntime implements ProgressiveReconnectRuntimeLike {
  startCalls = 0; sessionLostCalls = 0; stopCalls = 0; closeCalls = 0;
  readonly humanCompletedActions: UserActionCategory[] = [];
  constructor(private state: ProgressiveReconnectState) {}
  async start(): Promise<ProgressiveReconnectState> { this.startCalls++; return this.state; }
  async sessionLost(): Promise<ProgressiveReconnectState> { this.sessionLostCalls++; return this.state; }
  async humanCompleted(a: UserActionCategory): Promise<ProgressiveReconnectState> { this.humanCompletedActions.push(a); return this.state; }
  async stop(): Promise<ProgressiveReconnectState> { this.stopCalls++; return this.state; }
  async close(): Promise<void> { this.closeCalls++; }
  getState(): ProgressiveReconnectState { return this.state; }
}
class SpyFactory implements ProgressiveReconnectRuntimeFactory {
  readonly spies = new Map<string, SpyRuntime>();
  constructor(private readonly make: (c: ProgressiveReconnectConnection) => SpyRuntime) {}
  create(connection: ProgressiveReconnectConnection): ProgressiveReconnectRuntimeLike {
    const s = this.make(connection);
    this.spies.set(connection.account.connectionId, s);
    return s;
  }
}

const IN: InspectionVerdict = "LOGGED_IN";
const OUT: InspectionVerdict = "NOT_LOGGED_IN";

// ── lifecycle outcomes ─────────────────────────────────────────────────────────────────────────────
describe("local agent progressive service — lifecycle", () => {
  it("existing session → READY, catch-up pending (not executed)", async () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [IN] })));
    const r = await svc.start(conn());
    expect(r.localAgentState).toBe("READY");
    expect(r.reconnectPath).toBe("EXISTING_SESSION");
    expect(r.pendingCatchUp).toBe(true);
    expect(r.pendingUserAction).toBeNull();
  });
  it("missing field → WAITING_FOR_CREDENTIAL_SELECTION, awaited action surfaced", async () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [OUT], establish: obs(false, true) })));
    const r = await svc.start(conn());
    expect(r.localAgentState).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(r.pendingUserAction).toBe("ENTER_MISSING_USERNAME");
    expect(r.pendingCatchUp).toBe(false);
  });
  it("challenge → HUMAN_RECONNECT_REQUIRED", async () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [OUT], establish: obs(true, true, true, true) })));
    const r = await svc.start(conn());
    expect(r.localAgentState).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(r.pendingUserAction).toBe("COMPLETE_ADDITIONAL_AUTHENTICATION");
  });
  it("maps progressive phase onto LocalAgentState", () => {
    expect(localAgentStateFromProgressive(mkState("READY"))).toBe("READY");
    expect(localAgentStateFromProgressive(mkState("WAITING_FOR_CREDENTIAL_SELECTION"))).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(localAgentStateFromProgressive(mkState("HUMAN_RECONNECT_REQUIRED"))).toBe("HUMAN_RECONNECT_REQUIRED");
  });
  it("session-loss on unknown connection → null", async () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [IN] })));
    expect(await svc.sessionLost("nope")).toBeNull();
    expect(await svc.humanCompleted("nope", "SELECT_SAVED_CREDENTIAL")).toBeNull();
  });
  it("browser retained while WAITING; stop closes + forgets (idempotent)", async () => {
    const b = new FakeBrowser({ inspect: [OUT], establish: obs(false, false) });
    const svc = new LocalAgentProgressiveService(factoryFor(b));
    await svc.start(conn());
    expect(svc.isBrowserRetained("conn-A")).toBe(true);
    expect(b.closeCalls).toBe(0);
    await svc.stop("conn-A");
    expect(b.closeCalls).toBe(1);
    expect(svc.getLocalAgentState("conn-A")).toBeNull();
    await svc.stop("conn-A"); // idempotent
    expect(b.closeCalls).toBe(1);
  });
  it("per-connection isolation", async () => {
    const bA = new FakeBrowser({ inspect: [IN] });
    const bB = new FakeBrowser({ inspect: [OUT], establish: obs(false, true) });
    const svc = new LocalAgentProgressiveService(new FakeFactory((c) => (c.account.connectionId === "conn-A" ? bA : bB)));
    await svc.start(conn({ account: acct("conn-A") }));
    await svc.start(conn({ account: acct("conn-B") }));
    await svc.stop("conn-A");
    expect(svc.getLocalAgentState("conn-A")).toBeNull();
    expect(svc.getLocalAgentState("conn-B")).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(bB.closeCalls).toBe(0);
  });
});

// ── delegation: the entrypoint actually calls the runtime ────────────────────────────────────────
describe("local agent progressive service — delegation", () => {
  it("each lifecycle method delegates to the per-connection runtime", async () => {
    const spy = new SpyRuntime(mkState("READY"));
    const svc = new LocalAgentProgressiveService(new SpyFactory(() => spy));
    await svc.start(conn());
    expect(spy.startCalls).toBe(1);
    await svc.sessionLost("conn-A");
    expect(spy.sessionLostCalls).toBe(1);
    await svc.humanCompleted("conn-A", "SELECT_SAVED_CREDENTIAL");
    expect(spy.humanCompletedActions).toEqual(["SELECT_SAVED_CREDENTIAL"]);
    await svc.stop("conn-A");
    expect(spy.stopCalls).toBe(1);
    expect(spy.closeCalls).toBe(1);
  });
  it("removeAccount delegates stop + close", async () => {
    const spy = new SpyRuntime(mkState("READY"));
    const svc = new LocalAgentProgressiveService(new SpyFactory(() => spy));
    await svc.start(conn());
    await svc.removeAccount("conn-A");
    expect(spy.stopCalls).toBe(1);
    expect(spy.closeCalls).toBe(1);
    expect(svc.isBrowserRetained("conn-A")).toBe(false);
  });
  it("the production factory yields a real runtime (structurally a ProgressiveReconnectRuntime)", () => {
    const factory = createProgressiveReconnectRuntimeFactory({ profileBaseDir: ".profile", authSurfaceUrl: "x", sessionProbeUrl: "y", allowlist: ["esmplus.com"], salt: "s" });
    const rt = factory.create(conn(), { requestCatchUp() {}, emitUserAction() {} });
    expect(rt).toBeInstanceOf(ProgressiveReconnectRuntime);
    // and the composition helper returns a wired service
    expect(createLocalAgentProgressiveService({ profileBaseDir: ".profile", authSurfaceUrl: "x", sessionProbeUrl: "y", allowlist: ["esmplus.com"], salt: "s" }))
      .toBeInstanceOf(LocalAgentProgressiveService);
  });
});

// ── one-shot intents ────────────────────────────────────────────────────────────────────────────
describe("local agent progressive service — one-shot intents", () => {
  it("user-action requests drain once (a second drain is empty)", async () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [OUT], establish: obs(false, true) })));
    await svc.start(conn());
    expect(svc.drainUserActionRequests("conn-A")).toEqual(["ENTER_MISSING_USERNAME"]);
    expect(svc.drainUserActionRequests("conn-A")).toEqual([]); // consumed once
  });
  it("catch-up intent acknowledges once (second ack is false)", async () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [IN] })));
    await svc.start(conn());
    expect(svc.acknowledgeCatchUp("conn-A")).toBe(true);
    expect(svc.acknowledgeCatchUp("conn-A")).toBe(false); // consumed once
  });
  it("repeated snapshot reads do not consume intents", async () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [IN] })));
    await svc.start(conn());
    // reading the snapshot many times must not drain/acknowledge
    expect(svc.getSnapshot("conn-A")?.pendingCatchUp).toBe(true);
    expect(svc.getSnapshot("conn-A")?.pendingCatchUp).toBe(true);
    expect(svc.getSnapshot("conn-A")?.pendingCatchUp).toBe(true);
    // the intent is still available to acknowledge exactly once
    expect(svc.acknowledgeCatchUp("conn-A")).toBe(true);
    expect(svc.getSnapshot("conn-A")?.pendingCatchUp).toBe(false);
  });
  it("drain/ack on an unknown connection are safe no-ops", () => {
    const svc = new LocalAgentProgressiveService(factoryFor(new FakeBrowser({ inspect: [IN] })));
    expect(svc.drainUserActionRequests("nope")).toEqual([]);
    expect(svc.acknowledgeCatchUp("nope")).toBe(false);
    expect(svc.getSnapshot("nope")).toBeNull();
  });
});
