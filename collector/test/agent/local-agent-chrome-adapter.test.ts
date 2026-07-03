import { describe, expect, it } from "vitest";
import {
  LocalAgentChromeAdapter,
  LocalAgentReconnectService,
  type GateSignals,
  type LocalAgentContext,
  type LocalAgentPage,
  type RawModeCandidate,
  type RawPopulation,
} from "../../src/agent/local-agent-chrome-adapter";
import {
  computeFormSignature,
  computeLoginModeSignature,
  connectionFromBinding,
  InMemoryLoginModeBindingStore,
  type LocalAgentConsents,
  type LoginModeBinding,
  type SanitizedFormShape,
} from "../../src/agent/local-agent-login-mode";
import { syntheticCycleCatchUpExecutor } from "../../src/agent/local-agent-catch-up";
import type { CatchUpSyncExecutor } from "../../src/agent/local-agent-runtime";
import type { SyntheticCycle, SyntheticCycleOutcome } from "../../src/esm/esm-worker-runtime";
import { CANDIDATE_SIGNATURE_SCHEMA_VERSION } from "../../src/esm/esm-candidate-signature";
import type { SanitizedAccountRef } from "../../src/connection/sync-state";
import type { InspectionVerdict } from "../../src/esm/worker-session-state";

const SALT = "local-agent-c1-salt";
const NOW = "2026-07-03T00:00:00Z";

const ACCOUNT: SanitizedAccountRef = {
  connectionId: "conn-agent-c1-0001",
  boundStoreFingerprintHash: "hash-store-c1",
  fingerprintSourceCategory: "account-scope",
};

const GM_TAB: RawModeCandidate = {
  modeCategory: "GMARKET",
  interactiveCategory: "tab",
  visible: true,
  enabled: true,
  topFrame: true,
  rectBucket: "medium",
  token: "tok-gm",
};

const ESTABLISHED_FORM: SanitizedFormShape = {
  idFieldBucket: "one",
  pwFieldBucket: "one",
  submitBucket: "one",
  formPresent: true,
  gmarketTabActive: false,
  challengePresent: false,
};

const ALL_CONSENTS: LocalAgentConsents = {
  sessionInspectionConsent: true,
  loginModeAutoSelectionConsent: true,
  assistedReconnectConsent: true,
  autoSubmitAfterCredentialSelectionConsent: true,
  reviewExportConsent: true,
  uploadConsent: true,
};

function baseBinding(): LoginModeBinding {
  return {
    account: ACCOUNT,
    loginMode: "GMARKET",
    loginModeSignatureVersion: CANDIDATE_SIGNATURE_SCHEMA_VERSION,
    loginModeSignature: computeLoginModeSignature(GM_TAB, SALT),
    postModeFormSignature: null,
    reconnectInteractionCategory: "TWO_STEP_FIELD_AND_CREDENTIAL_SELECTION",
  };
}

// ── Fake sanitized page ─────────────────────────────────────────────────────────────────────────────

class FakePage implements LocalAgentPage {
  gate: GateSignals = { https: true, hostAllowlisted: true, challengePresent: false, unexpectedIframe: false };
  candidates: RawModeCandidate[] = [{ ...GM_TAB }];
  formShape: SanitizedFormShape = { ...ESTABLISHED_FORM };
  population: RawPopulation = { usernamePopulated: false, passwordPopulated: false, challengePresent: false };
  standingVerdict: InspectionVerdict = "LOGGED_IN";
  verdictQueue: InspectionVerdict[] = [];

  clickModeCalls = 0;
  focusCalls = 0;
  submitCalls = 0;
  verdictCalls = 0;
  closed = 0;

  async readGateSignals(): Promise<GateSignals> {
    return this.gate;
  }
  async scanLoginModeCandidates(): Promise<RawModeCandidate[]> {
    return this.candidates;
  }
  async readFormShape(): Promise<SanitizedFormShape> {
    return this.formShape;
  }
  async clickModeCandidate(): Promise<void> {
    this.clickModeCalls += 1;
  }
  async focusUsernameField(): Promise<void> {
    this.focusCalls += 1;
  }
  async submitLoginForm(): Promise<void> {
    this.submitCalls += 1;
  }
  async readPopulation(): Promise<RawPopulation> {
    return this.population;
  }
  async classifySessionVerdict(): Promise<InspectionVerdict> {
    this.verdictCalls += 1;
    return this.verdictQueue.length > 0 ? this.verdictQueue.shift()! : this.standingVerdict;
  }
  async close(): Promise<void> {
    this.closed += 1;
  }
}

interface Harness {
  service: LocalAgentReconnectService;
  page: FakePage;
  store: InMemoryLoginModeBindingStore;
  binding: LoginModeBinding;
  connection: ReturnType<typeof connectionFromBinding>;
}

async function makeHarness(opts: {
  binding?: LoginModeBinding;
  consents?: LocalAgentConsents;
  configurePage?: (p: FakePage) => void;
} = {}): Promise<Harness> {
  const page = new FakePage();
  opts.configurePage?.(page);
  const binding = opts.binding ?? baseBinding();
  const store = new InMemoryLoginModeBindingStore();
  await store.save(binding);
  const context: LocalAgentContext = {
    id: "ctx-1",
    page,
    async close() {
      await page.close();
    },
  };
  const adapter = new LocalAgentChromeAdapter({
    account: ACCOUNT,
    salt: SALT,
    bindingStore: store,
    pageFactory: async () => context,
  });
  const service = new LocalAgentReconnectService(adapter, {
    salt: SALT,
    interactionCategory: binding.reconnectInteractionCategory,
  });
  const connection = connectionFromBinding(binding, opts.consents ?? ALL_CONSENTS);
  return { service, page, store, binding, connection };
}

/** Start a logged-out session (verify verdict later comes from the standing/queue config). */
async function startLoggedOut(h: Harness): Promise<void> {
  h.page.verdictQueue = ["NOT_LOGGED_IN", ...h.page.verdictQueue];
  await h.service.start(h.connection, NOW);
}

// ── Mode-signature gate ──────────────────────────────────────────────────────────────────────────

describe("adapter — login-mode signature gate", () => {
  it("[7] an exact GMARKET mode signature allows exactly one mode click → WAITING", async () => {
    const h = await makeHarness();
    await startLoggedOut(h);
    expect(h.page.clickModeCalls).toBe(1);
    expect(h.service.getState(ACCOUNT)).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });

  it("[8] an index/candidate alone cannot authorize a click — signature must match (zero clicks)", async () => {
    // A GMARKET·tab candidate exists, but its sanitized shape differs → signature mismatch.
    const h = await makeHarness({
      configurePage: (p) => {
        p.candidates = [{ ...GM_TAB, rectBucket: "large" }]; // different shape → different signature
      },
    });
    await startLoggedOut(h);
    expect(h.page.clickModeCalls).toBe(0);
    expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[9] duplicate matching GMARKET·tab candidates fail closed (zero clicks)", async () => {
    const h = await makeHarness({
      configurePage: (p) => {
        p.candidates = [{ ...GM_TAB }, { ...GM_TAB, token: "tok-gm-2" }];
      },
    });
    await startLoggedOut(h);
    expect(h.page.clickModeCalls).toBe(0);
    expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("(extra) a non-HTTPS / non-allowlisted / challenge / unexpected-iframe gate fails closed", async () => {
    for (const gate of [
      { https: false, hostAllowlisted: true, challengePresent: false, unexpectedIframe: false },
      { https: true, hostAllowlisted: false, challengePresent: false, unexpectedIframe: false },
      { https: true, hostAllowlisted: true, challengePresent: true, unexpectedIframe: false },
      { https: true, hostAllowlisted: true, challengePresent: false, unexpectedIframe: true },
    ] as GateSignals[]) {
      const h = await makeHarness({ configurePage: (p) => (p.gate = gate) });
      await startLoggedOut(h);
      expect(h.page.clickModeCalls).toBe(0);
      expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
    }
  });
});

// ── Form gate + handoff ──────────────────────────────────────────────────────────────────────────

describe("adapter — post-click form gate + human handoff", () => {
  it("[10] a post-click form-signature drift fails closed (mode click fired, no handoff)", async () => {
    const binding = { ...baseBinding(), postModeFormSignature: computeFormSignature(ESTABLISHED_FORM, SALT) };
    const h = await makeHarness({
      binding,
      configurePage: (p) => {
        // live form differs from the stored post-mode signature → drift
        p.formShape = { ...ESTABLISHED_FORM, submitBucket: "many" };
      },
    });
    await startLoggedOut(h);
    expect(h.page.clickModeCalls).toBe(1);
    expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(h.service.userActionRequests).toHaveLength(0);
  });

  it("[11] the user-action request (CLICK_USERNAME_FIELD_AND_SELECT_SAVED_CREDENTIAL) is emitted exactly once", async () => {
    const h = await makeHarness();
    await startLoggedOut(h);
    expect(h.service.userActionRequests).toHaveLength(1);
    expect(h.service.userActionRequests[0]!.action).toBe("CLICK_USERNAME_FIELD_AND_SELECT_SAVED_CREDENTIAL");
    expect(h.service.userActionRequests[0]!.interactionCategory).toBe("TWO_STEP_FIELD_AND_CREDENTIAL_SELECTION");
    expect(h.page.focusCalls).toBe(1); // the one agent-driven username field-focus click
  });
});

// ── Submit gate ────────────────────────────────────────────────────────────────────────────────────

describe("adapter — credential-population submit gate", () => {
  it("[12] state stays WAITING before both fields populate", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: false, challengePresent: false }) });
    await startLoggedOut(h);
    const r = await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(r.disposition).toBe("AWAITING_POPULATION");
    expect(h.service.getState(ACCOUNT)).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });

  it("[13] username-only population causes zero submit", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: false, challengePresent: false }) });
    await startLoggedOut(h);
    await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(h.page.submitCalls).toBe(0);
  });

  it("[14] password-only population causes zero submit", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: false, passwordPopulated: true, challengePresent: false }) });
    await startLoggedOut(h);
    await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(h.page.submitCalls).toBe(0);
  });

  it("[15] a challenge causes zero submit + human reconnect", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: true }) });
    await startLoggedOut(h);
    const r = await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(r.disposition).toBe("CHALLENGE");
    expect(h.page.submitCalls).toBe(0);
    expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[16] a post-population form drift causes zero submit", async () => {
    const h = await makeHarness();
    await startLoggedOut(h); // binds the form signature during prepare
    h.page.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false };
    h.page.formShape = { ...ESTABLISHED_FORM, idFieldBucket: "many" }; // drift after population
    const r = await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(r.disposition).toBe("FORM_DRIFT");
    expect(h.page.submitCalls).toBe(0);
    expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[17] both fields populated + consent allows exactly one submit", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }) });
    await startLoggedOut(h);
    const r = await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(r.submitted).toBe(true);
    expect(h.page.submitCalls).toBe(1);
  });

  it("(extra) both populated but missing auto-submit consent → zero submit", async () => {
    const h = await makeHarness({
      consents: { ...ALL_CONSENTS, autoSubmitAfterCredentialSelectionConsent: false },
      configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }),
    });
    await startLoggedOut(h);
    const r = await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(r.disposition).toBe("NO_SUBMIT_CONSENT");
    expect(h.page.submitCalls).toBe(0);
  });

  it("[18] duplicate population observations do not double-submit", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }) });
    await startLoggedOut(h);
    await h.service.probeCredentialSelection(ACCOUNT, NOW);
    const dup = await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(dup.disposition).toBe("IGNORED_NOT_WAITING");
    expect(h.page.submitCalls).toBe(1);
  });
});

// ── Verification / catch-up / separation ───────────────────────────────────────────────────────────

describe("adapter — verification, catch-up, separation", () => {
  it("[19] a successful post-submit verification enters READY", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }) });
    h.page.standingVerdict = "LOGGED_IN"; // post-submit verify
    await startLoggedOut(h);
    await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(h.service.getState(ACCOUNT)).toBe("READY");
  });

  it("[20] a successful verification emits exactly one catch-up request (not executed)", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }) });
    h.page.standingVerdict = "LOGGED_IN";
    await startLoggedOut(h);
    expect(h.service.catchUpRequests).toHaveLength(0); // not READY yet
    await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(h.service.catchUpRequests).toHaveLength(1);
  });

  it("[21] a failed post-submit verification causes no retry", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }) });
    await startLoggedOut(h);
    h.page.standingVerdict = "NOT_LOGGED_IN"; // verify fails
    const verdictCallsBefore = h.page.verdictCalls;
    const r = await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(r.disposition).toBe("VERIFY_FAILED");
    expect(h.page.submitCalls).toBe(1); // one submit, never retried
    expect(h.page.verdictCalls).toBe(verdictCallsBefore + 1); // one verification, no retry loop
    expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[22] emitted data carries only sanitized enums/booleans + a hash-only account ref", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }) });
    h.page.standingVerdict = "LOGGED_IN";
    await startLoggedOut(h);
    const result = await h.service.probeCredentialSelection(ACCOUNT, NOW);

    const accountKeys = ["boundStoreFingerprintHash", "connectionId", "fingerprintSourceCategory"];
    for (const req of h.service.userActionRequests) {
      expect(Object.keys(req).sort()).toEqual(["account", "action", "interactionCategory"]);
      expect(Object.keys(req.account).sort()).toEqual(accountKeys);
    }
    const blob = JSON.stringify({
      userActionRequests: h.service.userActionRequests,
      operationalStates: h.service.operationalStates,
      result,
    });
    // No raw leak artifacts: URLs, profile paths, DOM selectors, or the internal click token.
    // (The action ENUM legitimately contains the word "USERNAME" — that is a sanitized code, not a value.)
    expect(blob).not.toMatch(/https?:\/\//i);
    expect(blob).not.toMatch(/\/Users\/|data-la-|tok-gm|querySelector|\.click\(|eyJ[A-Za-z0-9_-]/);
  });

  it("[23] CapabilityStatus is never changed by the reconnect flow", async () => {
    const h = await makeHarness({ configurePage: (p) => (p.population = { usernamePopulated: true, passwordPopulated: true, challengePresent: false }) });
    h.page.standingVerdict = "LOGGED_IN";
    await startLoggedOut(h);
    await h.service.probeCredentialSelection(ACCOUNT, NOW);
    expect(h.service.getOperationalState(ACCOUNT)?.capabilityStatus).toBe("NEEDS_DISCOVERY");
    for (const s of h.service.operationalStates) expect(s.capabilityStatus).toBe("NEEDS_DISCOVERY");
  });
});

// ── Service-level catch-up integration (M-Agent-1C2) ─────────────────────────────────────────────

/** Models the existing capture→upload leg as ONE SyntheticCycle with counted sub-steps. */
class FakeCaptureUploadCycle implements SyntheticCycle {
  captureCalls = 0;
  uploadCalls = 0;
  outcome: SyntheticCycleOutcome = "SUCCESS";
  async run(): Promise<SyntheticCycleOutcome> {
    this.captureCalls += 1; // the capture/export leg
    this.uploadCalls += 1; // the upload leg
    return this.outcome;
  }
}

interface CatchUpHarness {
  service: LocalAgentReconnectService;
  page: FakePage;
}

/** Build a service wired with an injected catch-up executor; a LOGGED_IN startup reaches READY. */
function makeCatchUpHarness(executor: CatchUpSyncExecutor): CatchUpHarness {
  const page = new FakePage(); // standingVerdict defaults to LOGGED_IN
  const binding = baseBinding();
  const store = new InMemoryLoginModeBindingStore();
  const context: LocalAgentContext = {
    id: "ctx-cu",
    page,
    async close() {
      await page.close();
    },
  };
  const adapter = new LocalAgentChromeAdapter({
    account: ACCOUNT,
    salt: SALT,
    bindingStore: store,
    pageFactory: async () => context,
  });
  const service = new LocalAgentReconnectService(adapter, {
    salt: SALT,
    interactionCategory: binding.reconnectInteractionCategory,
    catchUpExecutor: executor,
  });
  void store.save(binding);
  return { service, page };
}

const CONNECTION = connectionFromBinding(baseBinding(), ALL_CONSENTS);

describe("service — catch-up integration (M-Agent-1C2)", () => {
  it("[S1] service reaches READY and exposes one pending catch-up", async () => {
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(new FakeCaptureUploadCycle()));
    const state = await h.service.start(CONNECTION, NOW);
    expect(state).toBe("READY");
    expect(h.service.catchUpRequests).toHaveLength(1);
  });

  it("[S2] service acknowledgement is idempotent", async () => {
    const cycle = new FakeCaptureUploadCycle();
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(cycle));
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    h.service.acknowledgeCatchUp(ACCOUNT);
    expect(h.service.hasAcknowledgedCatchUp(ACCOUNT)).toBe(true);
    await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(cycle.captureCalls).toBe(1);
  });

  it("[S3]/[S4]/[S5] executes the injected existing-cycle adapter once — capture once, upload once", async () => {
    const cycle = new FakeCaptureUploadCycle();
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(cycle));
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    const r = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(r.disposition).toBe("CATCH_UP_SUCCEEDED");
    expect(r.syncExecuted).toBe(true);
    expect(cycle.captureCalls).toBe(1);
    expect(cycle.uploadCalls).toBe(1);
  });

  it("[S6] duplicate service calls do not invoke capture/upload again", async () => {
    const cycle = new FakeCaptureUploadCycle();
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(cycle));
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    const dup = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(dup.disposition).toBe("SKIPPED_ALREADY_CONSUMED");
    expect(cycle.captureCalls).toBe(1);
    expect(cycle.uploadCalls).toBe(1);
  });

  it("[S7] success returns READY", async () => {
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(new FakeCaptureUploadCycle()));
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    const r = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(r.state).toBe("READY");
    expect(h.service.getState(ACCOUNT)).toBe("READY");
  });

  it("[S8] recoverable failure returns DEGRADED", async () => {
    const cycle = new FakeCaptureUploadCycle();
    cycle.outcome = "UPLOAD_FAILED";
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(cycle));
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    const r = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(r.disposition).toBe("CATCH_UP_FAILED");
    expect(h.service.getState(ACCOUNT)).toBe("DEGRADED");
  });

  it("[S9] session loss returns HUMAN_RECONNECT_REQUIRED", async () => {
    const sessionLostExecutor: CatchUpSyncExecutor = { async execute() { return { kind: "SESSION_LOST" }; } };
    const h = makeCatchUpHarness(sessionLostExecutor);
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    const r = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(r.disposition).toBe("SESSION_LOST");
    expect(h.service.getState(ACCOUNT)).toBe("HUMAN_RECONNECT_REQUIRED");
  });

  it("[S10] no caller can execute catch-up before acknowledgement", async () => {
    const cycle = new FakeCaptureUploadCycle();
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(cycle));
    await h.service.start(CONNECTION, NOW);
    const r = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(r.disposition).toBe("SKIPPED_CATCH_UP_NOT_ACKNOWLEDGED");
    expect(cycle.captureCalls).toBe(0);
  });

  it("[S11] catch-up cannot run while reconnecting", async () => {
    const cycle = new FakeCaptureUploadCycle();
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(cycle));
    h.page.standingVerdict = "NOT_LOGGED_IN"; // startup → assisted reconnect
    h.page.verdictQueue = ["NOT_LOGGED_IN"];
    await h.service.start(CONNECTION, NOW); // → WAITING_FOR_CREDENTIAL_SELECTION
    h.service.acknowledgeCatchUp(ACCOUNT);
    const r = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(r.disposition).toBe("SKIPPED_NOT_READY");
    expect(cycle.captureCalls).toBe(0);
  });

  it("[S12] CapabilityStatus (and schema/dedup) remain unchanged through the service catch-up", async () => {
    const cycle = new FakeCaptureUploadCycle();
    cycle.outcome = "DOWNLOAD_FAILED";
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(cycle));
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    expect(h.service.getOperationalState(ACCOUNT)?.capabilityStatus).toBe("NEEDS_DISCOVERY");
    for (const s of h.service.operationalStates) expect(s.capabilityStatus).toBe("NEEDS_DISCOVERY");
  });

  it("[S13] public catch-up results + emitted operational states stay sanitized", async () => {
    const h = makeCatchUpHarness(syntheticCycleCatchUpExecutor(new FakeCaptureUploadCycle()));
    await h.service.start(CONNECTION, NOW);
    h.service.acknowledgeCatchUp(ACCOUNT);
    const result = await h.service.runAcknowledgedCatchUp(ACCOUNT, NOW);
    const blob = JSON.stringify({ result, operational: h.service.operationalStates });
    expect(blob).not.toMatch(/https?:\/\//i);
    expect(blob).not.toMatch(/\/Users\/|\.xlsx|data-la-|querySelector|리뷰글번호|eyJ[A-Za-z0-9_-]/);
    for (const s of h.service.operationalStates) {
      expect(Object.keys(s.accountRef).sort()).toEqual(["boundStoreFingerprintHash", "connectionId", "fingerprintSourceCategory"]);
    }
  });

  it("(extra) runAcknowledgedCatchUp throws if no executor was injected", async () => {
    const page = new FakePage();
    const store = new InMemoryLoginModeBindingStore();
    const context: LocalAgentContext = { id: "ctx-x", page, async close() { await page.close(); } };
    const adapter = new LocalAgentChromeAdapter({ account: ACCOUNT, salt: SALT, bindingStore: store, pageFactory: async () => context });
    const service = new LocalAgentReconnectService(adapter, { salt: SALT, interactionCategory: "TWO_STEP_FIELD_AND_CREDENTIAL_SELECTION" });
    await service.start(CONNECTION, NOW);
    service.acknowledgeCatchUp(ACCOUNT);
    await expect(service.runAcknowledgedCatchUp(ACCOUNT, NOW)).rejects.toThrow(/no catch-up sync executor/);
  });
});
