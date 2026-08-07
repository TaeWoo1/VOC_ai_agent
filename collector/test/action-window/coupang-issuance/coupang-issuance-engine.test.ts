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
  self_dev: "bbbbbbbbbbbbbbbb",
  vendor_info: "cccccccccccccccc",
  call_ip: "dddddddddddddddd",
  issue: "eeeeeeeeeeeeeeee",
  credentials: "ffffffffffffffff",
  return: "1111111111111111",
};

function engine() {
  return new CoupangIssuanceEngine({ runId: "run_c", channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
}

const BARRIER: Record<string, string> = {
  self_dev: "guiding_self_dev",
  vendor_info: "guiding_vendor_info",
  call_ip: "guiding_call_ip",
  issue: "checkpoint_before_issue",
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
  it("reach_open_api transition → verify → self_dev → … → return → complete, advancing each checkpoint WING-RESIDENT", () => {
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
    expect(eng.onReachVerified({ ok: true, pageCategory: "open_api_issuance" })).toEqual({ guide: "self_dev" });

    // Every same-page checkpoint now advances ON THE WING PAGE — the seller presses its on-page advance button and
    // the driver reports it (onUserActionObserved). No REQUEST_STEP_RECHECK from the FE is needed. Each call
    // asserts the run rested at that step's barrier before the observed press moved it on.
    driveCheckpoint(eng, "self_dev", "vendor_info");
    driveCheckpoint(eng, "vendor_info", "call_ip");
    driveCheckpoint(eng, "call_ip", "issue");
    driveCheckpoint(eng, "issue", "credentials");
    driveCheckpoint(eng, "credentials", "return");
    // The return checkpoint's observed on-page press completes the guidance.
    driveCheckpoint(eng, "return", null);
    expect(eng.currentStage()).toBe("guidance_complete");
    expect(eng.view().status).toBe("COMPLETED");
    expect(eng.view().progress).toEqual({ completedSteps: 7, totalSteps: 7 });
  });

  it("a FE REQUEST_STEP_RECHECK still advances a checkpoint as a fallback/recovery (never the primary driver)", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" }); // → guide self_dev
    eng.onTargetLocated("self_dev", { count: 1, sig: SIG.self_dev! });
    eng.onTargetHighlighted("self_dev", { count: 1, sig: SIG.self_dev! });
    expect(eng.currentStage()).toBe("guiding_self_dev");
    // The fallback path (FE 다음) still completes the checkpoint and guides the next control.
    pressNext(eng, "vendor_info");
    expect(eng.currentStage()).toBe("guiding_vendor_info");
  });

  it("skips the reach transition when the seller is ALREADY on the open-API issuance page (step 1 auto-completes)", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" })).toEqual({ guide: "self_dev" });
    // Step 1 completed automatically without ever guiding reach_open_api.
    const completed = eng.events().filter((e) => e.type === "STEP_COMPLETED").map((e) => e.payload.stepId);
    expect(completed).toContain("aw.coupang_issuance_reach_open_api");
  });
});

describe("coupang issuance engine — the 발급 (issue) HUMAN CHECKPOINT never auto-advances", () => {
  function toIssueBarrier() {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" }); // → guide self_dev
    eng.onTargetLocated("self_dev", { count: 1, sig: SIG.self_dev! });
    eng.onTargetHighlighted("self_dev", { count: 1, sig: SIG.self_dev! });
    pressNext(eng, "vendor_info");
    pressNext(eng, "call_ip");
    pressNext(eng, "issue");
    return eng;
  }

  it("rests at checkpoint_before_issue with the 발급 button highlighted (opaque 16-hex ref) and does not auto-advance", () => {
    const eng = toIssueBarrier();
    expect(eng.currentStage()).toBe("checkpoint_before_issue");
    expect(eng.view().status).toBe("WAITING_FOR_HUMAN");
    expect(eng.view().currentStep?.stepNumber).toBe(5);
    expect(eng.view().currentStep?.copyParams?.targetKind).toBe("issue");
    const ref = eng.events().find((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.coupang_issuance_issue_checkpoint")!.payload.targetRef;
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    // The checkpoint RESTS: no completion is emitted for the ISSUE step until the seller reports pressing 발급. The
    // driver enforces the human checkpoint by not observing an advance until the seller presses the on-page
    // button — the engine never presses 발급 itself and there is no auto-advance timer here.
    const completedStepIds = eng.events().filter((e) => e.type === "STEP_COMPLETED").map((e) => e.payload.stepId);
    expect(completedStepIds).not.toContain("aw.coupang_issuance_issue_checkpoint");
  });

  it("advances the 발급 checkpoint ONLY on the seller's observed on-page press (they issue the key themselves)", () => {
    const eng = toIssueBarrier();
    // The seller pressed the WING-resident '발급 완료 · 다음' button AFTER issuing the key in their own window; the
    // driver reports that observed press and the engine advances to the copy-keys checkpoint. SellerOps still
    // never clicks 발급 and reads no credential value — it only reacts to what the seller reports doing.
    expect(eng.onUserActionObserved("issue")).toEqual({ guide: "credentials" });
    // The issue step completed and the run is now guiding the copy-keys checkpoint (its stage advances once the
    // credentials control is highlighted — here we assert the target moved and the step completed).
    expect(eng.activeTarget()).toBe("credentials");
    const completed = eng.events().filter((e) => e.type === "STEP_COMPLETED").map((e) => e.payload.stepId);
    expect(completed).toContain("aw.coupang_issuance_issue_checkpoint");
  });
});

describe("coupang issuance engine — recoverable parks (never RUN_FAILED)", () => {
  it("parks on waiting_login for a login page and stays recoverable", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    expect(eng.onSurfaceProbed({ ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" })).toBe("NONE");
    expect(eng.currentStage()).toBe("waiting_login");
    expect(eng.view().blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(eng.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });

  it("parks on page_mismatch for an unexpected page, and on target_not_found for a missing control", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "credential_shown" }); // not where the tutorial starts
    expect(eng.currentStage()).toBe("page_mismatch");

    const eng2 = engine();
    eng2.command({ type: "START_RUN", expectedRevision: 0 });
    eng2.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" });
    expect(eng2.onTargetLocated("self_dev", { count: 0 })).toBe("NONE");
    expect(eng2.currentStage()).toBe("target_not_found");
    expect(eng2.view().blocker).toEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
  });

  it("parks on page_mismatch when the reach verification lands on a non-issuance page", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "wing_home" });
    eng.onTargetLocated("reach_open_api", { count: 1, sig: SIG.reach_open_api! });
    eng.onTargetHighlighted("reach_open_api", { count: 1, sig: SIG.reach_open_api! });
    eng.onUserActionObserved("reach_open_api");
    eng.onReachVerified({ ok: true, pageCategory: "unknown" });
    expect(eng.currentStage()).toBe("page_mismatch");
    expect(eng.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });
});

describe("coupang issuance engine — contract validity + NO appBranch", () => {
  it("emits valid v2 views/events with channelCode coupang, the issuance intent, and never an appBranch", () => {
    const eng = engine();
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" });
    eng.onTargetLocated("self_dev", { count: 1, sig: SIG.self_dev! });
    eng.onTargetHighlighted("self_dev", { count: 1, sig: SIG.self_dev! });

    const v = eng.view();
    expect(v.channelCode).toBe("coupang");
    expect(v.intent).toBe("API_ISSUANCE_GUIDANCE");
    expect(v.runCopyKey).toBe("actionWindow.coupangIssuance.run");
    expect(v.appBranch).toBeUndefined(); // linear flow — NEVER an appBranch
    expect(v.currentStep?.totalSteps).toBe(7);
    expect(validateRunView(v)).toEqual({ ok: true });
    expect(findProhibitedFields(v)).toEqual([]);
    for (const e of eng.events()) {
      expect(validateEventEnvelope(e), `event ${e.type}`).toEqual({ ok: true });
      expect(findProhibitedFields(e)).toEqual([]);
    }
  });
});
