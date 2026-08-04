// Guided-connection state-machine unit tests (§18). Pure/node-env — no DOM, no live NAVER.
// Each block ties back to an acceptance criterion in docs/slices/naver-guided-connection.md §17 or the
// discovery/reuse/recovery flows (§discovery). The journey is Local-Agent-free: it starts at the
// saved-credential check and, with no stored key, goes STRAIGHT to the three-path fork — there is NO
// readiness/agent/renderer/NAVER-login gate.
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
  EXISTING_APP_EVENTS,
  HAPPY_PATH_EVENTS,
  INVALID_CREDENTIAL_EVENTS,
  SAVED_CREDENTIAL_REUSE_EVENTS,
  SAVED_KEY_INCOMPLETE_EVENTS,
  SECRET_LOST_EVENTS,
} from "./fixtures";

const run = (events: GuidedEvent[], from: GuidedConnectionState = INITIAL_STATE): GuidedConnectionState =>
  events.reduce(reduce, from);

/** Entry into the three-path fork: the read-only capability snapshot showed no stored key. No gate. */
const NO_SAVED: GuidedEvent = { type: "RESUME_FROM_CAPABILITY", credentialPresent: false, completed: false };
const fork = reduce(INITIAL_STATE, NO_SAVED); // application_path_choice

describe("INITIAL_STATE", () => {
  it("starts at check_saved_credential (Vault check first)", () => {
    expect(INITIAL_STATE.phase).toBe("check_saved_credential");
    expect(INITIAL_STATE.milestones).toEqual({ registered: false, tested: false, synced: false });
    expect(INITIAL_STATE.actor).toBe("SELLEROPS_AUTOMATED");
    expect(INITIAL_STATE.path).toBe("unknown");
    expect(INITIAL_STATE.failureReason).toBeNull();
  });
});

describe("read-only capability resume (§flow 1) — no readiness gate, no re-run on load", () => {
  it("a prior successful sync → restore completed DIRECTLY, milestones all true (re-runs nothing)", () => {
    const s = reduce(INITIAL_STATE, { type: "RESUME_FROM_CAPABILITY", credentialPresent: true, completed: true });
    expect(s.phase).toBe("completed");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: true });
    expect(s.path).toBe("saved");
  });

  it("a stored key but NOT completed → the connection test as a USER CTA (registered only, no auto-run)", () => {
    const s = reduce(INITIAL_STATE, { type: "RESUME_FROM_CAPABILITY", credentialPresent: true, completed: false });
    expect(s.phase).toBe("connection_testing");
    expect(s.milestones).toEqual({ registered: true, tested: false, synced: false });
    expect(s.path).toBe("saved");
  });

  it("a first sync still RUNNING → restore the in-progress sync screen (registered+tested), never a re-test", () => {
    const s = reduce(INITIAL_STATE, {
      type: "RESUME_FROM_CAPABILITY",
      credentialPresent: true,
      completed: false,
      syncing: true,
    });
    expect(s.phase).toBe("first_order_sync");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: false });
    expect(s.path).toBe("saved");
    expect(s.failureReason).toBeNull();
  });

  it("syncing is subordinate to completed — a completed snapshot restores completed, not the progress screen", () => {
    const s = reduce(INITIAL_STATE, {
      type: "RESUME_FROM_CAPABILITY",
      credentialPresent: true,
      completed: true,
      syncing: true,
    });
    expect(s.phase).toBe("completed");
  });

  it("from the resumed running-sync screen, a SUCCESS settles to completed (the observed poll result)", () => {
    const running = reduce(INITIAL_STATE, {
      type: "RESUME_FROM_CAPABILITY",
      credentialPresent: true,
      completed: false,
      syncing: true,
    });
    const done = reduce(running, { type: "SYNC_RESULT", status: "SUCCESS" });
    expect(done.phase).toBe("completed");
    expect(done.milestones).toEqual({ registered: true, tested: true, synced: true });
  });

  it("no stored key → the three-path fork DIRECTLY (no agent/renderer/login step in between)", () => {
    expect(fork.phase).toBe("application_path_choice");
    expect(fork.milestones.registered).toBe(false);
    expect(fork.path).toBe("unknown");
    expect(fork.failureReason).toBeNull();
  });

  it("RESUME_FROM_CAPABILITY is honored ONLY at the entry — never clobbers later journey progress", () => {
    const testing = run(HAPPY_PATH_EVENTS.slice(0, 8)); // connection_testing
    expect(reduce(testing, { type: "RESUME_FROM_CAPABILITY", credentialPresent: true, completed: true })).toBe(testing);
  });

  it("a stray sync in check_saved_credential is a no-op (cannot jump ahead, §17.2)", () => {
    const s = reduce(INITIAL_STATE, { type: "SYNC_RESULT", status: "SUCCESS" });
    expect(s).toBe(INITIAL_STATE);
  });
});

describe("three-path fork — reuse first, issue only when there is no app (§flow 3/6/7)", () => {
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

describe("issuance mode — guided (Action Window) vs text, same completion hand-off", () => {
  const issuance = run(HAPPY_PATH_EVENTS.slice(0, 4)); // application_issuance (new path)

  it("APPLICATION_ISSUANCE_MODE{guided} at issuance → application_issuance_guided (SUPERVISED_ACTION)", () => {
    expect(issuance.phase).toBe("application_issuance");
    const guided = reduce(issuance, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    expect(guided.phase).toBe("application_issuance_guided");
    expect(guided.actor).toBe("SUPERVISED_ACTION");
    expect(guided.path).toBe("new"); // path threaded unchanged
    expect(actorFor("application_issuance_guided")).toBe("SUPERVISED_ACTION");
  });

  it("APPLICATION_ISSUANCE_MODE{text} at issuance is a NO-OP (the checklist already renders in place)", () => {
    expect(reduce(issuance, { type: "APPLICATION_ISSUANCE_MODE", mode: "text" })).toBe(issuance);
  });

  it("the TEXT path is unchanged: ISSUANCE_COMPLETE at issuance → credential_issued", () => {
    expect(reduce(issuance, { type: "ISSUANCE_COMPLETE" }).phase).toBe("credential_issued");
  });

  it("guided + ISSUANCE_COMPLETE → credential_issued (same hand-off as text; never a stored credential)", () => {
    const guided = reduce(issuance, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    const done = reduce(guided, { type: "ISSUANCE_COMPLETE" });
    expect(done.phase).toBe("credential_issued");
    expect(done.milestones).toEqual({ registered: false, tested: false, synced: false }); // no credential minted
  });

  it("guided + APPLICATION_ISSUANCE_MODE{text} → application_issuance (the text fallback / agent unavailable)", () => {
    const guided = reduce(issuance, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    const back = reduce(guided, { type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
    expect(back.phase).toBe("application_issuance");
    expect(back.path).toBe("new");
  });

  it("guided is otherwise inert: an unmodeled event is a no-op (cannot skip ahead)", () => {
    const guided = reduce(issuance, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    expect(reduce(guided, { type: "BEGIN_CREDENTIAL_ENTRY" })).toBe(guided);
    expect(reduce(guided, { type: "SYNC_RESULT", status: "SUCCESS" })).toBe(guided);
  });

  it("guided ⇄ text ⇄ guided round-trips without touching milestones or path", () => {
    const g1 = reduce(issuance, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    const t1 = reduce(g1, { type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
    const g2 = reduce(t1, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    expect(g2.phase).toBe("application_issuance_guided");
    expect(g2.milestones).toEqual(issuance.milestones);
    expect(g2.path).toBe(issuance.path);
  });
});

describe("existing-app guided confirmation — the SAME walk, but it RETURNS to existing-credential entry", () => {
  // Existing-app entry (path="existing"): the seller has the store's one app and only needs to be shown
  // where its order API group + ID/Secret live. Text is the default (the checklist + form already render).
  const existing = reduce(fork, { type: "APPLICATION_PATH", choice: "have" });

  it("APPLICATION_ISSUANCE_MODE{guided} at existing entry → the shared walkthrough, path preserved", () => {
    expect(existing.phase).toBe("existing_credential_entry");
    expect(existing.path).toBe("existing");
    const guided = reduce(existing, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    expect(guided.phase).toBe("application_issuance_guided");
    expect(guided.actor).toBe("SUPERVISED_ACTION");
    expect(guided.path).toBe("existing"); // NOT re-pathed to "new" — no second app is ever issued
  });

  it("guided + ISSUANCE_COMPLETE returns an existing-app seller to existing_credential_entry (never credential_issued)", () => {
    const guided = reduce(existing, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    const done = reduce(guided, { type: "ISSUANCE_COMPLETE" });
    expect(done.phase).toBe("existing_credential_entry");
    expect(done.path).toBe("existing");
    expect(done.milestones).toEqual({ registered: false, tested: false, synced: false }); // nothing minted
  });

  it("guided + APPLICATION_ISSUANCE_MODE{text} returns an existing-app seller to existing_credential_entry (never application_issuance)", () => {
    const guided = reduce(existing, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    const back = reduce(guided, { type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
    expect(back.phase).toBe("existing_credential_entry");
    expect(back.path).toBe("existing");
  });

  it("a saved-path seller who fell back to existing entry gets the SAME return routing", () => {
    // A saved key that failed its test lands on existing_credential_entry with path="saved".
    const saved = reduce(
      reduce(INITIAL_STATE, { type: "RESUME_FROM_CAPABILITY", credentialPresent: true, completed: false }),
      { type: "TEST_RESULT", status: "FAILED", reasonCode: "INVALID_CREDENTIAL" },
    );
    expect(saved.phase).toBe("existing_credential_entry");
    expect(saved.path).toBe("saved");
    const guided = reduce(saved, { type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
    expect(guided.phase).toBe("application_issuance_guided");
    expect(reduce(guided, { type: "ISSUANCE_COMPLETE" }).phase).toBe("existing_credential_entry");
    expect(reduce(guided, { type: "APPLICATION_ISSUANCE_MODE", mode: "text" }).phase).toBe("existing_credential_entry");
  });

  it("the existing-app entry still submits and still exits to recovery (no regression)", () => {
    expect(reduce(existing, { type: "SUBMIT_CREDENTIALS" }).phase).toBe("credential_registration");
    expect(reduce(existing, { type: "SECRET_UNAVAILABLE" }).phase).toBe("credential_recovery_required");
  });

  it("existing entry stays inert to a stray mode{text} (text is already the rendered default)", () => {
    expect(reduce(existing, { type: "APPLICATION_ISSUANCE_MODE", mode: "text" })).toBe(existing);
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

  it("saved-credential reuse (prior sync succeeded) restores completed on load, no re-run", () => {
    const s = run(SAVED_CREDENTIAL_REUSE_EVENTS);
    expect(s.phase).toBe("completed");
    expect(s.path).toBe("saved");
    expect(s.milestones).toEqual({ registered: true, tested: true, synced: true });
  });

  it("stored-key-but-incomplete resumes to the test CTA, then a user-triggered test+sync completes", () => {
    const s = run(SAVED_KEY_INCOMPLETE_EVENTS);
    expect(s.phase).toBe("completed");
    expect(s.path).toBe("saved");
    // The intermediate phase after resume was the user-CTA connection test (registered, not yet tested).
    const afterResume = reduce(INITIAL_STATE, SAVED_KEY_INCOMPLETE_EVENTS[0]!);
    expect(afterResume.phase).toBe("connection_testing");
    expect(afterResume.milestones).toEqual({ registered: true, tested: false, synced: false });
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
    expect(reduce(recovery, { type: "ISSUANCE_COMPLETE" })).toBe(recovery);
    expect(reduce(recovery, { type: "ACCOUNT_STORE_RESOLVED" })).toBe(recovery);
  });
});

describe("the seller's decisions cannot be skipped (§17.2)", () => {
  it("cannot skip account/store resolution on the new path", () => {
    const newFork = reduce(fork, { type: "APPLICATION_PATH", choice: "new" });
    const store = reduce(newFork, { type: "APPLICATION_LIST_RESULT", found: false });
    expect(store.phase).toBe("account_store_choice_required");
    expect(reduce(store, { type: "ISSUANCE_COMPLETE" })).toBe(store); // no-op
  });

  it("cannot skip issuance", () => {
    const issuance = run(HAPPY_PATH_EVENTS.slice(0, 4)); // application_issuance
    expect(issuance.phase).toBe("application_issuance");
    expect(reduce(issuance, { type: "BEGIN_CREDENTIAL_ENTRY" })).toBe(issuance); // no-op
  });
});

describe("test-connection result mapping (§12, §5)", () => {
  const toTest = HAPPY_PATH_EVENTS.slice(0, 8); // reach connection_testing (…CREDENTIAL_REGISTERED)

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
    const toExistingTest = EXISTING_APP_EVENTS.slice(0, 4); // …CREDENTIAL_REGISTERED on the existing path
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
  const toSync = HAPPY_PATH_EVENTS.slice(0, 9); // reach first_order_sync

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

describe("global fail-closed regressions preserve milestones for resume (§13)", () => {
  const midJourney = run(HAPPY_PATH_EVENTS.slice(0, 9)); // first_order_sync, registered+tested

  it("UI_DRIFT → recoverable_ui_drift; UNKNOWN_STATE → unsupported_state, milestones kept", () => {
    const drift = reduce(midJourney, { type: "UI_DRIFT" });
    expect(drift.phase).toBe("recoverable_ui_drift");
    expect(drift.milestones).toEqual({ registered: true, tested: true, synced: false });
    expect(reduce(midJourney, { type: "UNKNOWN_STATE" }).phase).toBe("unsupported_state");
  });

  it("RESUME recovers to the furthest safe phase", () => {
    const drift = reduce(midJourney, { type: "UI_DRIFT" });
    expect(reduce(drift, { type: "RESUME" }).phase).toBe("first_order_sync");
  });
});

describe("resumeFromMilestones (§13)", () => {
  it("maps persisted milestones to the furthest safe phase", () => {
    expect(resumeFromMilestones({ registered: true, tested: true, synced: true }).phase).toBe("completed");
    expect(resumeFromMilestones({ registered: true, tested: true, synced: false }).phase).toBe("first_order_sync");
    expect(resumeFromMilestones({ registered: true, tested: false, synced: false }).phase).toBe("connection_testing");
    // Not yet registered → re-run the saved-credential check from scratch (the Vault is live).
    expect(resumeFromMilestones({ registered: false, tested: false, synced: false }).phase).toBe("check_saved_credential");
  });
});

describe("misc invariants", () => {
  it("RESET returns to INITIAL_STATE from anywhere", () => {
    expect(reduce(run(HAPPY_PATH_EVENTS), { type: "RESET" })).toEqual(INITIAL_STATE);
  });

  it("actorFor reflects the §6 boundary — no agent/login phases exist to have an actor", () => {
    expect(actorFor("check_saved_credential")).toBe("SELLEROPS_AUTOMATED");
    expect(actorFor("application_path_choice")).toBe("USER_REQUIRED");
    expect(actorFor("existing_credential_entry")).toBe("USER_REQUIRED");
    expect(actorFor("credential_recovery_required")).toBe("USER_REQUIRED");
    expect(actorFor("permission_review_required")).toBe("USER_REQUIRED");
  });

  it("is pure — does not mutate the previous state's milestones", () => {
    const before = run(HAPPY_PATH_EVENTS.slice(0, 7)); // credential_registration
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

  it("a completed connection is durable — no session/agent event exists that could un-complete it", () => {
    const completed = run(HAPPY_PATH_EVENTS);
    // The order connection carries no session concept at all; UI_DRIFT is the only global pause, and it
    // preserves the completion milestones for an immediate RESUME back to completed.
    const paused = reduce(completed, { type: "UI_DRIFT" });
    expect(paused.milestones).toEqual({ registered: true, tested: true, synced: true });
    expect(reduce(paused, { type: "RESUME" }).phase).toBe("completed");
  });
});
