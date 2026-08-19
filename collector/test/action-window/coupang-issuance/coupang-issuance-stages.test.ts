/**
 * The pure stage → v2 contract projection for the Coupang WING issuance walk. These pin the plan in
 * `coupang-issuance-stages.ts` and the CRITICAL invariant the v2 `validateRunView` enforces: any stage that
 * projects to WAITING_FOR_HUMAN must project a step status of AWAITING_USER, or a view could not be built.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUPANG_ISSUANCE_TOTAL_STEPS,
  COUPANG_ISSUANCE_KEY_CREATION_STEP,
  coupangIssuanceAllowedCommands,
  coupangIssuanceStageToRunStatus,
  coupangIssuanceStageToStepStatus,
  coupangIssuanceStepPlan,
  isCoupangIssuanceTerminal,
  type CoupangIssuanceStage,
} from "../../../src/action-window/coupang-issuance/coupang-issuance-stages";

/**
 * EVERY stage, and the list is exhaustive on purpose.
 *
 * It was not: `awaiting_wing_surface` and `checkpoint_reveal_issuance_form` were added to the union without
 * being added here, so the allowed-commands cases below never ran for them — which is exactly why the
 * `awaiting_wing_surface` dead end (no `REQUEST_STEP_RECHECK`, no recovery loop, RUNNING forever) was invisible
 * to a green suite. The `it.each` cases read the record literals below, and TypeScript requires those to be
 * total over `CoupangIssuanceStage`, so a NEW stage now fails to compile until it is listed; the exhaustiveness
 * test at the bottom of this block is what keeps this array itself in step.
 */
const ALL_STAGES: CoupangIssuanceStage[] = [
  "opening",
  "waiting_login",
  "awaiting_wing_surface",
  "locating_open_api",
  "reaching_open_api",
  "checkpoint_reveal_issuance_form",
  "checkpoint_confirm_purpose",
  "guiding_terms_consent",
  "checkpoint_before_issue",
  "guiding_vendor_method",
  "checkpoint_issue_key",
  "guiding_copy_keys",
  "return_to_sellerops",
  "guidance_complete",
  "target_not_found",
  "page_mismatch",
  "credential_state_unknown",
  "operator_aborted",
];

describe("coupang issuance stages — run-status projection", () => {
  const expected: Record<CoupangIssuanceStage, string> = {
    opening: "PREPARING",
    waiting_login: "WAITING_FOR_HUMAN",
    // An observed wait is the runtime WORKING (watching WING), not the seller being blocked.
    awaiting_wing_surface: "RUNNING",
    locating_open_api: "RUNNING",
    reaching_open_api: "WAITING_FOR_HUMAN",
    checkpoint_reveal_issuance_form: "WAITING_FOR_HUMAN",
    checkpoint_confirm_purpose: "WAITING_FOR_HUMAN",
    guiding_terms_consent: "WAITING_FOR_HUMAN",
    checkpoint_before_issue: "WAITING_FOR_HUMAN",
    guiding_vendor_method: "WAITING_FOR_HUMAN",
    checkpoint_issue_key: "WAITING_FOR_HUMAN",
    guiding_copy_keys: "WAITING_FOR_HUMAN",
    return_to_sellerops: "WAITING_FOR_HUMAN",
    guidance_complete: "COMPLETED",
    target_not_found: "WAITING_FOR_HUMAN",
    page_mismatch: "WAITING_FOR_HUMAN",
    credential_state_unknown: "WAITING_FOR_HUMAN",
    operator_aborted: "CANCELLED",
  };
  it.each(ALL_STAGES)("%s", (stage) => {
    expect(coupangIssuanceStageToRunStatus(stage)).toBe(expected[stage]);
  });
});

describe("coupang issuance stages — step-status projection", () => {
  const expected: Record<CoupangIssuanceStage, string> = {
    opening: "PREPARING",
    waiting_login: "AWAITING_USER",
    awaiting_wing_surface: "OBSERVING",
    locating_open_api: "OBSERVING",
    reaching_open_api: "AWAITING_USER",
    checkpoint_reveal_issuance_form: "AWAITING_USER",
    checkpoint_confirm_purpose: "AWAITING_USER",
    guiding_terms_consent: "AWAITING_USER",
    checkpoint_before_issue: "AWAITING_USER",
    guiding_vendor_method: "AWAITING_USER",
    checkpoint_issue_key: "AWAITING_USER",
    guiding_copy_keys: "AWAITING_USER",
    return_to_sellerops: "AWAITING_USER",
    guidance_complete: "COMPLETED",
    target_not_found: "AWAITING_USER",
    page_mismatch: "AWAITING_USER",
    credential_state_unknown: "AWAITING_USER",
    operator_aborted: "PENDING",
  };
  it.each(ALL_STAGES)("%s", (stage) => {
    expect(coupangIssuanceStageToStepStatus(stage)).toBe(expected[stage]);
  });
});

describe("coupang issuance stages — ALL_STAGES really is all of them", () => {
  it("covers every stage in the union (a new stage cannot be added without being tested)", () => {
    // The record literals in the two projection blocks above are `Record<CoupangIssuanceStage, string>`, so
    // they are total by compilation. Comparing this array against one of them is what catches the OTHER half of
    // the gap: a stage typed and mapped, but silently left out of the `it.each` list.
    const mapped: Record<CoupangIssuanceStage, string> = {
      opening: "",
      waiting_login: "",
      awaiting_wing_surface: "",
      locating_open_api: "",
      reaching_open_api: "",
      checkpoint_reveal_issuance_form: "",
      checkpoint_confirm_purpose: "",
      guiding_terms_consent: "",
      checkpoint_before_issue: "",
      guiding_vendor_method: "",
      checkpoint_issue_key: "",
      guiding_copy_keys: "",
      return_to_sellerops: "",
      guidance_complete: "",
      target_not_found: "",
      page_mismatch: "",
      credential_state_unknown: "",
      operator_aborted: "",
    };
    expect([...ALL_STAGES].sort()).toEqual(Object.keys(mapped).sort());
  });
});

describe("coupang issuance stages — the WAITING_FOR_HUMAN invariant", () => {
  it("every WAITING_FOR_HUMAN stage projects an AWAITING_USER step (so a view can be built)", () => {
    for (const stage of ALL_STAGES) {
      if (coupangIssuanceStageToRunStatus(stage) === "WAITING_FOR_HUMAN") {
        expect(coupangIssuanceStageToStepStatus(stage)).toBe("AWAITING_USER");
      }
    }
  });
});

describe("coupang issuance stages — allowed commands", () => {
  it("**terminal stages allow nothing that DOES anything** — only 'show me where I am'", () => {
    // It was the empty list, which is right about every command that acts and wrong about this one: the walk
    // ends with the seller's Access Key on a window SellerOps opened, and a completed run that cannot bring its
    // own window back tells them to go and find it themselves. `FIND_CURRENT_STEP` completes no step, performs
    // nothing, and cannot open a window — the lazy driver refuses to launch one for it.
    for (const stage of ["guidance_complete", "operator_aborted"] as const) {
      expect(isCoupangIssuanceTerminal(stage), stage).toBe(true);
      expect(coupangIssuanceAllowedCommands(stage), stage).toEqual(["FIND_CURRENT_STEP"]);
      for (const forbidden of ["REQUEST_STEP_RECHECK", "RESUME_RUN", "PAUSE_RUN", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED"]) {
        expect(coupangIssuanceAllowedCommands(stage), `${stage}/${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("guiding barriers offer recheck + PAUSE + cancel + manual, and NEVER a click/submit/read command", () => {
    for (const stage of [
      "reaching_open_api",
      "checkpoint_confirm_purpose",
      "guiding_terms_consent",
      "checkpoint_before_issue",
      "guiding_copy_keys",
      "return_to_sellerops",
    ] as CoupangIssuanceStage[]) {
      const cmds = coupangIssuanceAllowedCommands(stage);
      expect(cmds).toContain("REQUEST_STEP_RECHECK");
      expect(cmds).toContain("PAUSE_RUN");
      expect(cmds).toContain("CANCEL_RUN");
      expect(cmds).toContain("SWITCH_TO_MANUAL");
      // There is deliberately no command that clicks, submits, issues a key, or reads a value.
      for (const forbidden of ["CLICK", "SUBMIT", "ISSUE", "READ_VALUE", "AUTOFILL", "TYPE"]) {
        expect(cmds).not.toContain(forbidden as never);
      }
    }
  });

  it("recoverable parks offer recheck but NOT pause (they recover only by re-probing)", () => {
    for (const stage of ["waiting_login", "target_not_found", "page_mismatch"] as CoupangIssuanceStage[]) {
      const cmds = coupangIssuanceAllowedCommands(stage);
      expect(cmds).toContain("REQUEST_STEP_RECHECK");
      expect(cmds).not.toContain("PAUSE_RUN");
    }
  });

  it("**an OBSERVED WAIT offers recheck too — a wait whose window elapses must not be a dead end**", () => {
    // `awaiting_wing_surface` carries no blocker and clears itself, so it fell through to the automatic-stage
    // branch, which omits `REQUEST_STEP_RECHECK`. A seller who needed longer than the surface-wait window (2FA,
    // a password reset) was left with a run reporting RUNNING, no blocker, and nothing but CANCEL/manual: the
    // command was rejected INVALID_FOR_STATE and the frontend was never offered the button. The park this stage
    // replaced was recoverable.
    const cmds = coupangIssuanceAllowedCommands("awaiting_wing_surface");
    expect(cmds).toContain("REQUEST_STEP_RECHECK");
    // Not a barrier: there is nothing to pause on, and a park does not offer it either.
    expect(cmds).not.toContain("PAUSE_RUN");
    expect(cmds).toContain("CANCEL_RUN");
    expect(cmds).toContain("SWITCH_TO_MANUAL");
  });

  it("EVERY non-terminal stage can ask the runtime to look again", () => {
    // The general form of the defect above, so the next stage added cannot repeat it in a different place. Only
    // the two momentary automatic stages are exempt — nothing is resting there and the next effect is already
    // in flight.
    for (const stage of ALL_STAGES) {
      if (isCoupangIssuanceTerminal(stage)) continue;
      if (stage === "opening" || stage === "locating_open_api") continue;
      expect(coupangIssuanceAllowedCommands(stage), stage).toContain("REQUEST_STEP_RECHECK");
    }
  });
});

describe("the fence is LIFTED, and every clause of it was answered in code", () => {
  // The fence said: the plan is contradicted by live evidence, and this entrypoint has no approval-manifest
  // gate, no phase binding, no repo-identity check, and navigates the page itself. Lifting it had to be a
  // deliberate, reviewable diff — so these assert the REPLACEMENTS, not the absence.
  const SRC = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../instruments/live-runs/run-coupang-wing-issuance-live.ts"),
    "utf8",
  );

  it("the fence constants are GONE — not left true, not left dangling", async () => {
    const cli = await import("../../../instruments/live-runs/run-coupang-wing-issuance-live");
    expect("COUPANG_WING_GUIDED_ISSUANCE_FENCED" in cli).toBe(false);
    expect("COUPANG_WING_GUIDED_ISSUANCE_FENCE_REASON" in cli).toBe(false);
    expect(cli.COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE).toBe("COUPANG_WING_GUIDED_ISSUANCE_WALK");
  });

  it("**the PHASE gate is checked first — ahead of the approval flag, as the fence was**", () => {
    const body = SRC.slice(SRC.indexOf("async function main("));
    const phaseIdx = body.indexOf("COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE");
    expect(phaseIdx).toBeGreaterThan(-1);
    expect(phaseIdx).toBeLessThan(body.indexOf("hasCoupangWingRunApproval"));
    // BOTH variables, and they must agree — one alone lets a stale export from another WING run authorize this.
    expect(body).toContain("WING_APPROVAL_PHASE_ENV");
    expect(body).toContain("WING_APPROVED_PHASE_ENV");
  });

  it("repo identity is verified before anything opens", () => {
    const body = SRC.slice(SRC.indexOf("async function main("));
    expect(body).toContain("verifyRepoIdentity");
    expect(body.indexOf("verifyRepoIdentity")).toBeLessThan(body.indexOf("launchNaverContext"));
  });

  it("**the agent navigates ONCE, to the landing** — and the RUN CLI still navigates nothing", () => {
    // The clause that mattered most on the product path: the seller reaches every SCREEN themselves, and an
    // agent that drives the page through the flow has taken a marketplace action nobody granted. Opening the
    // seller's own seller center so they do not start on a blank window is not that — but it IS a navigation,
    // so the budget says one rather than the claim being softened to "no meaningful navigation".
    // Comment lines stripped first, per collector/CLAUDE.md §5: the docstring explaining that the goto is gone
    // says "page.goto", and prose has produced this exact false failure in this repo before.
    const codeOnly = SRC.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(codeOnly).not.toContain(".goto(");
    const cliNavBudget = SRC.match(/COUPANG_WING_GUIDED_WALK_AGENT_NAVIGATIONS = (\d+)/);
    expect(cliNavBudget?.[1]).toBe("1");
  });

  it("the URL is still SCREENED even though nothing navigates to it", () => {
    // The screen is what keeps the dedicated window pointed at the WING host; dropping it along with the goto
    // would have widened where the profile can be opened.
    expect(SRC).toContain("screenWingUrl");
  });
});

describe("coupang issuance stages — the fixed 8-step plan, in the MEASURED order", () => {
  it("is always eight steps (a fixed linear line, no branch)", () => {
    // Seven → eight on 2026-08-10 (the old plan had steps for screens this flow never shows, and none for the
    // control that creates the key) → seven again once the purpose screen became ONE step → NINE on 2026-08-12,
    // when the vendor-method screen was measured and the walk stopped ending one screen short of the key.
    expect(COUPANG_ISSUANCE_TOTAL_STEPS).toBe(8);
    expect(coupangIssuanceStepPlan()).toHaveLength(8);
  });

  it("uses the exact product-required stepIds, in flow order", () => {
    expect(coupangIssuanceStepPlan().map((s) => s.stepId)).toEqual([
      "aw.coupang_issuance_reach_open_api",
      "aw.coupang_issuance_reveal_form",
      "aw.coupang_issuance_confirm_purpose",
      "aw.coupang_issuance_terms_consent",
      "aw.coupang_issuance_issue_checkpoint",
      "aw.coupang_issuance_vendor_method",
      "aw.coupang_issuance_vendor_confirm",
      "aw.coupang_issuance_copy_keys",
    ]);
  });

  it("uses the exact product-required copy keys", () => {
    expect(coupangIssuanceStepPlan().map((s) => s.copyKey)).toEqual([
      "actionWindow.coupangIssuance.reachOpenApi",
      "actionWindow.coupangIssuance.revealForm",
      "actionWindow.coupangIssuance.confirmPurpose",
      "actionWindow.coupangIssuance.termsConsent",
      "actionWindow.coupangIssuance.issueCheckpoint",
      "actionWindow.coupangIssuance.vendorMethod",
      "actionWindow.coupangIssuance.vendorConfirm",
      "actionWindow.coupangIssuance.copyKeys",
    ]);
  });

  it("uses the exact product-required modes and targetKinds (step 1 has no targetKind)", () => {
    const plan = coupangIssuanceStepPlan();
    expect(plan.map((s) => s.mode)).toEqual([
      "AUTOMATIC_OPERATION",
      ...Array.from({ length: 7 }, () => "ACTION_WINDOW"),
    ]);
    expect(plan[0]!.copyParams).toBeUndefined(); // step 1 (reach) is text guidance — no highlighted control
    expect(plan.slice(1).map((s) => s.copyParams?.targetKind)).toEqual([
      "issue",
      "confirm_purpose",
      "terms_consent",
      "issue_final",
      "vendor_method",
      "vendor_confirm",
      "credentials",
    ]);
  });

  it("**names the KEY-CREATION step, and it is the one before copying keys**", () => {
    // The old plan's central error was structural, not cosmetic: it went from the 발급 press straight to
    // "copy your keys", so the tutorial told the seller to copy credentials that did not exist. The step that
    // creates them now exists, is named once, and sits immediately before the copy step.
    const plan = coupangIssuanceStepPlan();
    // **Step 5 until 2026-08-12, and it was never the key-creating one.** That control was pressed on two live
    // walks and issued nothing; the screen it opens has since been measured, and its 확인 is the boundary.
    expect(COUPANG_ISSUANCE_KEY_CREATION_STEP).toBe(7);
    const keyStep = plan[COUPANG_ISSUANCE_KEY_CREATION_STEP - 1]!;
    expect(keyStep.copyParams?.targetKind).toBe("vendor_confirm");
    expect(plan[COUPANG_ISSUANCE_KEY_CREATION_STEP]!.copyParams?.targetKind).toBe("credentials");
    // …and nothing before it can create a key: every earlier targetKind is a reveal, a confirmation or a read.
    for (const s of plan.slice(0, COUPANG_ISSUANCE_KEY_CREATION_STEP - 1)) {
      expect(s.copyParams?.targetKind).not.toBe("vendor_confirm");
    }
  });

  it("has NO step for a screen this flow never shows", () => {
    // 업체명 / 호출 IP matched hidden nodes only on every reading of every screen across five granted runs. A
    // step for either would park the seller in front of a field that is not there, and the walk would deadlock.
    const kinds = coupangIssuanceStepPlan().map((s) => s.copyParams?.targetKind);
    for (const gone of ["self_dev", "vendor_info", "call_ip"]) expect(kinds, gone).not.toContain(gone);
  });
});
