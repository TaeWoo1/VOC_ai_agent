/**
 * The pure Coupang WING issuance reducer — driven directly (no session), pinning the linear transitions, both
 * probe-entry branches (wing_home transition vs already-on-issuance-page), the 발급 human checkpoint, and the
 * NO-appBranch contract validity of every emitted view.
 */
import { describe, expect, it } from "vitest";
import { validateEventEnvelope, validateRunView, findProhibitedFields } from "../../../../contracts/action-window/v2/index";
import { CoupangIssuanceEngine, makeCoupangIssuanceClock } from "../../../src/action-window/coupang-issuance/coupang-issuance-engine";

const SIG: Record<string, string> = {
  reach_open_api: "aaaaaaaaaaaaaaaa",
  confirm_purpose: "cccccccccccccccc",
  terms_consent: "dddddddddddddddd",
  issue: "eeeeeeeeeeeeeeee",
  issue_final: "2222222222222222",
  vendor_method: "3333333333333333",
  vendor_confirm: "4444444444444444",
  credentials: "ffffffffffffffff",
  return: "1111111111111111",
};

function engine() {
  return new CoupangIssuanceEngine({ runId: "run_c", channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
}

const BARRIER: Record<string, string> = {
  issue: "checkpoint_reveal_issuance_form",
  confirm_purpose: "checkpoint_confirm_purpose",
  terms_consent: "guiding_terms_consent",
  issue_final: "checkpoint_before_issue",
  vendor_method: "guiding_vendor_method",
  vendor_confirm: "checkpoint_issue_key",
  credentials: "guiding_copy_keys",
  return: "return_to_sellerops",
};

/** Drive one WING-resident checkpoint: locate → highlight (arms an observation + rests at THIS barrier) → the
 * seller's observed on-page advance press returns the next guide (or CLEANUP for the final return). This is the
 * PRIMARY path — no FE 다음 involved. The stage only advances to the NEXT barrier once that control is highlighted
 * (the next driveCheckpoint call), mirroring how the session drives the returned `{ guide }`. */
function driveCheckpoint(eng: CoupangIssuanceEngine, target: string, nextTarget: string | null): void {
  eng.onTargetLocated(target as never, { count: 1, sig: SIG[target]! });
  // A same-page checkpoint arms a WING-resident observation (its on-page advance button), not a rest-for-FE-다음.
  expect(eng.onTargetHighlighted(target as never, { count: 1, sig: SIG[target]! })).toEqual({ observe: target });
  expect(eng.currentStage()).toBe(BARRIER[target]);
  const out = eng.onUserActionObserved(target as never);
  expect(out).toEqual(nextTarget ? { guide: nextTarget } : "CLEANUP");
}

/** Drive one checkpoint via the FALLBACK path (FE 다음 = REQUEST_STEP_RECHECK) → guide → locate → highlight. */
function pressNext(eng: CoupangIssuanceEngine, nextTarget: string | null): void {
  const out = eng.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: eng.view().revision });
  if (!nextTarget) return; // completing checkpoint (return → complete)
  expect(out).toEqual({ ok: true, idempotent: false, effect: { guide: nextTarget } });
  eng.onTargetLocated(nextTarget as never, { count: 1, sig: SIG[nextTarget]! });
  eng.onTargetHighlighted(nextTarget as never, { count: 1, sig: SIG[nextTarget]! });
}

describe("coupang issuance engine — the linear walkthrough from the WING home", () => {
  it("reach_open_api → verify → 발급 → purpose → 확인 → terms → key → … → credentials → complete, advancing each checkpoint WING-RESIDENT", () => {
    const eng = engine();
    expect(eng.command({ type: "START_RUN", expectedRevision: 0 })).toEqual({ ok: true, idempotent: false, effect: "PROBE" });

    // WING home → guide the reach_open_api transition-observe (step 1).
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "wing_home" })).toEqual({ guide: "reach_open_api" });
    eng.onTargetLocated("reach_open_api", { count: 1, sig: SIG.reach_open_api! });
    // reach_open_api is a transition-observe target: highlight arms an observation of the seller's navigation.
    expect(eng.onTargetHighlighted("reach_open_api", { count: 1, sig: SIG.reach_open_api! })).toEqual({ observe: "reach_open_api" });
    expect(eng.currentStage()).toBe("reaching_open_api");

    // The seller navigated off the home; the engine re-probes to VERIFY the issuance page before step 1 completes.
    expect(eng.onUserActionObserved("reach_open_api")).toBe("VERIFY_REACH");
    // …and BEFORE the first issuance control, the run asks whether this account already has a key. A positive
    // NO_KEY is what licenses the walk to continue toward a control that creates one.
    expect(eng.onReachVerified({ ok: true, pageCategory: "open_api_issuance" })).toBe("CHECK_CREDENTIAL_STATE");
    expect(eng.onCredentialStateProbed("NO_KEY")).toEqual({ guide: "issue" });

    // Every same-page checkpoint now advances ON THE WING PAGE — the seller presses its on-page advance button and
    // the driver reports it (onUserActionObserved). No REQUEST_STEP_RECHECK from the FE is needed. Each call
    // asserts the run rested at that step's barrier before the observed press moved it on.
    // The MEASURED order: 발급 opens the purpose screen, 확인 opens the terms screen, and the key is created on
    // the terms screen by `약관 동의 및 Key 발급받기`.
    driveCheckpoint(eng, "issue", "confirm_purpose");
    driveCheckpoint(eng, "confirm_purpose", "terms_consent");
    driveCheckpoint(eng, "terms_consent", "issue_final");
    // MEASURED 2026-08-12: this press issues no key — it opens the vendor-method screen.
    driveCheckpoint(eng, "issue_final", "vendor_method");
    driveCheckpoint(eng, "vendor_method", "vendor_confirm");
    // ⚠ THE KEY-CREATION BOUNDARY: only after the seller presses THIS 확인 can a credential exist to copy.
    driveCheckpoint(eng, "vendor_confirm", "credentials");
    // The LAST step. Its own CTA returns the seller to SellerOps, so its observed press completes the
    // guidance — there is no step after it to advance to.
    driveCheckpoint(eng, "credentials", null);
    expect(eng.currentStage()).toBe("guidance_complete");
    expect(eng.view().status).toBe("COMPLETED");
    expect(eng.view().progress).toEqual({ completedSteps: 8, totalSteps: 8 });
  });

  it("a FE REQUEST_STEP_RECHECK still advances a checkpoint as a fallback/recovery (never the primary driver)", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" }); // → guide self_dev
    eng.onTargetLocated("issue", { count: 1, sig: SIG.issue! });
    eng.onTargetHighlighted("issue", { count: 1, sig: SIG.issue! });
    expect(eng.currentStage()).toBe("checkpoint_reveal_issuance_form");
    // The fallback path (FE 다음) still completes the checkpoint and guides the next control.
    pressNext(eng, "confirm_purpose");
    expect(eng.currentStage()).toBe("checkpoint_confirm_purpose");
  });

  it("skips the reach transition when the seller is ALREADY on the open-API issuance page (step 1 auto-completes)", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" })).toBe("CHECK_CREDENTIAL_STATE");
    expect(eng.onCredentialStateProbed("NO_KEY")).toEqual({ guide: "issue" });
    // Step 1 completed automatically without ever guiding reach_open_api.
    const completed = eng.events().filter((e) => e.type === "STEP_COMPLETED").map((e) => e.payload.stepId);
    expect(completed).toContain("aw.coupang_issuance_reach_open_api");
  });
});

describe("coupang issuance engine — the KEY-CREATION HUMAN CHECKPOINT never auto-advances", () => {
  function toIssueBarrier() {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" }); // → guide self_dev
    eng.onTargetLocated("issue", { count: 1, sig: SIG.issue! });
    eng.onTargetHighlighted("issue", { count: 1, sig: SIG.issue! });
    pressNext(eng, "confirm_purpose");
    pressNext(eng, "terms_consent");
    pressNext(eng, "issue_final");
    pressNext(eng, "vendor_method");
    pressNext(eng, "vendor_confirm");
    return eng;
  }

  it("rests at checkpoint_issue_key with the KEY-CREATING control highlighted (opaque 16-hex ref) and does not auto-advance", () => {
    const eng = toIssueBarrier();
    // The boundary MOVED on 2026-08-12, and moving it is the point: `checkpoint_before_issue` guarded a control
    // that was pressed twice on live walks and issued nothing.
    expect(eng.currentStage()).toBe("checkpoint_issue_key");
    expect(eng.view().status).toBe("WAITING_FOR_HUMAN");
    expect(eng.view().currentStep?.stepNumber).toBe(7);
    expect(eng.view().currentStep?.copyParams?.targetKind).toBe("vendor_confirm");
    const ref = eng.events().find((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.coupang_issuance_vendor_confirm")!.payload.targetRef;
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    // The checkpoint RESTS: no completion is emitted for the ISSUE step until the seller reports pressing 발급. The
    // driver enforces the human checkpoint by not observing an advance until the seller presses the on-page
    // button — the engine never presses 발급 itself and there is no auto-advance timer here.
    const completedStepIds = eng.events().filter((e) => e.type === "STEP_COMPLETED").map((e) => e.payload.stepId);
    expect(completedStepIds).not.toContain("aw.coupang_issuance_vendor_confirm");
  });

  it("advances the key-issuing checkpoint ONLY on the seller's observed act (they issue the key themselves)", () => {
    const eng = toIssueBarrier();
    // The seller pressed the WING-resident '발급 완료 · 다음' button AFTER issuing the key in their own window; the
    // driver reports that observed press and the engine advances to the copy-keys checkpoint. SellerOps still
    // never clicks 발급 and reads no credential value — it only reacts to what the seller reports doing.
    expect(eng.onUserActionObserved("vendor_confirm")).toEqual({ guide: "credentials" });
    // The issue step completed and the run is now guiding the copy-keys checkpoint (its stage advances once the
    // credentials control is highlighted — here we assert the target moved and the step completed).
    expect(eng.activeTarget()).toBe("credentials");
    const completed = eng.events().filter((e) => e.type === "STEP_COMPLETED").map((e) => e.payload.stepId);
    expect(completed).toContain("aw.coupang_issuance_vendor_confirm");
  });
});

describe("coupang issuance engine — recoverable parks (never RUN_FAILED)", () => {
  it("WAITS on a login page — the seller logs in in WING and the runtime keeps looking", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    // `AWAIT_SURFACE`, not `NONE`: the run keeps re-probing on its own. It used to sit until a
    // `REQUEST_STEP_RECHECK` arrived — from the SellerOps tab the seller had just been told to leave.
    expect(eng.onSurfaceProbed({ ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" })).toBe("AWAIT_SURFACE");
    expect(eng.currentStage()).toBe("waiting_login");
    expect(eng.view().blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(eng.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });

  it("re-reading the same login page emits nothing new — a poll is not an event stream", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" });
    const after = eng.events().length;
    expect(eng.onSurfaceProbed({ ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" })).toBe("AWAIT_SURFACE");
    expect(eng.events().length).toBe(after);
  });

  it("an unrecognized page is a WAIT with no blocker — the window opens blank, which is not drift", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    // Every run starts here: the dedicated window's blank tab classifies as `unknown`. Parking told a seller who
    // had not logged in yet that the screen had changed unexpectedly, and then never recovered by itself.
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "unknown" })).toBe("AWAIT_SURFACE");
    expect(eng.currentStage()).toBe("awaiting_wing_surface");
    expect(eng.view().blocker).toBeUndefined();
    expect(eng.events().map((e) => e.type)).not.toContain("RUN_BLOCKED");
  });

  it("a wait clears itself the moment WING shows something we recognize", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "unknown" });
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" })).toBe("CHECK_CREDENTIAL_STATE");
    expect(eng.onCredentialStateProbed("NO_KEY")).toEqual({ guide: "issue" });
    expect(eng.view().blocker).toBeUndefined();
  });

  it("parks on target_not_found for a missing control", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "credential_shown" }); // not where the tutorial starts
    expect(eng.currentStage()).toBe("awaiting_wing_surface");

    const eng2 = engine();
    eng2.command({ type: "START_RUN", expectedRevision: 0 });
    eng2.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" });
    expect(eng2.onTargetLocated("issue", { count: 0 })).toBe("NONE");
    expect(eng2.currentStage()).toBe("target_not_found");
    expect(eng2.view().blocker).toEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
  });

  it("WAITS when the reach verification lands somewhere that is not the issuance page yet", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "wing_home" });
    eng.onTargetLocated("reach_open_api", { count: 1, sig: SIG.reach_open_api! });
    eng.onTargetHighlighted("reach_open_api", { count: 1, sig: SIG.reach_open_api! });
    eng.onUserActionObserved("reach_open_api");
    eng.onReachVerified({ ok: true, pageCategory: "unknown" });
    expect(eng.currentStage()).toBe("awaiting_wing_surface");
    expect(eng.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });

  it("**an expired wait becomes a RECOVERABLE park, not a run that claims to still be watching**", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "unknown" });
    expect(eng.view().blocker).toBeUndefined(); // …while it IS watching

    expect(eng.onSurfaceWaitExpired()).toBe("NONE");
    // `SURFACE_SETTLE_TIMEOUT` ("화면이 아직 준비되지 않았어요"), not `UI_DRIFT` ("화면이 바뀐 것 같아요") — the
    // message the observed wait exists to stop showing someone who was simply not there yet.
    expect(eng.view().blocker).toEqual({ code: "SURFACE_SETTLE_TIMEOUT", recoverable: true });
    expect(eng.view().status).toBe("WAITING_FOR_HUMAN");
    expect(eng.view().allowedCommands).toContain("REQUEST_STEP_RECHECK");
    // …and the recheck the frontend can now send re-probes from the top.
    expect(eng.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: eng.view().revision })).toEqual({
      ok: true,
      idempotent: false,
      effect: "PROBE",
    });
  });

  it("a recheck DURING the wait is accepted and re-probes (the button is offered, never needed)", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "unknown" });
    expect(eng.view().allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(eng.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: eng.view().revision })).toEqual({
      ok: true,
      idempotent: false,
      effect: "PROBE",
    });
  });

  it("an expiry that arrives after the run moved on parks NOTHING", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" });
    expect(eng.onSurfaceWaitExpired()).toBe("NONE");
    expect(eng.currentStage()).toBe("locating_open_api");
    expect(eng.view().blocker).toBeUndefined();
  });

  it("a LOGIN wait expires to nothing — it is already a park with a blocker and a button", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "login" });
    const before = eng.events().length;
    expect(eng.onSurfaceWaitExpired()).toBe("NONE");
    expect(eng.currentStage()).toBe("waiting_login");
    expect(eng.events()).toHaveLength(before); // no re-announcement
  });

  it("**a SECOND probe of the same surface advances NOTHING** — two readers, one advance", () => {
    // Two callers can reach `onSurfaceProbed` at once: a surface-wait poll and a `REQUEST_STEP_RECHECK`'s
    // `PROBE`. Without this guard the second re-ran the whole branch on a run the first had already advanced —
    // `STEP_COMPLETED` for step 1 twice and two independent `{guide:"issue"}` chains on one target.
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" })).toBe("CHECK_CREDENTIAL_STATE");
    expect(eng.onCredentialStateProbed("NO_KEY")).toEqual({ guide: "issue" });
    const after = eng.events().length;
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" })).toBe("NONE");
    expect(eng.events()).toHaveLength(after);
    expect(eng.events().filter((e) => e.type === "STEP_COMPLETED")).toHaveLength(1);
  });
});

describe("coupang issuance engine — contract validity + NO appBranch", () => {
  it("emits valid v2 views/events with channelCode coupang, the issuance intent, and never an appBranch", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" });
    eng.onTargetLocated("issue", { count: 1, sig: SIG.issue! });
    eng.onTargetHighlighted("issue", { count: 1, sig: SIG.issue! });

    const v = eng.view();
    expect(v.channelCode).toBe("coupang");
    expect(v.intent).toBe("API_ISSUANCE_GUIDANCE");
    expect(v.runCopyKey).toBe("actionWindow.coupangIssuance.run");
    expect(v.appBranch).toBeUndefined(); // linear flow — NEVER an appBranch
    expect(v.currentStep?.totalSteps).toBe(8);
    expect(validateRunView(v)).toEqual({ ok: true });
    expect(findProhibitedFields(v)).toEqual([]);
    for (const e of eng.events()) {
      expect(validateEventEnvelope(e), `event ${e.type}`).toEqual({ ok: true });
      expect(findProhibitedFields(e)).toEqual([]);
    }
  });
});

/* ─────────────── D2: whether the walk walks at all ─────────────── */

/**
 * **The credential-state branch.** The walk's last control creates a real key on a live account, so the run
 * asks whether one already exists before guiding the first step toward it.
 *
 * The asymmetry is the whole design, and it is why there are three answers rather than two: a wrong
 * `KEY_PRESENT` costs a screen, a wrong `NO_KEY` costs a second credential.
 */
describe("coupang issuance engine — does this account already have a key", () => {
  /** Start a run and get it to the surface where the question is answerable. */
  function atTheQuestion() {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" })).toBe("CHECK_CREDENTIAL_STATE");
    return eng;
  }

  it("**KEY_PRESENT goes straight to the hand-off** — no step on the path to creating a key is guided", () => {
    const eng = atTheQuestion();
    expect(eng.onCredentialStateProbed("KEY_PRESENT")).toEqual({ guide: "credentials" });
    // The seller lands on step ⑧ — the SAME step a seller who has just issued a key ends on. One screen, two
    // cohorts, which is the point: the hand-off does not care how the key came to exist.
    expect(eng.view().currentStep?.stepNumber).toBe(8);
    expect(eng.view().credentialState).toBe("KEY_PRESENT");
  });

  it("NO_KEY walks, exactly as it always did", () => {
    const eng = atTheQuestion();
    expect(eng.onCredentialStateProbed("NO_KEY")).toEqual({ guide: "issue" });
    expect(eng.view().currentStep?.stepNumber).toBe(2);
    expect(eng.view().credentialState).toBe("NO_KEY");
  });

  it("**UNKNOWN parks, recoverably, and guides nothing** — it is a refusal, not a shrug", () => {
    const eng = atTheQuestion();
    expect(eng.onCredentialStateProbed("UNKNOWN")).toBe("NONE");
    expect(eng.currentStage()).toBe("credential_state_unknown");
    expect(eng.view().blocker).toEqual({ code: "CREDENTIAL_STATE_UNKNOWN", recoverable: true });
    expect(eng.view().credentialState).toBe("UNKNOWN");
    // …and it never became a guide. `!== "KEY_PRESENT"` would have read this as permission to walk.
    expect(eng.activeTarget()).toBeNull();
  });

  it("the reading is on the wire, and every view carrying it is contract-valid", () => {
    for (const state of ["NO_KEY", "KEY_PRESENT", "UNKNOWN"] as const) {
      const eng = atTheQuestion();
      eng.onCredentialStateProbed(state);
      const view = eng.view();
      expect(validateRunView(view), state).toMatchObject({ ok: true });
      // Issuance-scoped, like appBranch: the contract rejects it on any other intent.
      expect(view.intent).toBe("API_ISSUANCE_GUIDANCE");
      // One enum, and nothing derived from a credential VALUE anywhere near it.
      expect(findProhibitedFields(view)).toEqual([]);
    }
  });

  it("**absent until it has been read** — a default here would be a claim about a screen nobody looked at", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    expect(eng.view().credentialState).toBeUndefined();
    expect(validateRunView(eng.view())).toMatchObject({ ok: true });
  });

  it("a SECOND answer changes nothing — the first one already moved the run", () => {
    const eng = atTheQuestion();
    eng.onCredentialStateProbed("NO_KEY");
    const after = eng.events().length;
    expect(eng.onCredentialStateProbed("KEY_PRESENT")).toBe("NONE");
    expect(eng.events()).toHaveLength(after);
    // …and it did not overwrite what was read the first time.
    expect(eng.view().credentialState).toBe("NO_KEY");
  });

  it("a park is recoverable: a re-check re-probes, and a second reading can clear it", () => {
    const eng = atTheQuestion();
    eng.onCredentialStateProbed("UNKNOWN");
    const rev = eng.view().revision;
    expect(eng.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: rev }).ok).toBe(true);
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" })).toBe("CHECK_CREDENTIAL_STATE");
    expect(eng.onCredentialStateProbed("NO_KEY")).toEqual({ guide: "issue" });
    expect(eng.view().blocker).toBeUndefined();
  });
});
