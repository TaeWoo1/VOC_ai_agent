import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  initialProgressiveState,
  reduceProgressiveReconnect,
  initialFormStrategyForMode,
  boundedBootstrapPlan,
  dedicatedProfileIdFor,
  sanitizedEnvironmentKey,
  interpretAutoReconnectCapability,
  isReconnectIncidentActive,
  ProgressiveReconnectManager,
  MIN_VERIFIED_ATTEMPTS,
  type ProgressiveReconnectConnection,
  type ProgressiveReconnectState,
  type ProgressiveEvent,
  type ProgressiveAction,
  type UserActionCategory,
  type ZeroTouchOutcomeRecord,
} from "../../src/agent/progressive-reconnect";
import type { SanitizedAccountRef, InspectionVerdict } from "../../src/agent/local-agent-state";

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
function obs(usernamePopulated: boolean, passwordPopulated: boolean, challengePresent = false, formSignatureMatch = true) {
  return { usernamePopulated, passwordPopulated, challengePresent, formSignatureMatch };
}
function drive(c: ProgressiveReconnectConnection, events: ProgressiveEvent[], from: ProgressiveReconnectState = initialProgressiveState) {
  let state = from;
  let last: { next: ProgressiveReconnectState; actions: ProgressiveAction[]; accepted: boolean } = { next: state, actions: [], accepted: true };
  const log: ProgressiveAction[] = [];
  for (const e of events) {
    last = reduceProgressiveReconnect(state, e, c);
    state = last.next;
    log.push(...last.actions);
  }
  return { state, actions: last.actions, accepted: last.accepted, log };
}
const kinds = (as: ProgressiveAction[]) => as.map((a) => a.kind);
const userActions = (as: ProgressiveAction[]) =>
  as.filter((a): a is Extract<ProgressiveAction, { kind: "EMIT_USER_ACTION" }> => a.kind === "EMIT_USER_ACTION").map((a) => a.action);
function rec(over: Partial<ZeroTouchOutcomeRecord>): ZeroTouchOutcomeRecord {
  return { attemptCount: 0, successCount: 0, failureCount: 0, challengeOrDeviceAuthCount: 0, environmentKeys: [], ...over };
}
const ENV_A = sanitizedEnvironmentKey(["A"]);
const ENV_B = sanitizedEnvironmentKey(["B"]);
const sameEnv = (n: number): string[] => Array.from({ length: n }, () => ENV_A);

const LOGGED_IN: InspectionVerdict = "LOGGED_IN";
const OUT: InspectionVerdict = "NOT_LOGGED_IN";
// reach PREPARING_RECONNECT (logged out, auto path) for a given connection
const toPreparing = (c: ProgressiveReconnectConnection) => drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }]).state;

// ── core ladder (1–18) ──────────────────────────────────────────────────────────────────────────
describe("progressive reconnect — core ladder", () => {
  it("1: existing session → READY", () => {
    const r = drive(conn(), [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN }]);
    expect(r.state.phase).toBe("READY");
    expect(r.state.path).toBe("EXISTING_SESSION");
  });
  it("2: existing session emits exactly one catch-up", () => {
    const r = drive(conn(), [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN }]);
    expect(kinds(r.actions)).toEqual(["REQUEST_CATCH_UP"]);
    expect(r.log.filter((a) => a.kind === "REQUEST_CATCH_UP")).toHaveLength(1);
  });
  it("3: ESM_PLUS uses DIRECT", () => expect(initialFormStrategyForMode("ESM_PLUS")).toBe("DIRECT"));
  it("4: GMARKET uses DOCUMENT_START_BOOTSTRAP", () => expect(initialFormStrategyForMode("GMARKET")).toBe("DOCUMENT_START_BOOTSTRAP"));
  it("5: AUCTION uses DOCUMENT_START_BOOTSTRAP", () => expect(initialFormStrategyForMode("AUCTION")).toBe("DOCUMENT_START_BOOTSTRAP"));
  it("6: bootstrap is bounded and self-stopping", () => {
    const boot = boundedBootstrapPlan("DOCUMENT_START_BOOTSTRAP");
    expect(boot.requiresBootstrap).toBe(true);
    expect(boot.selfStopping).toBe(true);
    expect(boot.maxAttempts).toBeGreaterThan(0);
    expect(Number.isFinite(boot.maxAttempts)).toBe(true);
    expect(boot.stopConditions).toContain("ATTEMPT_BUDGET_EXHAUSTED");
    const direct = boundedBootstrapPlan("DIRECT");
    expect(direct.requiresBootstrap).toBe(false);
    expect(direct.maxAttempts).toBe(0);
    expect(direct.selfStopping).toBe(true);
  });
  it("7: both fields populated → exactly one submit → READY + one catch-up", () => {
    const c = conn();
    const a = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }]);
    expect(a.state.phase).toBe("PREPARING_RECONNECT");
    expect(a.actions).toEqual([{ kind: "ESTABLISH_LOGIN_MODE", strategy: "DOCUMENT_START_BOOTSTRAP" }]);
    const b = drive(c, [{ kind: "FORM_OBSERVED", observation: obs(true, true) }], a.state);
    expect(b.state.phase).toBe("VERIFYING_LOGIN");
    expect(b.state.path).toBe("ZERO_TOUCH_AUTOFILL");
    expect(kinds(b.actions)).toEqual(["SUBMIT_LOGIN_ONCE"]);
    const d = drive(c, [{ kind: "SUBMIT_VERIFIED", verdict: LOGGED_IN }], b.state);
    expect(d.state.phase).toBe("READY");
    expect(kinds(d.actions)).toEqual(["REQUEST_CATCH_UP"]);
  });
  it("8: username missing → zero submit + assisted (ENTER_MISSING_USERNAME)", () => {
    const r = drive(conn(), [{ kind: "FORM_OBSERVED", observation: obs(false, true) }], toPreparing(conn()));
    expect(r.state.phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(r.state.path).toBe("ASSISTED_CREDENTIAL_SELECTION");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
    expect(userActions(r.actions)).toEqual(["ENTER_MISSING_USERNAME"]);
  });
  it("9: password missing → zero submit + assisted (SELECT_SAVED_CREDENTIAL)", () => {
    const r = drive(conn(), [{ kind: "FORM_OBSERVED", observation: obs(true, false) }], toPreparing(conn()));
    expect(r.state.phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
    expect(userActions(r.actions)).toEqual(["SELECT_SAVED_CREDENTIAL"]);
  });
  it("10: both missing → zero submit + assisted", () => {
    const r = drive(conn(), [{ kind: "FORM_OBSERVED", observation: obs(false, false) }], toPreparing(conn()));
    expect(r.state.phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
    expect(userActions(r.actions)).toEqual(["SELECT_SAVED_CREDENTIAL"]);
  });
  it("11: challenge → human reconnect", () => {
    const r = drive(conn(), [{ kind: "FORM_OBSERVED", observation: obs(true, true, true, true) }], toPreparing(conn()));
    expect(r.state.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(r.state.path).toBe("MANUAL_LOGIN");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
    expect(userActions(r.actions)).toEqual(["COMPLETE_ADDITIONAL_AUTHENTICATION"]);
  });
  it("12: signature drift → human reconnect, zero submit", () => {
    const r = drive(conn(), [{ kind: "FORM_OBSERVED", observation: obs(true, true, false, false) }], toPreparing(conn()));
    expect(r.state.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(r.state.path).toBe("MANUAL_LOGIN");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
    expect(userActions(r.actions)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
  });
  it("13: duplicate observations do not double-submit", () => {
    const c = conn();
    const s = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }, { kind: "FORM_OBSERVED", observation: obs(true, true) }]).state;
    expect(s.phase).toBe("VERIFYING_LOGIN");
    const dup = reduceProgressiveReconnect(s, { kind: "FORM_OBSERVED", observation: obs(true, true) }, c);
    expect(dup.accepted).toBe(false);
    expect(dup.next).toBe(s);
    expect(kinds(dup.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
  });
  it("14: automatic attempt occurs at most once per startup", () => {
    const c = conn();
    const s1 = drive(c, [
      { kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT },
      { kind: "FORM_OBSERVED", observation: obs(false, true) },
      { kind: "HUMAN_COMPLETED", action: "ENTER_MISSING_USERNAME" },
    ]).state;
    expect(s1.phase).toBe("INSPECTING_SESSION");
    const r = drive(c, [{ kind: "SESSION_INSPECTED", verdict: OUT }], s1);
    expect(r.state.phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    expect(kinds(r.actions)).not.toContain("ESTABLISH_LOGIN_MODE");
  });
  it("15: session-loss permits one new automatic attempt", () => {
    const c = conn();
    const ready = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN }]).state;
    const lost = drive(c, [{ kind: "SESSION_LOST" }], ready);
    expect(lost.state.phase).toBe("INSPECTING_SESSION");
    expect(lost.state.attemptConsumed).toBe(false);
    const r = drive(c, [{ kind: "SESSION_INSPECTED", verdict: OUT }], lost.state);
    expect(kinds(r.actions)).toContain("ESTABLISH_LOGIN_MODE");
    expect(r.state.phase).toBe("PREPARING_RECONNECT");
  });
  it("16: failed attempt does not automatically retry", () => {
    const c = conn();
    const s = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }, { kind: "FORM_OBSERVED", observation: obs(true, true) }]).state;
    const r = drive(c, [{ kind: "SUBMIT_VERIFIED", verdict: OUT }], s);
    expect(r.state.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
    expect(kinds(r.actions)).not.toContain("BEGIN_INSPECTION");
    expect(kinds(r.actions)).not.toContain("ESTABLISH_LOGIN_MODE");
  });
  it("17: human completion triggers exactly one fresh inspection", () => {
    const c = conn();
    const waiting = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }, { kind: "FORM_OBSERVED", observation: obs(false, false) }]).state;
    expect(waiting.phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
    const r = drive(c, [{ kind: "HUMAN_COMPLETED", action: "SELECT_SAVED_CREDENTIAL" }], waiting);
    expect(r.state.phase).toBe("INSPECTING_SESSION");
    expect(kinds(r.actions)).toEqual(["BEGIN_INSPECTION"]);
  });
  it("18: human completion success → READY and one catch-up", () => {
    const c = conn();
    const inspecting = drive(c, [
      { kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT },
      { kind: "FORM_OBSERVED", observation: obs(false, false) },
      { kind: "HUMAN_COMPLETED", action: "SELECT_SAVED_CREDENTIAL" },
    ]).state;
    const r = drive(c, [{ kind: "SESSION_INSPECTED", verdict: LOGGED_IN }], inspecting);
    expect(r.state.phase).toBe("READY");
    expect(kinds(r.actions)).toEqual(["REQUEST_CATCH_UP"]);
  });
});

// ── isolation, sanitation, source guard (19, 20, 22, 23) ─────────────────────────────────────────
describe("progressive reconnect — isolation & sanitation", () => {
  it("20: one connection failure does not affect another", () => {
    const mgr = new ProgressiveReconnectManager();
    const a = conn({ account: acct("conn-A") });
    const b = conn({ account: acct("conn-B") });
    mgr.dispatch(b, { kind: "START" });
    mgr.dispatch(b, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN });
    mgr.dispatch(a, { kind: "START" });
    mgr.dispatch(a, { kind: "SESSION_INSPECTED", verdict: OUT });
    mgr.dispatch(a, { kind: "FORM_OBSERVED", observation: obs(true, true, true, true) });
    expect(mgr.getState("conn-A").phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(mgr.getState("conn-B").phase).toBe("READY");
  });
  it("22: module never touches CapabilityStatus / schema / dedup (source guard)", () => {
    const src = readFileSync(new URL("../../src/agent/progressive-reconnect.ts", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toContain("CapabilityStatus");
    expect(code).not.toContain("schemaMappingConfirmed");
    expect(code).not.toContain("dedupKeyConfirmed");
  });
  it("23: emitted data is sanitized (enums/booleans only)", () => {
    const c = conn();
    const KNOWN_ACTIONS = new Set(["BEGIN_INSPECTION", "ESTABLISH_LOGIN_MODE", "SUBMIT_LOGIN_ONCE", "REQUEST_CATCH_UP", "EMIT_USER_ACTION"]);
    const KNOWN_USER = new Set<UserActionCategory>(["SELECT_SAVED_CREDENTIAL", "ENTER_MISSING_USERNAME", "COMPLETE_MANUAL_LOGIN", "COMPLETE_ADDITIONAL_AUTHENTICATION"]);
    const flow = drive(c, [
      { kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT },
      { kind: "FORM_OBSERVED", observation: obs(true, true) }, { kind: "SUBMIT_VERIFIED", verdict: LOGGED_IN },
    ]);
    for (const a of flow.log) {
      expect(KNOWN_ACTIONS.has(a.kind)).toBe(true);
      if (a.kind === "EMIT_USER_ACTION") expect(KNOWN_USER.has(a.action)).toBe(true);
    }
    const serialized = JSON.stringify({ state: flow.state, actions: flow.log });
    for (const bad of ["http", "cookie", "token", "queryselector", "/users/", ".com"]) {
      expect(serialized.toLowerCase()).not.toContain(bad);
    }
  });
});

// ── 19 + 4: dedicated profile identity safety ─────────────────────────────────────────────────────
describe("progressive reconnect — dedicated profile identity", () => {
  const RX = /^esm-agent-[0-9a-f]{24}$/;
  it("19: connection-scoped, deterministic, filesystem-safe", () => {
    expect(dedicatedProfileIdFor(acct("conn-A"))).toMatch(RX);
    expect(dedicatedProfileIdFor(acct("conn-A"))).toBe(dedicatedProfileIdFor(acct("conn-A")));
    const c = conn();
    expect(c.dedicatedProfileId).toBe(dedicatedProfileIdFor(c.account));
  });
  it("two distinct connections do not collide", () => {
    expect(dedicatedProfileIdFor(acct("conn-A"))).not.toBe(dedicatedProfileIdFor(acct("conn-B")));
  });
  it("path-traversal-shaped input → safe hashed id (no .. or separators, raw not recoverable)", () => {
    const id = dedicatedProfileIdFor(acct("../../../etc/passwd"));
    expect(id).toMatch(RX);
    expect(id).not.toContain("..");
    expect(id).not.toContain("/");
    expect(id).not.toContain("passwd");
  });
  it("slash / backslash input → safe hashed id", () => {
    const id = dedicatedProfileIdFor(acct("a/b\\c/..\\d"));
    expect(id).toMatch(RX);
    expect(id).not.toMatch(/[\/\\]/);
  });
  it("unicode / PII-shaped input → safe hashed id, raw not present", () => {
    const id = dedicatedProfileIdFor(acct("판매자-🔥-seller@example.com"));
    expect(id).toMatch(RX);
    expect(id).not.toContain("seller");
    expect(id).not.toContain("@");
    expect(id).not.toContain("example");
  });
  it("sanitizedEnvironmentKey is deterministic, opaque, and distinct per input", () => {
    const a = sanitizedEnvironmentKey(["chrome-150", "darwin", "profile-h"]);
    expect(a).toMatch(/^env-[0-9a-f]{24}$/);
    expect(sanitizedEnvironmentKey(["chrome-150", "darwin", "profile-h"])).toBe(a);
    expect(sanitizedEnvironmentKey(["chrome-151", "darwin", "profile-h"])).not.toBe(a);
    expect(a).not.toContain("chrome");
    expect(a).not.toContain("darwin");
  });
  it("environment-key encoding is unambiguous: ['ab','c'] and ['a','bc'] differ", () => {
    expect(sanitizedEnvironmentKey(["ab", "c"])).not.toBe(sanitizedEnvironmentKey(["a", "bc"]));
  });
});

// ── 21 + hardening: capability evidence policy (no premature VERIFIED) ────────────────────────────
describe("progressive reconnect — capability evidence policy", () => {
  it("zero observations → UNKNOWN", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 0 }))).toBe("UNKNOWN");
  });
  it("1/1 success → CONDITIONAL (a single success is never VERIFIED)", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 1, successCount: 1, environmentKeys: sameEnv(1) }))).toBe("CONDITIONAL");
  });
  it("4/4 success → CONDITIONAL (below the minimum)", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 4, successCount: 4, environmentKeys: sameEnv(4) }))).toBe("CONDITIONAL");
  });
  it("5/5 success, same environment → VERIFIED", () => {
    expect(MIN_VERIFIED_ATTEMPTS).toBe(5);
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 5, environmentKeys: sameEnv(5) }))).toBe("VERIFIED");
  });
  it("4/5 success → CONDITIONAL (mixed)", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 4, failureCount: 1, environmentKeys: sameEnv(5) }))).toBe("CONDITIONAL");
  });
  it("5/5 success but mixed environment keys → not VERIFIED (CONDITIONAL)", () => {
    const env = [ENV_A, ENV_A, ENV_A, ENV_A, ENV_B];
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 5, environmentKeys: env }))).toBe("CONDITIONAL");
  });
  it("device-auth / challenge observation → not VERIFIED (CONDITIONAL)", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 4, challengeOrDeviceAuthCount: 1, environmentKeys: sameEnv(5) }))).toBe("CONDITIONAL");
  });
  it("current 3/5 evidence → CONDITIONAL", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 3, failureCount: 2, environmentKeys: sameEnv(5) }))).toBe("CONDITIONAL");
  });
  it("all failures with evidence → ASSISTED_ONLY", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 4, successCount: 0, failureCount: 4, environmentKeys: sameEnv(4) }))).toBe("ASSISTED_ONLY");
  });
  it("all blocked by device-auth (no clean success) → ASSISTED_ONLY", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 3, successCount: 0, challengeOrDeviceAuthCount: 3, environmentKeys: sameEnv(3) }))).toBe("ASSISTED_ONLY");
  });
  // malformed / inconsistent evidence must never produce VERIFIED
  it("malformed: 5/5 but only one environment key → not VERIFIED", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 5, environmentKeys: [ENV_A] }))).toBe("CONDITIONAL");
  });
  it("malformed: successCount 6 of 5 → not VERIFIED", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 6, environmentKeys: sameEnv(5) }))).not.toBe("VERIFIED");
  });
  it("malformed: negative count → not VERIFIED", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: -1, failureCount: 0, environmentKeys: sameEnv(5) }))).not.toBe("VERIFIED");
  });
  it("malformed: fractional count → not VERIFIED", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 2.5, environmentKeys: sameEnv(5) }))).not.toBe("VERIFIED");
  });
  it("malformed: outcome total greater than attemptCount → not VERIFIED", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 3, failureCount: 3, environmentKeys: sameEnv(5) }))).not.toBe("VERIFIED");
  });
  it("malformed: outcome total less than attemptCount → not VERIFIED", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 2, failureCount: 1, environmentKeys: sameEnv(5) }))).not.toBe("VERIFIED");
  });
  it("malformed: bad environment-key format → not VERIFIED", () => {
    const env = ["not-valid", "also-bad", "env-XYZ", ENV_A, ENV_A];
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 5, environmentKeys: env }))).not.toBe("VERIFIED");
  });
  it("valid 5/5 same-environment evidence → VERIFIED", () => {
    expect(interpretAutoReconnectCapability(rec({ attemptCount: 5, successCount: 5, environmentKeys: sameEnv(5) }))).toBe("VERIFIED");
  });
});

// ── incident-scoped SESSION_LOST + START/RESTART idempotency ──────────────────────────────────────
describe("progressive reconnect — incident semantics", () => {
  it("duplicate SESSION_LOST while inspecting is a safe no-op", () => {
    const c = conn();
    const ready = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN }]).state;
    const t1 = reduceProgressiveReconnect(ready, { kind: "SESSION_LOST" }, c);
    expect(t1.accepted).toBe(true);
    expect(t1.next.phase).toBe("INSPECTING_SESSION");
    const t2 = reduceProgressiveReconnect(t1.next, { kind: "SESSION_LOST" }, c);
    expect(t2.accepted).toBe(false);
    expect(t2.next).toBe(t1.next);
    expect(t2.actions).toHaveLength(0);
  });
  it("duplicate SESSION_LOST while waiting / verifying / human-required is a no-op", () => {
    const c = conn();
    for (const s of [
      drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }]).state, // PREPARING_RECONNECT
      drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }, { kind: "FORM_OBSERVED", observation: obs(false, false) }]).state, // WAITING
      drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }, { kind: "FORM_OBSERVED", observation: obs(true, true) }]).state, // VERIFYING
      drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }, { kind: "FORM_OBSERVED", observation: obs(true, true, true) }]).state, // HUMAN
    ]) {
      const t = reduceProgressiveReconnect(s, { kind: "SESSION_LOST" }, c);
      expect(t.accepted).toBe(false);
      expect(t.next).toBe(s);
    }
  });
  it("one automatic attempt maximum within an incident (via SESSION_LOST)", () => {
    const c = conn();
    const ready = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN }]).state;
    const afterAttempt = drive(c, [
      { kind: "SESSION_LOST" }, { kind: "SESSION_INSPECTED", verdict: OUT }, // attempt consumed
      { kind: "FORM_OBSERVED", observation: obs(false, true) }, { kind: "HUMAN_COMPLETED", action: "ENTER_MISSING_USERNAME" },
    ], ready).state;
    const r = drive(c, [{ kind: "SESSION_INSPECTED", verdict: OUT }], afterAttempt);
    expect(kinds(r.actions)).not.toContain("ESTABLISH_LOGIN_MODE"); // no second automatic attempt
    expect(r.state.phase).toBe("WAITING_FOR_CREDENTIAL_SELECTION");
  });
  it("a later SESSION_LOST after recovery to READY opens one new incident", () => {
    const c = conn();
    const ready2 = drive(c, [
      { kind: "SESSION_LOST" }, { kind: "SESSION_INSPECTED", verdict: OUT },
      { kind: "FORM_OBSERVED", observation: obs(true, true) }, { kind: "SUBMIT_VERIFIED", verdict: LOGGED_IN }, // back to READY
    ], drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN }]).state).state;
    expect(ready2.phase).toBe("READY");
    const r = drive(c, [{ kind: "SESSION_LOST" }], ready2);
    expect(r.accepted).toBe(true);
    expect(r.state.phase).toBe("INSPECTING_SESSION");
    expect(r.state.attemptConsumed).toBe(false);
    expect(kinds(r.actions)).toEqual(["BEGIN_INSPECTION"]);
  });
  it("START / RESTART while an incident is active does not duplicate actions or reset guards", () => {
    const c = conn();
    const mid = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }, { kind: "FORM_OBSERVED", observation: obs(true, true) }]).state; // VERIFYING, submitEmitted
    expect(isReconnectIncidentActive(mid)).toBe(true);
    for (const e of [{ kind: "START" } as const, { kind: "RESTART" } as const]) {
      const t = reduceProgressiveReconnect(mid, e, c);
      expect(t.accepted).toBe(false);
      expect(t.next).toBe(mid);
      expect(t.next.submitEmitted).toBe(true);
      expect(t.next.attemptConsumed).toBe(true);
      expect(kinds(t.actions)).not.toContain("BEGIN_INSPECTION");
    }
  });
  it("START from STOPPED or RESTART from READY boots a fresh inspection", () => {
    const c = conn();
    const fromStopped = reduceProgressiveReconnect(initialProgressiveState, { kind: "START" }, c);
    expect(fromStopped.next.phase).toBe("INSPECTING_SESSION");
    expect(kinds(fromStopped.actions)).toEqual(["BEGIN_INSPECTION"]);
    const ready = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: LOGGED_IN }]).state;
    const restart = reduceProgressiveReconnect(ready, { kind: "RESTART" }, c);
    expect(restart.next.phase).toBe("INSPECTING_SESSION");
    expect(restart.next.attemptConsumed).toBe(false);
    expect(kinds(restart.actions)).toEqual(["BEGIN_INSPECTION"]);
  });
});

// ── consent-disabled paths ────────────────────────────────────────────────────────────────────────
describe("progressive reconnect — consent-disabled paths", () => {
  it("autoReconnectConsent:false → no auto path, human reconnect, zero submit", () => {
    const c = conn({ autoReconnectConsent: false });
    const r = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }]);
    expect(r.state.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(r.state.path).toBe("MANUAL_LOGIN");
    expect(userActions(r.actions)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
    expect(kinds(r.log)).not.toContain("ESTABLISH_LOGIN_MODE");
    expect(kinds(r.log)).not.toContain("SUBMIT_LOGIN_ONCE");
  });
  it("autoSubmitConsent:false + both populated → HUMAN_RECONNECT_REQUIRED / MANUAL_LOGIN, zero submit", () => {
    const c = conn({ autoSubmitConsent: false });
    const r = drive(c, [{ kind: "FORM_OBSERVED", observation: obs(true, true) }], toPreparing(c));
    expect(r.state.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(r.state.path).toBe("MANUAL_LOGIN");
    expect(r.state.pendingUserAction).toBe("COMPLETE_MANUAL_LOGIN");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
    expect(userActions(r.actions)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
    // HUMAN_COMPLETED → exactly one fresh inspection; the automatic attempt is NOT reopened
    const after = drive(c, [{ kind: "HUMAN_COMPLETED", action: "COMPLETE_MANUAL_LOGIN" }], r.state);
    expect(after.state.phase).toBe("INSPECTING_SESSION");
    expect(kinds(after.actions)).toEqual(["BEGIN_INSPECTION"]);
    const reinspect = drive(c, [{ kind: "SESSION_INSPECTED", verdict: OUT }], after.state);
    expect(kinds(reinspect.actions)).not.toContain("ESTABLISH_LOGIN_MODE");
  });
  it("assistedReconnectConsent:false + field missing → manual login, no saved-credential request, zero submit", () => {
    const c = conn({ assistedReconnectConsent: false });
    const r = drive(c, [{ kind: "FORM_OBSERVED", observation: obs(false, true) }], toPreparing(c));
    expect(r.state.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(userActions(r.actions)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
    expect(userActions(r.actions)).not.toContain("SELECT_SAVED_CREDENTIAL");
    expect(kinds(r.actions)).not.toContain("SUBMIT_LOGIN_ONCE");
  });
  it("all three consents false → human reconnect, zero submit, no automatic actions", () => {
    const c = conn({ autoReconnectConsent: false, autoSubmitConsent: false, assistedReconnectConsent: false });
    const r = drive(c, [{ kind: "START" }, { kind: "SESSION_INSPECTED", verdict: OUT }]);
    expect(r.state.phase).toBe("HUMAN_RECONNECT_REQUIRED");
    expect(userActions(r.actions)).toEqual(["COMPLETE_MANUAL_LOGIN"]);
    expect(kinds(r.log)).not.toContain("ESTABLISH_LOGIN_MODE");
    expect(kinds(r.log)).not.toContain("SUBMIT_LOGIN_ONCE");
  });
});
