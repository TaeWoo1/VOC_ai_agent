/**
 * The bounded budget, and the shape of running out.
 *
 * Exhaustion must be a terminal STATE, not an exception and not a silent truncation. The repository has
 * already paid once for the third option — a report counted unanswered inquiries off one 50-row page
 * and printed the number under the same label the home screen used for the real one — so what is
 * asserted here is that a run which stopped early SAYS it stopped early.
 */
import { describe, expect, it } from "vitest";
import { OperatorBudget } from "../../src/operator/budget/OperatorBudget";

const LIMITS = { maxIterations: 2, maxToolCalls: 3, maxLlmCalls: 1, deadlineMs: 1_000 };

describe("OperatorBudget", () => {
  it("charges before the call, so the limit is never exceeded by one", () => {
    const budget = new OperatorBudget(LIMITS, () => 0);

    expect(budget.spend("tool")).toBe(true);
    expect(budget.spend("tool")).toBe(true);
    expect(budget.spend("tool")).toBe(true);
    expect(budget.spend("tool"), "the fourth is refused, not counted-then-refused").toBe(false);
    expect(budget.report("COMPLETE").toolCalls).toBe(3);
  });

  it("tool and model budgets are separate pools", () => {
    const budget = new OperatorBudget(LIMITS, () => 0);

    budget.spend("tool");
    expect(budget.canSpend("llm"), "spending a tool call must not spend a model call").toBe(true);
    expect(budget.spend("llm")).toBe(true);
    expect(budget.spend("llm")).toBe(false);
  });

  it("a refused spend marks the run exhausted, and COMPLETE cannot be reported over it", () => {
    const budget = new OperatorBudget(LIMITS, () => 0);
    for (let i = 0; i < 4; i++) budget.spend("tool");

    const report = budget.report("COMPLETE");
    expect(report.exhausted).toBe(true);
    expect(report.stopReason, "the caller's 'done' must not override the budget's 'we stopped'")
      .toBe("BUDGET_EXHAUSTED");
  });

  it("the deadline ends a run even with counters to spare", () => {
    let clock = 0;
    const budget = new OperatorBudget(LIMITS, () => clock);

    expect(budget.spend("tool")).toBe(true);
    clock = 1_500;
    expect(budget.canSpend("tool"), "counters remain, but the run is out of time").toBe(false);
    expect(budget.report("COMPLETE").stopReason).toBe("BUDGET_EXHAUSTED");
  });

  it("iterations are bounded, so a judge that always asks for more cannot loop forever", () => {
    const budget = new OperatorBudget(LIMITS, () => 0);

    expect(budget.beginIteration()).toBe(true);
    expect(budget.beginIteration()).toBe(true);
    expect(budget.beginIteration(), "a third cycle is refused at maxIterations=2").toBe(false);
    expect(budget.report("COMPLETE").iterations).toBe(2);
  });

  it("NO_PLAN survives into the report — it is not the same event as running out", () => {
    const budget = new OperatorBudget(LIMITS, () => 0);

    expect(budget.report("NO_PLAN").stopReason).toBe("NO_PLAN");
  });
});

/**
 * What a run costs when the model capabilities are OFF — the default, and what every CI run and every
 * plain demo does.
 *
 * Measured live on 2026-08-21: with plan and judge both off, a real run still spent 5 of its 6
 * model-budget units on round-trips that each returned `available: false`. Nothing was wrong with the
 * answer — every fallback worked — but a run with two more findings would have reported
 * BUDGET_EXHAUSTED over a budget it never actually used, and left real findings unjudged.
 */
import { SpringEvidenceJudge } from "../../src/operator/judge/EvidenceJudge";
import { LlmInvestigationPlanner, PlannerUnavailableError } from "../../src/operator/plan/LlmInvestigationPlanner";
import type { AgentJudgeView, AgentPlanView } from "../../src/spring/types";

const OFF_JUDGE: AgentJudgeView = {
  available: false, hasEvidence: false, supportingEvidenceIds: [], unsafeAssertion: false,
  unsafeReason: null, needsMore: false, needsMoreTool: null, needsMoreReason: null,
  // Absent providerVersion = the capability is off for this org (not "the model declined this one").
  providerVersion: null,
};

const DECLINED_JUDGE: AgentJudgeView = { ...OFF_JUDGE, providerVersion: "agent-judge/v1+test" };

const OFF_PLAN: AgentPlanView = {
  available: false, supported: false, specialists: [], tools: [],
  rationale: null, providerVersion: null,
};

const FINDING = {
  findingId: "f1", specialist: "REVIEW_OPS" as const, statement: "근거 12건이 기록돼 있습니다.",
  evidenceIds: ["e1"], confidence: "NEEDS_REVIEW" as const, verdict: null, surfaceLink: null,
};
const EVIDENCE = [{
  evidenceId: "e1", kind: "REVIEW_ISSUE" as const, sourceTool: "search_review_issues",
  sourceCall: "aa11", locator: { count: 12 }, asOf: "2026-08-14", events: null,
  coverage: "COVERED" as const, provenance: "issue-memory/RULE_BASED",
}];

describe("a capability that answered 'off' is not asked again", () => {
  it("the judge stops charging the model budget after one refusal", async () => {
    let calls = 0;
    const judge = new SpringEvidenceJudge({
      judgeFinding: async () => {
        calls += 1;
        return OFF_JUDGE;
      },
    });

    expect(judge.usesModel, "before asking, the seam exists so a call is expected").toBe(true);
    await judge.judge(FINDING, EVIDENCE);
    expect(judge.usesModel, "after 'capability off', no further call will happen").toBe(false);

    await judge.judge(FINDING, EVIDENCE);
    expect(calls, "asking once per run is diagnosis; once per finding is waste").toBe(1);
  });

  it("but a DECLINED finding says nothing about the next one — keep asking", async () => {
    let calls = 0;
    const judge = new SpringEvidenceJudge({
      judgeFinding: async () => {
        calls += 1;
        return DECLINED_JUDGE;
      },
    });

    await judge.judge(FINDING, EVIDENCE);
    await judge.judge(FINDING, EVIDENCE);

    expect(judge.usesModel, "the capability is ON; it just refused this content").toBe(true);
    expect(calls).toBe(2);
  });

  /**
   * The planner's version of the same situation is NOT "stop asking" — it is "stop the run".
   *
   * v1 learned that a capability was off and quietly stopped charging the model budget, because there
   * was a keyword table underneath to answer with. v2 has none: a planner that cannot plan ends the run,
   * so there is no second call to save budget on. The learned-state optimisation stays where it still
   * makes sense — the judge, which genuinely does continue with a deterministic verdict.
   */
  it("the planner does not degrade — it throws, and the run ends", async () => {
    let calls = 0;
    const planner = new LlmInvestigationPlanner({
      planGoal: async () => {
        calls += 1;
        return OFF_PLAN;
      },
    });

    await expect(planner.plan({
      request: { text: "오늘 뭐부터 봐야 해?" }, catalogue: [], limits: LIMITS,
    })).rejects.toBeInstanceOf(PlannerUnavailableError);
    expect(calls).toBe(1);
  });

  it("a planner with no endpoint throws before any call", async () => {
    const planner = new LlmInvestigationPlanner({});
    await expect(planner.plan({
      request: { text: "오늘 뭐부터 봐야 해?" }, catalogue: [], limits: LIMITS,
    })).rejects.toBeInstanceOf(PlannerUnavailableError);
  });
});
