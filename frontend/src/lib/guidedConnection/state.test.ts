// Guided-connection state-machine unit tests (§18). Pure/node-env — no DOM, no live NAVER.
// Each block ties back to an acceptance criterion in docs/slices/naver-guided-connection.md §17 or the
// discovery/reuse/recovery flows (§discovery). The journey now starts at the saved-credential check, then
// the browser gate (only if no stored key), then a three-path fork (existing app / unknown / new).
import { describe, it, expect } from "vitest";
import {
  INITIAL_STATE,
  actorFor,
  guidedConnectionReducer as reduce,
  isComplete,
  resolveNaverSession,
  resumeFromMilestones,
} from "./state";
import type { GuidedConnectionState, GuidedEvent } from "./types";
import {
  EXISTING_APP_EVENTS,
  HAPPY_PATH_EVENTS,
  INVALID_CREDENTIAL_EVENTS,
  READY_SIGNAL,
  SAVED_CREDENTIAL_REUSE_EVENTS,
  SECRET_LOST_EVENTS,
} from "./fixtures";

const run = (events: GuidedEvent[], from: GuidedConnectionState = INITIAL_STATE): GuidedConnectionState =>
  events.reduce(reduce, from);

/** A READINESS event with sensible defaults (paired, renderer up, logged-in via attestation). */
const readiness = (
  o: Partial<Omit<Extract<GuidedEvent, { type: "READINESS" }>, "type">> = {},
): GuidedEvent => ({
  type: "READINESS",
  agentPaired: true,
  rendererAvailable: true,
  naverSession: "logged_in",
  sessionSource: "attested",
  ...o,
});

/** Entry into the browser gate: the saved-credential check found no stored key. */
const NO_SAVED: GuidedEvent = { type: "SAVED_CREDENTIAL_CHECKED", hasSavedCredential: false };
const gateEntry = reduce(INITIAL_STATE, NO_SAVED); // readiness_checking

describe("INITIAL_STATE", () => {
  it("starts at check_saved_credential (Vault check first, before the browser gate)", () => {
    expect(INITIAL_STATE.phase).toBe("check_saved_credential");
    expect(INITIAL_STATE.milestones).toEqual({ registered: false, tested: false, synced: false });
    expect(INITIAL_STATE.actor).toBe("SELLEROPS_AUTOMATED");
    expect(INITIAL_STATE.path).toBe("unknown");
    expect(INITIAL_STATE.failureReason).toBeNull();
  });
});

describe("saved-credential check (§flow 1)", () => {
  it("a stored key → reuse: straight to the connection test (registered), no re-entry, no gate", () => {
    const s = reduce(INITIAL_STATE, { type: "SAVED_CREDENTIAL_CHECKED", hasSavedCredential: true });
    expect(s.phase).toBe("connection_testing");
    expect(s.milestones.registered).toBe(true);
    expect(s.path).toBe("saved");
  });

  it("no stored key → enter the browser gate", () => {
    expect(gateEntry.phase).toBe("readiness_checking");
    expect(gateEntry.milestones.registered).toBe(false);
  });

  it("a stray sync in check_saved_credential is a no-op (cannot jump ahead, §17.2)", () => {
    const s = reduce(INITIAL_STATE, { type: "SYNC_RESULT", status: "SUCCESS" });
    expect(s).toBe(INITIAL_STATE);
  });
});

describe("readiness gate — fail-closed (§17.3)", () => {
  it("no agent → agent_unavailable", () => {
    const s = reduce(gateEntry, readiness({ agentPaired: false }));
    expect(s.phase).toBe("agent_unavailable");
    expect(s.failureReason).toBe("AGENT_UNAVAILABLE");
  });

  it("agent but no renderer → renderer_unavailable", () => {
    expect(reduce(gateEntry, readiness({ rendererAvailable: false })).phase).toBe("renderer_unavailable");
  });

  it("logged_out → naver_login_required", () => {
    expect(reduce(gateEntry, readiness({ naverSession: "logged_out" })).phase).toBe("naver_login_required");
  });

  it("unknown session fails closed to naver_login_required (never assumes a live session)", () => {
    expect(reduce(gateEntry, readiness({ naverSession: "unknown", sessionSource: "none" })).phase).toBe("naver_login_required");
  });

  it("all clear → application_path_choice (the three-path fork, NOT straight to issuance)", () => {
    const s = reduce(gateEntry, READY_SIGNAL);
    expect(s.phase).toBe("application_path_choice");
    expect(s.failureReason).toBeNull();
  });
});

describe("three-path fork — reuse first, issue only when there is no app (§flow 3/6/7)", () => {
  const fork = reduce(gateEntry, READY_SIGNAL); // application_path_choice

  it("'have' → existing_credential_entry (reuse the app, never a forced new one)", () => {
    const s = reduce(fork, { type: "APPLICATION_PATH", choice: "have" });
    expect(s.phase).toBe("existing_credential_entry");
    expect(s.path).toBe("existing");
  });

  it("'new' → app-absence check FIRST (never straight to issuance): no app → issuance, app found → forced reuse", () => {
    const check = reduce(fork, { type: "APPLICATION_PATH", choice: "new" });
    expect(check.phase).toBe("application_status_unknown"); // must verify the store has no app before issuing
    // app absent → issuance may proceed
    const none = reduce(check, { type: "APPLICATION_LIST_RESULT", found: false });
    expect(none.phase).toBe("account_store_choice_required");
    expect(none.path).toBe("new");
    expect(reduce(none, { type: "ACCOUNT_STORE_RESOLVED" }).phase).toBe("application_issuance");
    // app already exists → forced reuse, NOT a second app
    expect(reduce(check, { type: "APPLICATION_LIST_RESULT", found: true }).phase).toBe("existing_credential_entry");
  });

  it("'unknown' → application_status_unknown; the seller self-checks NAVER's list and reports", () => {
    const unknown = reduce(fork, { type: "APPLICATION_PATH", choice: "unknown" });
    expect(unknown.phase).toBe("application_status_unknown");
    expect(reduce(unknown, { type: "APPLICATION_LIST_RESULT", found: true }).phase).toBe("existing_credential_entry");
    const none = reduce(unknown, { type: "APPLICATION_LIST_RESULT", found: false });
    expect(none.phase).toBe("account_store_choice_required");
    expect(none.path).toBe("new");
  });

  it("cannot skip the path choice: an ACCOUNT_STORE_RESOLVED at the fork is a no-op", () => {
    expect(reduce(fork, { type: "ACCOUNT_STORE_RESOLVED" })).toBe(fork);
  });
});

describe("full journeys → completed only after registered ∧ tested ∧ synced (§12)", () => {
  it("new-app happy path walks to completed", () => {
    const s = run(HAPPY_PATH_EVENTS);
    expect(s.phase).toBe("completed");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: true });
    expect(isComplete(s.milestones)).toBe(true);
  });

  it("existing-app reuse (enter the key) walks to completed", () => {
    const s = run(EXISTING_APP_EVENTS);
    expect(s.phase).toBe("completed");
    expect(s.path).toBe("existing");
  });

  it("saved-credential reuse (no re-entry, no gate) walks to completed", () => {
    const s = run(SAVED_CREDENTIAL_REUSE_EVENTS);
    expect(s.phase).toBe("completed");
    expect(s.path).toBe("saved");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: true });
  });
});

describe("credential recovery when the Secret is lost (§flow 4) — reissue on the existing app, never delete", () => {
  const recovery = run(SECRET_LOST_EVENTS); // credential_recovery_required

  it("an existing-app seller who cannot produce the Secret lands in recovery, not issuance", () => {
    expect(recovery.phase).toBe("credential_recovery_required");
    expect(recovery.failureReason).toBe("SECRET_UNRECOVERABLE");
    expect(recovery.path).toBe("existing");
  });

  it("obtaining the Secret again (re-view or reissue on the SAME app) returns to entry, staying on the existing path", () => {
    const back = reduce(recovery, { type: "SECRET_RECHECKED" });
    expect(back.phase).toBe("existing_credential_entry");
    expect(back.path).toBe("existing"); // never re-routed to a "new" app — there is no delete-and-recreate
  });

  it("recovery never leaves the existing app: an unmodeled event is a no-op (no delete-reissue branch exists)", () => {
    // The former BEGIN_DELETE_REISSUE / CONFIRM_NO_OTHER_PROGRAM / CANCEL_DELETE_REISSUE events are gone;
    // recovery advances ONLY by re-obtaining the Secret. Any other event stays put (fail-closed).
    expect(reduce(recovery, { type: "ISSUANCE_COMPLETE" })).toBe(recovery);
    expect(reduce(recovery, { type: "ACCOUNT_STORE_RESOLVED" })).toBe(recovery);
  });
});

describe("the seller's decisions cannot be skipped (§17.2)", () => {
  it("cannot skip account/store resolution on the new path", () => {
    // new → app-absence check → (no app) account_store_choice_required; issuance must not be skippable here.
    const fork = reduce(reduce(gateEntry, READY_SIGNAL), { type: "APPLICATION_PATH", choice: "new" });
    const store = reduce(fork, { type: "APPLICATION_LIST_RESULT", found: false });
    expect(store.phase).toBe("account_store_choice_required");
    expect(reduce(store, { type: "ISSUANCE_COMPLETE" })).toBe(store); // no-op
  });

  it("cannot skip issuance", () => {
    const issuance = run(HAPPY_PATH_EVENTS.slice(0, 5)); // application_issuance
    expect(issuance.phase).toBe("application_issuance");
    expect(reduce(issuance, { type: "BEGIN_CREDENTIAL_ENTRY" })).toBe(issuance); // no-op
  });
});

describe("test-connection result mapping (§12, §5)", () => {
  const toTest = HAPPY_PATH_EVENTS.slice(0, 9); // reach connection_testing (…CREDENTIAL_REGISTERED)

  it("reaches connection_testing after registration, tested still false", () => {
    const s = run(toTest);
    expect(s.phase).toBe("connection_testing");
    expect(s.milestones).toEqual({ registered: true, tested: false, synced: false });
  });

  it("INVALID_CREDENTIAL bounces back to credential entry, clearing tested (registration kept)", () => {
    const s = run(INVALID_CREDENTIAL_EVENTS);
    expect(s.phase).toBe("sellerops_credential_entry"); // new-app path → new-app entry
    expect(s.failureReason).toBe("INVALID_CREDENTIAL");
    expect(s.milestones).toEqual({ registered: true, tested: false, synced: false });
  });

  it("INVALID_CREDENTIAL on the EXISTING path returns to existing_credential_entry (right entry)", () => {
    const toExistingTest = EXISTING_APP_EVENTS.slice(0, 5); // …CREDENTIAL_REGISTERED on the existing path
    const s = reduce(run(toExistingTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "INVALID_CREDENTIAL" });
    expect(s.phase).toBe("existing_credential_entry");
    expect(s.path).toBe("existing");
  });

  it("PERMISSION_INSUFFICIENT and CALL_ENVIRONMENT_MISMATCH are distinct user states (§5)", () => {
    const perm = reduce(run(toTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "PERMISSION_INSUFFICIENT" });
    expect(perm.phase).toBe("permission_review_required");
    expect(perm.failureReason).toBe("PERMISSION_INSUFFICIENT");
    const env = reduce(run(toTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "CALL_ENVIRONMENT_MISMATCH" });
    expect(env.phase).toBe("call_environment_mismatch");
    // Both re-test after the seller fixes it at NAVER, and a later SUCCESS advances to sync.
    expect(reduce(perm, { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null }).phase).toBe("first_order_sync");
    expect(reduce(env, { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null }).phase).toBe("first_order_sync");
  });

  it("an UNCLASSIFIED failure stays a transient retry on the test step (fail-closed — no guessed cause)", () => {
    const unavailable = reduce(run(toTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "PROVIDER_UNAVAILABLE" });
    expect(unavailable.phase).toBe("connection_testing");
    expect(unavailable.failureReason).toBe("PROVIDER_UNAVAILABLE");
    const temp = reduce(run(toTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "TEMPORARY_PROVIDER_ERROR" });
    expect(temp.failureReason).toBe("TEMPORARY_PROVIDER_ERROR");
    const opaque = reduce(run(toTest), { type: "TEST_RESULT", status: "FAILED", reasonCode: "SOMETHING_NEW" });
    expect(opaque.phase).toBe("connection_testing"); // never invents permission/IP from an unknown code
  });

  it("NOT_CONFIGURED → credential entry; UNSUPPORTED → unsupported_state", () => {
    expect(reduce(run(toTest), { type: "TEST_RESULT", status: "NOT_CONFIGURED", reasonCode: null }).phase).toBe("sellerops_credential_entry");
    expect(reduce(run(toTest), { type: "TEST_RESULT", status: "UNSUPPORTED", reasonCode: null }).phase).toBe("unsupported_state");
  });
});

describe("first sync — 0-count SUCCESS vs failure (§12, §17.9)", () => {
  const toSync = HAPPY_PATH_EVENTS.slice(0, 10); // reach first_order_sync

  it("SUCCESS (incl. zero new orders) → completed", () => {
    expect(reduce(run(toSync), { type: "SYNC_RESULT", status: "SUCCESS" }).phase).toBe("completed");
  });

  it("PARTIAL → completed", () => {
    expect(reduce(run(toSync), { type: "SYNC_RESULT", status: "PARTIAL" }).phase).toBe("completed");
  });

  it("FAILED stays on first_order_sync with a retryable reason — NOT completed", () => {
    const s = reduce(run(toSync), { type: "SYNC_RESULT", status: "FAILED" });
    expect(s.phase).toBe("first_order_sync");
    expect(s.failureReason).toBe("SYNC_FAILED");
  });
});

describe("global regressions preserve milestones for resume (§13)", () => {
  const midJourney = run(HAPPY_PATH_EVENTS.slice(0, 10)); // first_order_sync, registered+tested

  it("AGENT_LOST → agent_unavailable, milestones kept", () => {
    const s = reduce(midJourney, { type: "AGENT_LOST" });
    expect(s.phase).toBe("agent_unavailable");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: false });
  });

  it("UI_DRIFT → recoverable_ui_drift; UNKNOWN_STATE → unsupported_state", () => {
    expect(reduce(midJourney, { type: "UI_DRIFT" }).phase).toBe("recoverable_ui_drift");
    expect(reduce(midJourney, { type: "UNKNOWN_STATE" }).phase).toBe("unsupported_state");
  });
});

describe("READINESS does not clobber journey progress past the gate", () => {
  it("a readiness signal during connection_testing is a no-op (regress only via AGENT_LOST)", () => {
    const testing = run(HAPPY_PATH_EVENTS.slice(0, 9));
    expect(testing.phase).toBe("connection_testing");
    const s = reduce(testing, readiness({ agentPaired: false, rendererAvailable: false, naverSession: "logged_out", sessionSource: "detected" }));
    expect(s).toBe(testing); // unchanged
  });
});

describe("B4 — dedicated-profile session continuity", () => {
  const issuance = run(HAPPY_PATH_EVENTS.slice(0, 5)); // application_issuance (session-sensitive)
  const completed = run(HAPPY_PATH_EVENTS);

  it("resolveNaverSession: live detection outranks attestation, and there is no conflict", () => {
    expect(resolveNaverSession(true, "reconnect_required")).toEqual({ signal: "reconnect_required", source: "detected" });
    expect(resolveNaverSession(false, "logged_in")).toEqual({ signal: "logged_in", source: "detected" });
    expect(resolveNaverSession(true, null)).toEqual({ signal: "logged_in", source: "attested" });
    expect(resolveNaverSession(false, null)).toEqual({ signal: "unknown", source: "none" });
  });

  it("a cold-launched dedicated profile (detected reconnect_required) → naver_reconnect_required, not fatal", () => {
    const s = reduce(gateEntry, readiness({ naverSession: "reconnect_required", sessionSource: "detected" }));
    expect(s.phase).toBe("naver_reconnect_required");
    expect(s.failureReason).toBe("RECONNECT_REQUIRED");
    expect(s.actor).toBe("USER_REQUIRED");
    expect(s.sessionSource).toBe("detected");
  });

  it("attestation cannot clear a DETECTED reconnect; only a detected logged_in clears it → the fork", () => {
    const reconnect = reduce(gateEntry, readiness({ naverSession: "reconnect_required", sessionSource: "detected" }));
    const stillReconnect = reduce(reconnect, readiness({ naverSession: "logged_in", sessionSource: "attested" }));
    expect(stillReconnect.phase).toBe("naver_reconnect_required");
    const cleared = reduce(reconnect, readiness({ naverSession: "logged_in", sessionSource: "detected" }));
    expect(cleared.phase).toBe("application_path_choice");
  });

  it("completed onboarding does not imply permanent login: a later session drop does not un-complete it", () => {
    expect(completed.phase).toBe("completed");
    expect(reduce(completed, { type: "NAVER_RECONNECT_REQUIRED" }).phase).toBe("completed");
    expect(reduce(completed, { type: "NAVER_LOGGED_OUT" }).phase).toBe("completed");
  });

  it("a NAVER session drop regresses ONLY from session-sensitive phases", () => {
    expect(reduce(issuance, { type: "NAVER_LOGGED_OUT" }).phase).toBe("naver_login_required"); // sensitive
    const testing = run(HAPPY_PATH_EVENTS.slice(0, 9)); // connection_testing — backend, not session-sensitive
    expect(reduce(testing, { type: "NAVER_LOGGED_OUT" })).toBe(testing); // no-op
  });
});

describe("resumeFromMilestones (§13)", () => {
  it("maps persisted milestones to the furthest safe phase", () => {
    expect(resumeFromMilestones({ registered: true, tested: true, synced: true }).phase).toBe("completed");
    expect(resumeFromMilestones({ registered: true, tested: true, synced: false }).phase).toBe("first_order_sync");
    expect(resumeFromMilestones({ registered: true, tested: false, synced: false }).phase).toBe("connection_testing");
    // Not yet registered → re-run the saved-credential check from scratch (Vault/agent are live).
    expect(resumeFromMilestones({ registered: false, tested: false, synced: false }).phase).toBe("check_saved_credential");
  });
});

describe("misc invariants", () => {
  it("RESET returns to INITIAL_STATE from anywhere", () => {
    expect(reduce(run(HAPPY_PATH_EVENTS), { type: "RESET" })).toEqual(INITIAL_STATE);
  });

  it("actorFor reflects the §6 boundary, incl. the new phases", () => {
    expect(actorFor("check_saved_credential")).toBe("SELLEROPS_AUTOMATED");
    expect(actorFor("application_path_choice")).toBe("USER_REQUIRED");
    expect(actorFor("existing_credential_entry")).toBe("USER_REQUIRED");
    expect(actorFor("credential_recovery_required")).toBe("USER_REQUIRED");
    expect(actorFor("permission_review_required")).toBe("USER_REQUIRED");
  });

  it("is pure — does not mutate the previous state's milestones", () => {
    const before = run(HAPPY_PATH_EVENTS.slice(0, 8)); // credential_registration
    const snapshot = JSON.stringify(before);
    reduce(before, { type: "CREDENTIAL_REGISTERED" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("only completed and review_export_readiness represent a connected/handoff terminal", () => {
    const completed = run(HAPPY_PATH_EVENTS);
    const handoff = reduce(completed, { type: "CONTINUE_TO_REVIEW_EXPORT" });
    expect(handoff.phase).toBe("review_export_readiness");
    expect(reduce(handoff, { type: "ISSUANCE_COMPLETE" })).toBe(handoff);
  });
});
