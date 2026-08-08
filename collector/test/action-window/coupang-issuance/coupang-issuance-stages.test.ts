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
  coupangIssuanceAllowedCommands,
  coupangIssuanceStageToRunStatus,
  coupangIssuanceStageToStepStatus,
  coupangIssuanceStepPlan,
  isCoupangIssuanceTerminal,
  type CoupangIssuanceStage,
} from "../../../src/action-window/coupang-issuance/coupang-issuance-stages";

const ALL_STAGES: CoupangIssuanceStage[] = [
  "opening",
  "waiting_login",
  "locating_open_api",
  "reaching_open_api",
  "guiding_self_dev",
  "guiding_vendor_info",
  "guiding_call_ip",
  "checkpoint_before_issue",
  "guiding_copy_keys",
  "return_to_sellerops",
  "guidance_complete",
  "target_not_found",
  "page_mismatch",
  "operator_aborted",
];

describe("coupang issuance stages — run-status projection", () => {
  const expected: Record<CoupangIssuanceStage, string> = {
    opening: "PREPARING",
    waiting_login: "WAITING_FOR_HUMAN",
    locating_open_api: "RUNNING",
    reaching_open_api: "WAITING_FOR_HUMAN",
    guiding_self_dev: "WAITING_FOR_HUMAN",
    guiding_vendor_info: "WAITING_FOR_HUMAN",
    guiding_call_ip: "WAITING_FOR_HUMAN",
    checkpoint_before_issue: "WAITING_FOR_HUMAN",
    guiding_copy_keys: "WAITING_FOR_HUMAN",
    return_to_sellerops: "WAITING_FOR_HUMAN",
    guidance_complete: "COMPLETED",
    target_not_found: "WAITING_FOR_HUMAN",
    page_mismatch: "WAITING_FOR_HUMAN",
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
    locating_open_api: "OBSERVING",
    reaching_open_api: "AWAITING_USER",
    guiding_self_dev: "AWAITING_USER",
    guiding_vendor_info: "AWAITING_USER",
    guiding_call_ip: "AWAITING_USER",
    checkpoint_before_issue: "AWAITING_USER",
    guiding_copy_keys: "AWAITING_USER",
    return_to_sellerops: "AWAITING_USER",
    guidance_complete: "COMPLETED",
    target_not_found: "AWAITING_USER",
    page_mismatch: "AWAITING_USER",
    operator_aborted: "PENDING",
  };
  it.each(ALL_STAGES)("%s", (stage) => {
    expect(coupangIssuanceStageToStepStatus(stage)).toBe(expected[stage]);
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
  it("terminal stages allow nothing", () => {
    expect(coupangIssuanceAllowedCommands("guidance_complete")).toEqual([]);
    expect(coupangIssuanceAllowedCommands("operator_aborted")).toEqual([]);
    expect(isCoupangIssuanceTerminal("guidance_complete")).toBe(true);
    expect(isCoupangIssuanceTerminal("operator_aborted")).toBe(true);
  });

  it("guiding barriers offer recheck + PAUSE + cancel + manual, and NEVER a click/submit/read command", () => {
    for (const stage of [
      "reaching_open_api",
      "guiding_self_dev",
      "guiding_vendor_info",
      "guiding_call_ip",
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
});

describe("the guided walk is FENCED OFF in code, not only in comments", () => {
  it("the fence is ON, and its entrypoint refuses before the approval flag is even read", async () => {
    // Review's point: the ⚠ comments saying the plan "is not safe to run" were the ONLY thing stopping it, while
    // `run-coupang-wing-issuance-live.ts` still launched it behind just the WING flag — with no approval manifest,
    // no phase binding, no repo-identity check, and its own `page.goto`. Lifting the fence must be a deliberate,
    // reviewable diff, so it is a constant with a test rather than a paragraph.
    const cli = await import("../../../src/cli/run-coupang-wing-issuance-live");
    expect(cli.COUPANG_WING_GUIDED_ISSUANCE_FENCED).toBe(true);
    expect(cli.COUPANG_WING_GUIDED_ISSUANCE_FENCE_REASON).toMatch(/self_dev\/call_ip match 0/);
    expect(cli.COUPANG_WING_GUIDED_ISSUANCE_FENCE_REASON).toMatch(/no approval-manifest gate/);
  });

  it("the fence is checked FIRST in main(), ahead of the approval flag", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/cli/run-coupang-wing-issuance-live.ts"),
      "utf8",
    );
    const body = src.slice(src.indexOf("async function main("));
    expect(body.indexOf("COUPANG_WING_GUIDED_ISSUANCE_FENCED")).toBeGreaterThan(-1);
    expect(body.indexOf("COUPANG_WING_GUIDED_ISSUANCE_FENCED")).toBeLessThan(body.indexOf("hasCoupangWingRunApproval"));
    // …and it points at the phase that produces the evidence needed to lift it.
    expect(body).toContain("run-coupang-wing-reveal-live.ts");
  });
});

describe("coupang issuance stages — the fixed 7-step plan", () => {
  it("is always seven steps (a fixed linear line, no branch)", () => {
    expect(COUPANG_ISSUANCE_TOTAL_STEPS).toBe(7);
    expect(coupangIssuanceStepPlan()).toHaveLength(7);
  });

  it("uses the exact product-required stepIds", () => {
    expect(coupangIssuanceStepPlan().map((s) => s.stepId)).toEqual([
      "aw.coupang_issuance_reach_open_api",
      "aw.coupang_issuance_self_dev",
      "aw.coupang_issuance_vendor_info",
      "aw.coupang_issuance_call_ip",
      "aw.coupang_issuance_issue_checkpoint",
      "aw.coupang_issuance_copy_keys",
      "aw.coupang_issuance_return",
    ]);
  });

  it("uses the exact product-required copy keys", () => {
    expect(coupangIssuanceStepPlan().map((s) => s.copyKey)).toEqual([
      "actionWindow.coupangIssuance.reachOpenApi",
      "actionWindow.coupangIssuance.selfDev",
      "actionWindow.coupangIssuance.vendorInfo",
      "actionWindow.coupangIssuance.callIp",
      "actionWindow.coupangIssuance.issueCheckpoint",
      "actionWindow.coupangIssuance.copyKeys",
      "actionWindow.coupangIssuance.return",
    ]);
  });

  it("uses the exact product-required modes and targetKinds (step 1 has no targetKind)", () => {
    const plan = coupangIssuanceStepPlan();
    expect(plan.map((s) => s.mode)).toEqual([
      "AUTOMATIC_OPERATION",
      "ACTION_WINDOW",
      "ACTION_WINDOW",
      "ACTION_WINDOW",
      "ACTION_WINDOW",
      "ACTION_WINDOW",
      "ACTION_WINDOW",
    ]);
    expect(plan[0]!.copyParams).toBeUndefined(); // step 1 (reach) is text guidance — no highlighted control
    expect(plan.slice(1).map((s) => s.copyParams?.targetKind)).toEqual([
      "self_dev",
      "vendor_info",
      "call_ip",
      "issue",
      "credentials",
      "return",
    ]);
  });
});
