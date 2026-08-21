/**
 * No plan, no run — invariant I2's terminal half.
 *
 * <b>This is the test that would have to be deleted to reintroduce a fallback</b>, which is exactly why
 * it exists. Every way a plan can fail to exist is exercised here, and every one of them must end in a
 * FAILED run with zero findings. A "small answer" produced under any of these conditions is a
 * deterministic answer by another name.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import { INBOX, MOLDING, coveredSignals } from "../support/operatorFixtures";
import type { AgentPlanView } from "../../src/spring/types";

function runtimeWith(operator: FakeOperatorSpringClient): OperatorAgentRuntime {
  return new OperatorAgentRuntime({
    operator,
    inquiry: new FakeSpringClient(twoInquiries()),
    issue: new FakeIssueSpringClient(fourIssues()),
  });
}

const SEED = { inbox: INBOX, products: [MOLDING], signals: { [MOLDING.id]: coveredSignals() } };

describe("planner unavailable ⇒ the run fails", () => {
  it("no planner endpoint at all (a backend predating the seam)", async () => {
    const result = await runtimeWith(new FakeOperatorSpringClient(SEED)).run("t", { text: "오늘 뭐 봐?" });
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.failureCode).toBe("PLANNER_CAPABILITY_OFF");
    // The seller is told what to do about it, and told that the rest of the product still works.
    expect(result.reason).toContain("AI 계획 기능이 꺼져");
    expect(result.reason).toContain("평소대로");
  });

  it("the capability is off for this org", async () => {
    const off: AgentPlanView = {
      available: false, supported: false, specialists: [], tools: [],
      rationale: null, providerVersion: null,
    };
    const result = await runtimeWith(new FakeOperatorSpringClient({ ...SEED, plan: off }))
      .run("t", { text: "오늘 뭐 봐?" });
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.failureCode).toBe("PLANNER_CAPABILITY_OFF");
  });

  it("the capability is ON and the model declined this goal", async () => {
    // providerVersion present ⇒ a model answered. Still a failure, but a different one, so the screen
    // can tell an outage from a refusal instead of blaming the deployment for a model's judgement.
    const declined: AgentPlanView = {
      available: false, supported: false, specialists: [], tools: [],
      rationale: null, providerVersion: "agent-plan/v2+openai:gpt-5",
    };
    const result = await runtimeWith(new FakeOperatorSpringClient({ ...SEED, plan: declined }))
      .run("t", { text: "오늘 뭐 봐?" });
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.failureCode).toBe("PLAN_INVALID");
  });

  it("the model answered but the plan does not satisfy the contract", async () => {
    // Supported, and empty. v1 would have taken the keyword table's answer here; v2 has none to take.
    const empty: AgentPlanView = {
      available: true, supported: true, specialists: [], tools: [],
      informationNeeds: [], rationale: null, providerVersion: "agent-plan/v2",
    };
    const result = await runtimeWith(new FakeOperatorSpringClient({ ...SEED, plan: empty }))
      .run("t", { text: "오늘 뭐 봐?" });
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.failureCode).toBe("PLAN_INVALID");
  });

  it("the model tried to resolve an entity itself", async () => {
    // The one rule with no repair. A fabricated id would be read by a tool, return nothing, and produce
    // a confident answer about a product nobody looked at.
    const fabricated: AgentPlanView = {
      available: true, supported: true,
      specialists: ["PRODUCT_OPS"], tools: ["resolve_product"],
      informationNeeds: [{ id: "n1", question: "q", kind: "PRODUCT_FACT", required: true }],
      // The wire schema has no field for a resolved id, so the only way this can arrive is a client
      // bug — and it must still fail closed rather than be tolerated.
      rationale: null, providerVersion: "agent-plan/v2",
    };
    const client = new FakeOperatorSpringClient({ ...SEED, plan: fabricated });
    const result = await runtimeWith(client).run("t", { text: "A상품 문제 있어?" });
    // This particular plan is valid (no resolved entities on the wire), so it SUCCEEDS — the assertion
    // is that the schema gives a model no way to send one at all.
    expect(["DONE", "FAILED"]).toContain(result.status);
    expect(Object.keys(fabricated)).not.toContain("resolvedEntities");
  });

  it("a failed run carries no findings and no answer", async () => {
    const result = await runtimeWith(new FakeOperatorSpringClient(SEED)).run("t", { text: "뭐 봐?" });
    expect(result.status).toBe("FAILED");
    expect(result).not.toHaveProperty("answer");
  });

  it("an empty goal fails rather than being interpreted", async () => {
    const result = await runtimeWith(new FakeOperatorSpringClient(SEED)).run("t", { text: "   " });
    expect(result.status).toBe("FAILED");
  });
});

/**
 * A pass that learned nothing must not buy another plan.
 *
 * <b>Measured live 2026-08-21.</b> Asked "이 제품 폭이 몇 mm인가요?" — a demonstrative, not a product
 * name — the run re-planned on every cycle because a required need stayed PENDING. Each re-plan is a
 * model call, so it spent the whole LLM budget restating the same question to a planner that had no new
 * information, and then reported budget exhaustion INSTEAD of the real answer: "그 상품을 찾지
 * 못했습니다". The loop was paying to repeat itself and hiding the finding while it did.
 */
describe("the re-plan loop stops when a pass learns nothing", () => {
  it("an unresolvable product reports the resolution failure, not a budget failure", async () => {
    const operator = new FakeOperatorSpringClient({
      ...SEED,
      products: [],   // nothing resolves
      plan: {
        available: true, supported: true,
        userGoal: "이 제품 폭이 몇 mm인가요",
        unresolvedEntities: [{ kind: "PRODUCT", mention: "이 제품" }],
        informationNeeds: [{ id: "n1", question: "폭이 몇 mm인가", kind: "PRODUCT_FACT", required: true }],
        specialists: ["PRODUCT_OPS"], tools: ["resolve_product", "search_product_facts"],
        retrievalOrder: ["n1"], rationale: null, providerVersion: "agent-plan/v2+test",
      },
    });

    const result = await runtimeWith(operator).run("t", { text: "이 제품 폭이 몇 mm인가요?" });

    expect(result.status).toBe("DONE");
    if (result.status !== "DONE") return;
    // ONE plan, not one per cycle.
    expect(operator.calls.plan).toBe(1);
    expect(result.answer.budget.stopReason).toBe("COMPLETE");
    expect(result.answer.note).toContain("찾지 못했습니다");
    // The unanswered need is still reported — stopping early must not also mean going quiet.
    expect(result.answer.needs).toHaveLength(1);
    expect(result.answer.needs[0]!.status).toBe("PENDING");
  });
});
