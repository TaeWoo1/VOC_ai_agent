/**
 * The plan validator's contract: it refuses, it removes, and it never adds.
 *
 * <b>The "never adds" half is the one worth testing hardest.</b> A validator that quietly supplies a
 * missing specialist or a plausible information need is a second planner — a deterministic one, sitting
 * exactly where invariant I2 says none may exist — and every divergence result would then be measuring
 * its defaults instead of a model's understanding.
 */
import { describe, expect, it } from "vitest";
import { validatePlan, PlanRejectedError } from "../../src/operator/plan/PlanValidator";
import type { InvestigationPlan } from "../../src/operator/plan/InvestigationPlan";

const DEPS = {
  catalogue: ["get_today_inbox", "search_review_issues", "resolve_product"],
  limits: { maxIterations: 3, maxToolCalls: 12 },
};

function plan(overrides: Partial<InvestigationPlan> = {}): InvestigationPlan {
  return {
    supported: true,
    userGoal: "오늘 볼 것",
    entities: { resolved: [], unresolved: [] },
    informationNeeds: [
      { id: "n1", question: "미답변이 몇 건인가", kind: "INQUIRY_VOLUME", why: "", required: true },
    ],
    specialistTargets: ["INQUIRY_OPS"],
    candidateTools: ["get_today_inbox"],
    retrievalStrategy: { order: ["n1"], parallelizable: [], stopWhen: null },
    evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: [] }],
    riskClass: "ROUTINE",
    stoppingCriteria: { maxIterations: 1, maxToolCalls: 4, enough: null },
    clarificationNeeded: false,
    clarificationReason: null,
    rationale: null,
    plannerVersion: "test",
    ...overrides,
  };
}

describe("V6 — the planner may not resolve entities", () => {
  it("a plan carrying a resolved entity is rejected outright, with no repair", () => {
    const bad = plan({
      entities: {
        resolved: [{ kind: "PRODUCT", mention: "A", id: "p-1", label: "A", resolvedBy: "model" }],
        unresolved: [],
      },
    });
    expect(() => validatePlan(bad, DEPS)).toThrow(PlanRejectedError);
    try {
      validatePlan(bad, DEPS);
    } catch (err) {
      expect((err as PlanRejectedError).rejection).toBe("PLANNER_FABRICATED_ENTITY_ID");
    }
  });
});

describe("V1/V3 — a plan with nothing to do is refused, never filled in", () => {
  it("no known specialist ⇒ rejected", () => {
    expect(() => validatePlan(plan({ specialistTargets: ["MARKETING_OPS" as never] }), DEPS))
      .toThrow(PlanRejectedError);
  });

  it("no information need ⇒ rejected", () => {
    expect(() => validatePlan(plan({ informationNeeds: [] }), DEPS)).toThrow(PlanRejectedError);
  });

  it("the validator adds no need of its own to a plan that has one", () => {
    const validated = validatePlan(plan(), DEPS);
    expect(validated.informationNeeds).toHaveLength(1);
    expect(validated.specialistTargets).toEqual(["INQUIRY_OPS"]);
  });
});

describe("V2/V4 — removal, not substitution", () => {
  it("an unknown tool is dropped and the known ones survive", () => {
    const validated = validatePlan(
      plan({ candidateTools: ["get_today_inbox", "delete_everything"] }), DEPS,
    );
    expect(validated.candidateTools).toEqual(["get_today_inbox"]);
  });

  it("dropping every tool does NOT cause the catalogue to be substituted", () => {
    // v1 fell back to authorizing the WHOLE catalogue when a plan named no usable tool. v2 does not:
    // the specialist's own tools are its authorization floor, and a plan that chose badly must not be
    // silently upgraded to "may call anything".
    const validated = validatePlan(plan({ candidateTools: ["nope"] }), DEPS);
    expect(validated.candidateTools).toEqual([]);
  });

  it("an evidence requirement for a need that does not exist is dropped", () => {
    const validated = validatePlan(
      plan({ evidenceRequirements: [{ needId: "ghost", minEvidence: 1, acceptableKinds: [] }] }), DEPS,
    );
    expect(validated.evidenceRequirements).toEqual([]);
  });
});

describe("V5 — stopping criteria clamp DOWN only", () => {
  it("a plan asking for more than the system budget gets the system's", () => {
    const validated = validatePlan(
      plan({ stoppingCriteria: { maxIterations: 99, maxToolCalls: 999, enough: null } }), DEPS,
    );
    expect(validated.stoppingCriteria.maxIterations).toBe(3);
    expect(validated.stoppingCriteria.maxToolCalls).toBe(12);
  });

  it("a plan asking for less keeps its own smaller ceiling", () => {
    const validated = validatePlan(plan(), DEPS);
    expect(validated.stoppingCriteria.maxToolCalls).toBe(4);
  });
});

describe("V5 — a need the strategy forgot to order still runs", () => {
  it("unordered needs are appended rather than dropped", () => {
    const validated = validatePlan(plan({
      informationNeeds: [
        { id: "n1", question: "a", kind: "INQUIRY_VOLUME", why: "", required: true },
        { id: "n2", question: "b", kind: "REPEAT_PATTERN", why: "", required: true },
      ],
      retrievalStrategy: { order: ["n1"], parallelizable: [], stopWhen: null },
    }), DEPS);
    // Silently not pursuing a need the same plan declared REQUIRED would be the validator editing the
    // plan's substance, which is precisely what it may not do.
    expect(validated.retrievalStrategy.order).toEqual(["n1", "n2"]);
  });
});

describe("V7/V8 — refusal and clarification are answers, not errors", () => {
  it("riskClass REFUSE passes through as unsupported with no specialists", () => {
    const validated = validatePlan(plan({ riskClass: "REFUSE" }), DEPS);
    expect(validated.supported).toBe(false);
    expect(validated.specialistTargets).toEqual([]);
  });

  it("clarificationNeeded runs no specialist", () => {
    const validated = validatePlan(
      plan({ clarificationNeeded: true, clarificationReason: "어떤 상품인가요?" }), DEPS,
    );
    expect(validated.clarificationNeeded).toBe(true);
    expect(validated.specialistTargets).toEqual([]);
  });
});
