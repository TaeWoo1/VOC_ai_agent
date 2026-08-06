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

/** Drive one checkpoint: 다음 (REQUEST_STEP_RECHECK) → guide → locate → highlight → rest at the next barrier. */
function pressNext(eng: CoupangIssuanceEngine, nextTarget: string | null): void {
  const out = eng.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: eng.view().revision });
  if (!nextTarget) return; // completing checkpoint (return → complete)
  expect(out).toEqual({ ok: true, idempotent: false, effect: { guide: nextTarget } });
  eng.onTargetLocated(nextTarget as never, { count: 1, sig: SIG[nextTarget]! });
  eng.onTargetHighlighted(nextTarget as never, { count: 1, sig: SIG[nextTarget]! });
}

describe("coupang issuance engine — the linear walkthrough from the WING home", () => {
  it("reach_open_api transition → verify → self_dev → vendor_info → call_ip → issue → credentials → return → complete", () => {
    const eng = engine();
    expect(eng.command({ type: "START_RUN", expectedRevision: 0 })).toEqual({ ok: true, idempotent: false, effect: "PROBE" });

    // WING home → guide the reach_open_api transition-observe (step 1).
    expect(eng.onSurfaceProbed({ ok: true, pageCategory: "wing_home" })).toEqual({ guide: "reach_open_api" });
    eng.onTargetLocated("reach_open_api", { count: 1, sig: SIG.reach_open_api! });
    // reach_open_api is a transition-observe target (NOT a checkpoint), so highlight arms an observation.
    expect(eng.onTargetHighlighted("reach_open_api", { count: 1, sig: SIG.reach_open_api! })).toEqual({ observe: "reach_open_api" });
    expect(eng.currentStage()).toBe("reaching_open_api");

    // The seller navigated off the home; the engine re-probes to VERIFY the issuance page before step 1 completes.
    expect(eng.onUserActionObserved("reach_open_api")).toBe("VERIFY_REACH");
    expect(eng.onReachVerified({ ok: true, pageCategory: "open_api_issuance" })).toEqual({ guide: "self_dev" });
    eng.onTargetLocated("self_dev", { count: 1, sig: SIG.self_dev! });
    // self_dev is a same-page checkpoint — highlight RESTS (no observe), advance on 다음.
    expect(eng.onTargetHighlighted("self_dev", { count: 1, sig: SIG.self_dev! })).toBe("NONE");
    expect(eng.currentStage()).toBe("guiding_self_dev");

    pressNext(eng, "vendor_info");
    expect(eng.currentStage()).toBe("guiding_vendor_info");
    pressNext(eng, "call_ip");
    expect(eng.currentStage()).toBe("guiding_call_ip");
    pressNext(eng, "issue");
    expect(eng.currentStage()).toBe("checkpoint_before_issue");
    pressNext(eng, "credentials");
    expect(eng.currentStage()).toBe("guiding_copy_keys");
    pressNext(eng, "return");
    expect(eng.currentStage()).toBe("return_to_sellerops");
    // The final 다음 completes the return checkpoint and finishes the guidance.
    expect(eng.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: eng.view().revision })).toEqual({ ok: true, idempotent: false, effect: "CLEANUP" });
    expect(eng.currentStage()).toBe("guidance_complete");
    expect(eng.view().status).toBe("COMPLETED");
    expect(eng.view().progress).toEqual({ completedSteps: 7, totalSteps: 7 });
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

  it("rests at checkpoint_before_issue with the 발급 button highlighted (opaque 16-hex ref), arming NO observer", () => {
    const eng = toIssueBarrier();
    expect(eng.currentStage()).toBe("checkpoint_before_issue");
    expect(eng.view().status).toBe("WAITING_FOR_HUMAN");
    expect(eng.view().currentStep?.stepNumber).toBe(5);
    expect(eng.view().currentStep?.copyParams?.targetKind).toBe("issue");
    const ref = eng.events().find((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.coupang_issuance_issue_checkpoint")!.payload.targetRef;
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
  });

  it("an observed action on `issue` is a NO-OP — the checkpoint completes ONLY on the operator's 다음", () => {
    const eng = toIssueBarrier();
    // Even if something reported a WING action on issue, the engine never auto-completes it (checkpoints advance
    // only on 다음). The seller presses 발급 themselves; the runtime never clicks it.
    expect(eng.onUserActionObserved("issue")).toBe("NONE");
    expect(eng.currentStage()).toBe("checkpoint_before_issue");
    // 다음 advances it to the credentials checkpoint.
    const out = eng.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: eng.view().revision });
    expect(out).toEqual({ ok: true, idempotent: false, effect: { guide: "credentials" } });
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
