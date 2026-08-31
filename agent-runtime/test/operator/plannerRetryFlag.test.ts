/**
 * Agent Responsiveness v1 §3 — exactly one call asks the backend for deeper reasoning.
 *
 * The backend spends its stronger `reasoning-effort` on requests marked `retry`, and this is the only
 * place in the repository that marks one. The assertions are about WHICH call carries the flag, because
 * that is the whole decision: the measurement behind it says one plan call is 98–99% of a turn, so
 * every request that carries this flag unnecessarily is seconds of somebody's day.
 *
 * The two rejected neighbours are pinned here as well, since both were tried and measured:
 *   * a FIRST plan carrying a conversation's working-set line — an ordinary follow-up sentence;
 *   * a RE-PLAN the graph asked for — about the world, not about the plan's difficulty.
 */
import { describe, it, expect } from "vitest";
import { LlmInvestigationPlanner } from "../../src/operator/plan/LlmInvestigationPlanner";
import type { AgentPlanView } from "../../src/spring/types";

const LIMITS = { maxIterations: 3, maxToolCalls: 24 };
const CATALOGUE = ["list_inquiry_rows: 문의 행을 읽는다"];

function planView(overrides: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    available: true, supported: true, userGoal: "최근 문의를 보고 싶다", unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: "최근 문의", kind: "INQUIRY_VOLUME", why: "", required: true }],
    specialists: ["INQUIRY_OPS"], tools: ["list_inquiry_rows"], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4,
    stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: "",
    providerVersion: "test", requestedAction: "NONE", tone: null,
    filters: {
      period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
      inquiryIntent: "ROWS", limit: null, order: null, status: null,
    },
    target: { selector: "NONE", index: null },
    ...overrides,
  } as AgentPlanView;
}

/** Records the `retry` flag of every request that leaves. */
function recorder(views: AgentPlanView[]) {
  const flags: (boolean | undefined)[] = [];
  let call = 0;
  return {
    flags,
    backend: {
      async planGoal(request: { retry?: boolean }): Promise<AgentPlanView> {
        flags.push(request.retry);
        return views[Math.min(call++, views.length - 1)]!;
      },
    },
  };
}

describe("which plan request asks for deeper reasoning", () => {
  it("a first plan does not — with or without a conversation's working-set line", async () => {
    const bare = recorder([planView()]);
    await new LlmInvestigationPlanner(bare.backend).plan({
      request: { text: "최근 문의 3개 보여줘" } as never, catalogue: CATALOGUE, limits: LIMITS,
    });
    expect(bare.flags).toEqual([undefined]);

    // The follow-up shape: `priorContext` present, nothing hard about it.
    const followUp = recorder([planView()]);
    await new LlmInvestigationPlanner(followUp.backend).plan({
      request: { text: "그중 네이버만" } as never, catalogue: CATALOGUE, limits: LIMITS,
      priorContext: "직전 작업 집합: INQUIRIES (기간:없음, 채널:전체, 평점:ALL, 상태:없음, 상품 특정:아니오)",
    });
    expect(followUp.flags).toEqual([undefined]);
  });

  it("the repair after a refused plan does, and it is the only request that does", async () => {
    // PRODUCT_UNRESOLVABLE — the one rejection a re-plan can fix, and so the only one that repairs:
    // the goal names a product while the plan dispatches nobody who could resolve it.
    const rejected = planView({
      unresolvedEntities: [{ kind: "PRODUCT", mention: "전선몰딩" }],
      informationNeeds: [{ id: "n1", question: "이 상품의 규격", kind: "PRODUCT_FACT", why: "", required: true }],
      specialists: ["INQUIRY_OPS"], tools: [],
    });
    const r = recorder([rejected, planView()]);
    await new LlmInvestigationPlanner(r.backend).plan({
      request: { text: "전선몰딩 폭이 몇 mm예요?" } as never, catalogue: CATALOGUE, toolNames: ["list_inquiry_rows"],
      limits: LIMITS,
    }).catch(() => undefined);

    expect(r.flags.length).toBeGreaterThanOrEqual(2);
    expect(r.flags[0]).toBeUndefined();
    expect(r.flags[1]).toBe(true);
    // Nothing after the bounded repair — two attempts is the bound, and a third would be a third bill.
    expect(r.flags.length).toBe(2);
  });
});
