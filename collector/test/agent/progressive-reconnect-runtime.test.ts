import { describe, it, expect } from "vitest";
import {
  ProgressiveReconnectRuntime,
  RecordingProgressiveSink,
  submitPreconditionMet,
  type ProgressiveReconnectBrowser,
} from "../../src/agent/progressive-reconnect-runtime";
import {
  dedicatedProfileIdFor,
  initialFormStrategyForMode,
  type ProgressiveReconnectConnection,
  type InitialFormStrategy,
} from "../../src/agent/progressive-reconnect";
import type { SanitizedAccountRef, InspectionVerdict, CredentialPopulationObservation } from "../../src/agent/local-agent-state";

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
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

class FakeBrowser implements ProgressiveReconnectBrowser {
  inspectCalls = 0;
  establishCalls = 0;
  submitCalls = 0;
  closeCalls = 0;
  lastStrategy: InitialFormStrategy | null = null;
  private readonly inspectQueue: InspectionVerdict[];
  private readonly establishObs: CredentialPopulationObservation;
  private readonly submitVerdict: InspectionVerdict;
  constructor(opts: { inspect: InspectionVerdict[]; establish?: CredentialPopulationObservation; submit?: InspectionVerdict }) {
    this.inspectQueue = [...opts.inspect];
    this.establishObs = opts.establish ?? obs(true, true);
    this.submitVerdict = opts.submit ?? "LOGGED_IN";
  }
  async inspectSession(): Promise<InspectionVerdict> {
    this.inspectCalls++;
    return this.inspectQueue.shift() ?? "NOT_LOGGED_IN";
  }
  async establishLoginMode(strategy: InitialFormStrategy): Promise<CredentialPopulationObservation> {
    this.establishCalls++;
    this.lastStrategy = strategy;
    return this.establishObs;
  }
  async submitLoginOnce(): Promise<InspectionVerdict> {
    this.submitCalls++;
    return this.submitVerdict;
  }
  async close(): Promise<void> {
    this.closeCalls++;
  }
}

function build(c: ProgressiveReconnectConnection, browser: FakeBrowser) {
  const sink = new RecordingProgressiveSink();
  return { runtime: new ProgressiveReconnectRuntime(c, browser, sink), sink };
}
const IN: InspectionVerdict = "LOGGED_IN";
const OUT: InspectionVerdict = "NOT_LOGGED_IN";

// ── tests ────────────────────────────────────────────────────────────────────────────────────────
describe("progressive reconnect runtime", () => {
  it("existing session → READY + one catch-up, no bootstrap/submit", async () => {
    const b = new FakeBrowser({ inspect: [IN] });
    const { runtime, sink } = build(conn(), b);
    const s = await runtime.start();
    expect(s.phase).toBe("READY");
    expect(s.path).toBe("EXISTING_SESSION");
    expect(sink.catchUpRequests).toHaveLength(1);
    expect(b.establishCalls).toBe(0);
    expect(b.submitCalls).toBe(0);
    expect(sink.userActions).toHaveLength(0);
  });

  it("zero-touch success → READY, one bootstrap + one submit + one catch-up", async () => {
    const b = new FakeBrowser({ inspect: [OUT], establish: obs(true, true), submit: IN });
    const { runtime, sink } = build(conn(), b);
    const s = await runtime.start();
    expect(s.phase).toBe("READY");
    expect(s.path).toBe("ZERO_TOUCH_AUTOFILL");
    expect(b.establishCalls).toBe(1);
    expect(b.submitCalls).toBe(1);
    expect(sink.catchUpRequests).toHaveLength(1);
  });

  it("passes DOCUMENT_START_BOOTSTRAP for GMARKET and DIRECT for ESM_PLUS", async () => {
    const g = new FakeBrowser({ inspect: [OUT], establish: obs(true, true), submit: IN });
    await build(conn({ loginMode: "GMARKET" }), g).runtime.start();
    expect(g.lastStrategy).toBe("DOCUMENT_START_BOOTSTRAP");
    const e = new FakeBrowser({ inspect: [OUT], establish: obs(true, true), submit: IN });
    await build(conn({ loginMode: "ESM_PLUS" }), e).runtime.start();
    expect(e.lastStrategy).toBe("DIRECT");
  });

  it("username missing → assisted WAITING, zero submit, ENTER_MISSING_USERNAME surfaced", async () => {
    const b = new FakeBrowser({ inspect: [OUT], establish: obs(false, true) });
    const { runtime, sink } = build(conn(), b);
    const s = await runtime.start();
    expect(s.phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(b.submitCalls).toBe(0);
    expect(sink.userActions.map((u) => u.action)).toEqual(["ENTER_MISSING_USERNAME"]);
    expect(sink.catchUpRequests).toHaveLength(0);
  });

  it("challenge → HUMAN_RECONNECT_REQUIRED, zero submit", async () => {
    const b = new FakeBrowser({ inspect: [OUT], establish: obs(true, true, true, true) });
    const { runtime, sink } = build(conn(), b);
    const s = await runtime.start();
    expect(s.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(b.submitCalls).toBe(0);
    expect(sink.userActions.map((u) => u.action)).toEqual(["COMPLETE_ADDITIONAL_AUTHENTICATION"]);
  });

  it("signature drift → HUMAN_RECONNECT_REQUIRED, zero submit", async () => {
    const b = new FakeBrowser({ inspect: [OUT], establish: obs(true, true, false, false) });
    const { runtime, sink } = build(conn(), b);
    const s = await runtime.start();
    expect(s.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(b.submitCalls).toBe(0);
    expect(sink.userActions.map((u) => u.action)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
  });

  it("submit verification fails → HUMAN_RECONNECT_REQUIRED, exactly one submit, no auto-retry", async () => {
    const b = new FakeBrowser({ inspect: [OUT], establish: obs(true, true), submit: OUT });
    const { runtime, sink } = build(conn(), b);
    const s = await runtime.start();
    expect(s.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(b.submitCalls).toBe(1);
    expect(b.establishCalls).toBe(1);
    expect(sink.userActions.map((u) => u.action)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
    expect(sink.catchUpRequests).toHaveLength(0);
  });

  it("one bootstrap per startup — a human-completed re-inspection does not re-establish", async () => {
    const b = new FakeBrowser({ inspect: [OUT, OUT], establish: obs(false, true) });
    const { runtime } = build(conn(), b);
    await runtime.start(); // establish #1 → username missing → WAITING
    expect(b.establishCalls).toBe(1);
    await runtime.humanCompleted("ENTER_MISSING_USERNAME"); // fresh inspection → still OUT → assisted, no establish
    expect(b.establishCalls).toBe(1);
    expect(runtime.getState().phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });

  it("human completion success → READY + one catch-up", async () => {
    const b = new FakeBrowser({ inspect: [OUT, IN], establish: obs(false, false) });
    const { runtime, sink } = build(conn(), b);
    await runtime.start(); // → WAITING
    const s = await runtime.humanCompleted("SELECT_SAVED_CREDENTIAL"); // fresh inspect → LOGGED_IN → READY
    expect(s.phase).toBe("READY");
    expect(sink.catchUpRequests).toHaveLength(1);
  });

  it("session-loss after READY permits one new automatic attempt", async () => {
    const b = new FakeBrowser({ inspect: [IN, OUT], establish: obs(true, true), submit: IN });
    const { runtime } = build(conn(), b);
    await runtime.start(); // existing session → READY (inspect #1 = IN)
    expect(b.establishCalls).toBe(0);
    const s = await runtime.sessionLost(); // inspect #2 = OUT → establish → submit → READY
    expect(b.establishCalls).toBe(1);
    expect(b.submitCalls).toBe(1);
    expect(s.phase).toBe("READY");
  });

  it("autoSubmitConsent:false + both populated → HUMAN_RECONNECT_REQUIRED, zero submit", async () => {
    const b = new FakeBrowser({ inspect: [OUT], establish: obs(true, true) });
    const { runtime, sink } = build(conn({ autoSubmitConsent: false }), b);
    const s = await runtime.start();
    expect(s.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(b.submitCalls).toBe(0);
    expect(sink.userActions.map((u) => u.action)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
  });

  it("autoReconnectConsent:false → HUMAN_RECONNECT_REQUIRED, no bootstrap, no submit", async () => {
    const b = new FakeBrowser({ inspect: [OUT] });
    const { runtime, sink } = build(conn({ autoReconnectConsent: false }), b);
    const s = await runtime.start();
    expect(s.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(b.establishCalls).toBe(0);
    expect(b.submitCalls).toBe(0);
    expect(sink.userActions.map((u) => u.action)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
  });

  it("close() delegates to the browser port", async () => {
    const b = new FakeBrowser({ inspect: [IN] });
    const { runtime } = build(conn(), b);
    await runtime.start();
    await runtime.close();
    expect(b.closeCalls).toBe(1);
  });
});

describe("submitPreconditionMet (pre-submit re-check)", () => {
  it("true only when both populated, no challenge, and signature matches", () => {
    expect(submitPreconditionMet(obs(true, true, false, true))).toBe(true);
  });
  it("false when username not populated", () => {
    expect(submitPreconditionMet(obs(false, true, false, true))).toBe(false);
  });
  it("false when password not populated", () => {
    expect(submitPreconditionMet(obs(true, false, false, true))).toBe(false);
  });
  it("false when a challenge is present", () => {
    expect(submitPreconditionMet(obs(true, true, true, true))).toBe(false);
  });
  it("false when the form signature drifted", () => {
    expect(submitPreconditionMet(obs(true, true, false, false))).toBe(false);
  });
});
