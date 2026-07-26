import { describe, expect, it } from "vitest";
import {
  isReadyToWork,
  readinessObservation,
  singleActionForReadiness,
  unobservedReadiness,
  type ReadinessAction,
  type SessionReadinessObservation,
  type SessionReadinessState,
} from "../../../../contracts/session-readiness/v1/index";

const ALL_STATES: SessionReadinessState[] = [
  "READY",
  "LOGIN_REQUIRED",
  "TWO_FACTOR_REQUIRED",
  "ACCOUNT_AMBIGUOUS",
  "EXPIRED",
  "UNOBSERVED_EXTERNAL",
];

describe("session-readiness contract — states and readiness", () => {
  it("only READY is workable; every other state asks the seller for something first", () => {
    for (const state of ALL_STATES) {
      expect(isReadyToWork(state)).toBe(state === "READY");
    }
  });
});

describe("session-readiness contract — the single action per state", () => {
  it("maps every state to exactly one action, never a menu", () => {
    const expected: Record<SessionReadinessState, ReadinessAction> = {
      READY: "NONE",
      LOGIN_REQUIRED: "LOG_IN",
      TWO_FACTOR_REQUIRED: "COMPLETE_AUTH_CHALLENGE",
      ACCOUNT_AMBIGUOUS: "SELECT_ACCOUNT",
      EXPIRED: "LOG_IN",
      UNOBSERVED_EXTERNAL: "NONE",
    };
    for (const state of ALL_STATES) {
      expect(singleActionForReadiness(state)).toBe(expected[state]);
    }
  });

  it("only READY and UNOBSERVED_EXTERNAL offer no action; every actionable state offers exactly one", () => {
    for (const state of ALL_STATES) {
      const action = singleActionForReadiness(state);
      const shouldBeSilent = state === "READY" || state === "UNOBSERVED_EXTERNAL";
      expect(action === "NONE").toBe(shouldBeSilent);
    }
  });
});

describe("session-readiness contract — observation builder", () => {
  it("attaches the canonical action so it can never drift from the state", () => {
    const obs = readinessObservation("naver", "TWO_FACTOR_REQUIRED", "BEFORE_WORK");
    expect(obs).toEqual({
      channelCode: "naver",
      state: "TWO_FACTOR_REQUIRED",
      reason: "BEFORE_WORK",
      action: "COMPLETE_AUTH_CHALLENGE",
    });
  });

  it("carries only sanitized enums — a channel code and three enums, nothing else", () => {
    const obs: SessionReadinessObservation = readinessObservation("coupang", "LOGIN_REQUIRED", "AGENT_START");
    expect(Object.keys(obs).sort()).toEqual(["action", "channelCode", "reason", "state"]);
    expect(typeof obs.channelCode).toBe("string");
  });

  it("an unobserved channel is a first-class not-seen with no action, not a guessed READY", () => {
    const obs = unobservedReadiness("cafe24");
    expect(obs.state).toBe("UNOBSERVED_EXTERNAL");
    expect(obs.action).toBe("NONE");
    expect(isReadyToWork(obs.state)).toBe(false);
  });
});
