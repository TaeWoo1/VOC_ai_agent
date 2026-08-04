/**
 * The pure stage → v2 contract projection for the issuance walk. These pin the table in
 * `issuance-stages.ts` and the CRITICAL invariant the v2 `validateRunView` enforces: any stage that projects
 * to WAITING_FOR_HUMAN must project a step status of AWAITING_USER, or a view could not be built for it.
 */
import { describe, expect, it } from "vitest";
import {
  ISSUANCE_TOTAL_STEPS,
  issuanceAllowedCommands,
  issuanceStageToRunStatus,
  issuanceStageToStepStatus,
  issuanceStepPlan,
  isIssuanceTerminal,
  type IssuanceStage,
} from "../../../src/action-window/api-issuance/issuance-stages";

const ALL_STAGES: IssuanceStage[] = [
  "opening",
  "waiting_login",
  "locating_applications",
  "existing_app",
  "empty_state",
  "guiding_create",
  "guiding_api_group",
  "guiding_app_detail",
  "guiding_app_usage_check",
  "guiding_application_id",
  "guiding_application_secret",
  "return_to_sellerops",
  "guidance_complete",
  "target_not_found",
  "page_mismatch",
  "operator_aborted",
];

describe("issuance stages — run-status projection", () => {
  const expected: Record<IssuanceStage, string> = {
    opening: "PREPARING",
    waiting_login: "WAITING_FOR_HUMAN",
    locating_applications: "RUNNING",
    existing_app: "RUNNING",
    empty_state: "RUNNING",
    guiding_create: "WAITING_FOR_HUMAN",
    guiding_api_group: "WAITING_FOR_HUMAN",
    guiding_app_detail: "WAITING_FOR_HUMAN",
    guiding_app_usage_check: "WAITING_FOR_HUMAN",
    guiding_application_id: "WAITING_FOR_HUMAN",
    guiding_application_secret: "WAITING_FOR_HUMAN",
    return_to_sellerops: "WAITING_FOR_HUMAN",
    guidance_complete: "COMPLETED",
    target_not_found: "WAITING_FOR_HUMAN",
    page_mismatch: "WAITING_FOR_HUMAN",
    operator_aborted: "CANCELLED",
  };
  it.each(ALL_STAGES)("%s", (stage) => {
    expect(issuanceStageToRunStatus(stage)).toBe(expected[stage]);
  });
});

describe("issuance stages — step-status projection", () => {
  const expected: Record<IssuanceStage, string> = {
    opening: "PREPARING",
    waiting_login: "AWAITING_USER",
    locating_applications: "OBSERVING",
    existing_app: "READY",
    empty_state: "READY",
    guiding_create: "AWAITING_USER",
    guiding_api_group: "AWAITING_USER",
    guiding_app_detail: "AWAITING_USER",
    guiding_app_usage_check: "AWAITING_USER",
    guiding_application_id: "AWAITING_USER",
    guiding_application_secret: "AWAITING_USER",
    return_to_sellerops: "AWAITING_USER",
    guidance_complete: "COMPLETED",
    target_not_found: "AWAITING_USER",
    page_mismatch: "AWAITING_USER",
    operator_aborted: "PENDING",
  };
  it.each(ALL_STAGES)("%s", (stage) => {
    expect(issuanceStageToStepStatus(stage)).toBe(expected[stage]);
  });
});

describe("issuance stages — the WAITING_FOR_HUMAN invariant", () => {
  it("every WAITING_FOR_HUMAN stage projects an AWAITING_USER step (so a view can be built)", () => {
    for (const stage of ALL_STAGES) {
      if (issuanceStageToRunStatus(stage) === "WAITING_FOR_HUMAN") {
        expect(issuanceStageToStepStatus(stage)).toBe("AWAITING_USER");
      }
    }
  });
});

describe("issuance stages — allowed commands", () => {
  it("terminal stages allow nothing", () => {
    expect(issuanceAllowedCommands("guidance_complete")).toEqual([]);
    expect(issuanceAllowedCommands("operator_aborted")).toEqual([]);
    expect(isIssuanceTerminal("guidance_complete")).toBe(true);
    expect(isIssuanceTerminal("operator_aborted")).toBe(true);
  });

  it("guiding barriers offer recheck + PAUSE + cancel + manual", () => {
    for (const stage of ["guiding_create", "guiding_app_detail", "guiding_app_usage_check", "guiding_api_group", "guiding_application_id", "guiding_application_secret", "return_to_sellerops"] as IssuanceStage[]) {
      const cmds = issuanceAllowedCommands(stage);
      expect(cmds).toContain("REQUEST_STEP_RECHECK");
      expect(cmds).toContain("PAUSE_RUN");
      expect(cmds).toContain("CANCEL_RUN");
      expect(cmds).toContain("SWITCH_TO_MANUAL");
    }
  });

  it("recoverable parks offer recheck but NOT pause (they recover only by re-probing)", () => {
    for (const stage of ["waiting_login", "target_not_found", "page_mismatch"] as IssuanceStage[]) {
      const cmds = issuanceAllowedCommands(stage);
      expect(cmds).toContain("REQUEST_STEP_RECHECK");
      expect(cmds).not.toContain("PAUSE_RUN");
    }
  });
});

describe("issuance stages — the fixed 7-step plan", () => {
  it("is always seven steps, whichever branch steps 2/3 take", () => {
    expect(ISSUANCE_TOTAL_STEPS).toBe(7);
    expect(issuanceStepPlan(true)).toHaveLength(7);
    expect(issuanceStepPlan(false)).toHaveLength(7);
  });

  it("branches ONLY step 2's target/copy and step 3's copy (same stepIds, same slots)", () => {
    const existing = issuanceStepPlan(true);
    const empty = issuanceStepPlan(false);
    // Step 2 (the app): same slot id, different copy key + highlighted control.
    expect(existing[1]!.stepId).toBe(empty[1]!.stepId);
    expect(existing[1]!.copyKey).toBe("actionWindow.issuance.openApp");
    expect(empty[1]!.copyKey).toBe("actionWindow.issuance.createApp");
    expect(existing[1]!.copyParams?.targetKind).toBe("open_app");
    expect(empty[1]!.copyParams?.targetKind).toBe("create_app");
    // Step 3 (usage-state advisory): same slot id, branch-appropriate copy, and NO targetKind on either branch
    // (text-only — the runtime highlights nothing).
    expect(existing[2]!.stepId).toBe(empty[2]!.stepId);
    expect(existing[2]!.copyKey).toBe("actionWindow.issuance.appUsageCheck");
    expect(empty[2]!.copyKey).toBe("actionWindow.issuance.appUsageCheckNew");
    expect(existing[2]!.copyParams).toBeUndefined();
    expect(empty[2]!.copyParams).toBeUndefined();
    // Steps 1, 4, 5, 6, 7 are identical across branches.
    for (const i of [0, 3, 4, 5, 6]) expect(existing[i]).toEqual(empty[i]);
  });

  it("uses the exact product-required stepIds and copy keys", () => {
    expect(issuanceStepPlan(false).map((s) => s.stepId)).toEqual([
      "aw.issuance_reach_applications",
      "aw.issuance_open_or_create_app",
      "aw.issuance_app_usage_check",
      "aw.issuance_api_group",
      "aw.issuance_application_id",
      "aw.issuance_application_secret",
      "aw.issuance_return",
    ]);
  });
});
