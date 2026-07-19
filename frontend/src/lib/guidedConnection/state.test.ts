// Guided-connection state-machine unit tests (§18). Pure/node-env — no DOM, no live NAVER.
// Each block ties back to an acceptance criterion in docs/slices/naver-guided-connection.md §17.
import { describe, it, expect } from "vitest";
import {
  INITIAL_STATE,
  actorFor,
  guidedConnectionReducer as reduce,
  isComplete,
  resumeFromMilestones,
} from "./state";
import type { GuidedConnectionState, GuidedEvent } from "./types";
import {
  HAPPY_PATH_EVENTS,
  INVALID_CREDENTIAL_EVENTS,
  READY_SIGNAL,
} from "./fixtures";

const run = (events: GuidedEvent[], from: GuidedConnectionState = INITIAL_STATE): GuidedConnectionState =>
  events.reduce(reduce, from);

describe("INITIAL_STATE", () => {
  it("starts at readiness_checking with no milestones", () => {
    expect(INITIAL_STATE.phase).toBe("readiness_checking");
    expect(INITIAL_STATE.milestones).toEqual({ registered: false, tested: false, synced: false });
    expect(INITIAL_STATE.actor).toBe("SELLEROPS_AUTOMATED");
    expect(INITIAL_STATE.failureReason).toBeNull();
  });
});

describe("readiness gate — fail-closed (§17.3)", () => {
  it("no agent → agent_unavailable", () => {
    const s = reduce(INITIAL_STATE, { type: "READINESS", agentPaired: false, rendererAvailable: true, naverSession: "logged_in" });
    expect(s.phase).toBe("agent_unavailable");
    expect(s.failureReason).toBe("AGENT_UNAVAILABLE");
  });

  it("agent but no renderer → renderer_unavailable", () => {
    const s = reduce(INITIAL_STATE, { type: "READINESS", agentPaired: true, rendererAvailable: false, naverSession: "logged_in" });
    expect(s.phase).toBe("renderer_unavailable");
  });

  it("logged_out → naver_login_required", () => {
    const s = reduce(INITIAL_STATE, { type: "READINESS", agentPaired: true, rendererAvailable: true, naverSession: "logged_out" });
    expect(s.phase).toBe("naver_login_required");
  });

  it("unknown session fails closed to naver_login_required (never assumes a live session)", () => {
    const s = reduce(INITIAL_STATE, { type: "READINESS", agentPaired: true, rendererAvailable: true, naverSession: "unknown" });
    expect(s.phase).toBe("naver_login_required");
  });

  it("all clear → account_store_choice_required", () => {
    const s = reduce(INITIAL_STATE, READY_SIGNAL);
    expect(s.phase).toBe("account_store_choice_required");
    expect(s.failureReason).toBeNull();
  });
});

describe("happy path → completed only after registered ∧ tested ∧ synced (§12)", () => {
  it("walks the full journey to completed", () => {
    const s = run(HAPPY_PATH_EVENTS);
    expect(s.phase).toBe("completed");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: true });
    expect(isComplete(s.milestones)).toBe(true);
  });

  it("sets registered only after CREDENTIAL_REGISTERED, tested only after TEST SUCCESS", () => {
    const afterRegister = run(HAPPY_PATH_EVENTS.slice(0, 6)); // …CREDENTIAL_REGISTERED
    expect(afterRegister.phase).toBe("connection_testing");
    expect(afterRegister.milestones).toEqual({ registered: true, tested: false, synced: false });
    const afterTest = run(HAPPY_PATH_EVENTS.slice(0, 7)); // …TEST_RESULT SUCCESS
    expect(afterTest.phase).toBe("first_order_sync");
    expect(afterTest.milestones).toEqual({ registered: true, tested: true, synced: false });
  });
});

describe("the seller's decisions cannot be skipped (§17.2)", () => {
  it("a sync success in readiness_checking is a no-op (cannot jump to completed)", () => {
    const s = reduce(INITIAL_STATE, { type: "SYNC_RESULT", status: "SUCCESS" });
    expect(s).toBe(INITIAL_STATE);
    expect(s.phase).not.toBe("completed");
  });

  it("cannot skip account/store resolution", () => {
    const gate = reduce(INITIAL_STATE, READY_SIGNAL); // account_store_choice_required
    const skipped = reduce(gate, { type: "ISSUANCE_COMPLETE" });
    expect(skipped).toBe(gate); // no-op
  });

  it("cannot skip issuance", () => {
    const issuance = run([READY_SIGNAL, { type: "ACCOUNT_STORE_RESOLVED" }]);
    expect(issuance.phase).toBe("application_issuance");
    const skipped = reduce(issuance, { type: "BEGIN_CREDENTIAL_ENTRY" });
    expect(skipped).toBe(issuance); // no-op
  });
});

describe("test-connection result mapping (§12)", () => {
  const toTest = HAPPY_PATH_EVENTS.slice(0, 6); // reach connection_testing

  it("INVALID_CREDENTIAL bounces back to credential entry, clearing tested", () => {
    const s = run(INVALID_CREDENTIAL_EVENTS);
    expect(s.phase).toBe("sellerops_credential_entry");
    expect(s.failureReason).toBe("INVALID_CREDENTIAL");
    expect(s.milestones.tested).toBe(false);
    expect(s.milestones.registered).toBe(true); // registration is not undone
  });

  it("NOT_CONFIGURED routes to credential entry", () => {
    const s = reduce(run(toTest), { type: "TEST_RESULT", status: "NOT_CONFIGURED", reasonCode: null });
    expect(s.phase).toBe("sellerops_credential_entry");
    expect(s.failureReason).toBe("NOT_CONFIGURED");
  });

  it("transient provider errors stay on the test step for retry", () => {
    const unavailable = reduce(run(toTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "PROVIDER_UNAVAILABLE" });
    expect(unavailable.phase).toBe("connection_testing");
    expect(unavailable.failureReason).toBe("PROVIDER_UNAVAILABLE");
    const temp = reduce(run(toTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "TEMPORARY_PROVIDER_ERROR" });
    expect(temp.failureReason).toBe("TEMPORARY_PROVIDER_ERROR");
  });

  it("UNSUPPORTED fails closed to unsupported_state", () => {
    const s = reduce(run(toTest), { type: "TEST_RESULT", status: "UNSUPPORTED", reasonCode: null });
    expect(s.phase).toBe("unsupported_state");
  });
});

describe("first sync — 0-count SUCCESS vs failure (§12, §17.9)", () => {
  const toSync = HAPPY_PATH_EVENTS.slice(0, 7); // reach first_order_sync

  it("SUCCESS (incl. zero new orders) → completed", () => {
    const s = reduce(run(toSync), { type: "SYNC_RESULT", status: "SUCCESS" });
    expect(s.phase).toBe("completed");
  });

  it("PARTIAL → completed", () => {
    const s = reduce(run(toSync), { type: "SYNC_RESULT", status: "PARTIAL" });
    expect(s.phase).toBe("completed");
  });

  it("FAILED stays on first_order_sync with a retryable reason — NOT completed", () => {
    const s = reduce(run(toSync), { type: "SYNC_RESULT", status: "FAILED" });
    expect(s.phase).toBe("first_order_sync");
    expect(s.failureReason).toBe("SYNC_FAILED");
  });
});

describe("global regressions preserve milestones for resume (§13)", () => {
  const midJourney = run(HAPPY_PATH_EVENTS.slice(0, 7)); // first_order_sync, registered+tested

  it("AGENT_LOST → agent_unavailable, milestones kept", () => {
    const s = reduce(midJourney, { type: "AGENT_LOST" });
    expect(s.phase).toBe("agent_unavailable");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: false });
  });

  it("NAVER_LOGGED_OUT → naver_login_required, milestones kept", () => {
    const s = reduce(midJourney, { type: "NAVER_LOGGED_OUT" });
    expect(s.phase).toBe("naver_login_required");
    expect(s.milestones.registered).toBe(true);
  });

  it("UI_DRIFT → recoverable_ui_drift; UNKNOWN_STATE → unsupported_state", () => {
    expect(reduce(midJourney, { type: "UI_DRIFT" }).phase).toBe("recoverable_ui_drift");
    expect(reduce(midJourney, { type: "UNKNOWN_STATE" }).phase).toBe("unsupported_state");
  });
});

describe("READINESS does not clobber journey progress past the gate", () => {
  it("a readiness signal during connection_testing is a no-op (regress only via AGENT_LOST)", () => {
    const testing = run(HAPPY_PATH_EVENTS.slice(0, 6));
    expect(testing.phase).toBe("connection_testing");
    const s = reduce(testing, { type: "READINESS", agentPaired: false, rendererAvailable: false, naverSession: "logged_out" });
    expect(s).toBe(testing); // unchanged
  });
});

describe("resumeFromMilestones (§13)", () => {
  it("maps persisted milestones to the furthest safe phase", () => {
    expect(resumeFromMilestones({ registered: true, tested: true, synced: true }).phase).toBe("completed");
    expect(resumeFromMilestones({ registered: true, tested: true, synced: false }).phase).toBe("first_order_sync");
    expect(resumeFromMilestones({ registered: true, tested: false, synced: false }).phase).toBe("connection_testing");
    expect(resumeFromMilestones({ registered: false, tested: false, synced: false }).phase).toBe("readiness_checking");
  });
});

describe("misc invariants", () => {
  it("RESET returns to INITIAL_STATE from anywhere", () => {
    expect(reduce(run(HAPPY_PATH_EVENTS), { type: "RESET" })).toEqual(INITIAL_STATE);
  });

  it("actorFor reflects the §6 boundary", () => {
    expect(actorFor("naver_login_required")).toBe("USER_REQUIRED");
    expect(actorFor("credential_registration")).toBe("SELLEROPS_AUTOMATED");
    expect(actorFor("sellerops_credential_entry")).toBe("USER_REQUIRED");
  });

  it("is pure — does not mutate the previous state's milestones", () => {
    const before = run(HAPPY_PATH_EVENTS.slice(0, 5)); // credential_registration
    const snapshot = JSON.stringify(before);
    reduce(before, { type: "CREDENTIAL_REGISTERED" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("only completed and review_export_readiness represent a connected/handoff terminal", () => {
    const completed = run(HAPPY_PATH_EVENTS);
    const handoff = reduce(completed, { type: "CONTINUE_TO_REVIEW_EXPORT" });
    expect(handoff.phase).toBe("review_export_readiness");
    // handoff is terminal-ish: an unrelated event is a no-op
    expect(reduce(handoff, { type: "ISSUANCE_COMPLETE" })).toBe(handoff);
  });
});
