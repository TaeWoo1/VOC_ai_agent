/**
 * Opportunity Engine v1 — 「최근 반복 문제에서 개선할 만한 것 있어?」 answered with the SAME derived objects
 * the product and issue screens show, and nothing the runtime made up.
 *
 * Pinned:
 *  1. An IMPROVEMENT_OPPORTUNITY need is served by ONE read of the backend's derived rows — the runtime
 *     derives no opportunity, names no cause, and the sentences a seller reads are the backend's.
 *  2. A resolved product narrows the read (productId on the wire); none is required.
 *  3. The card is the object: rows into `/memory/{issueId}`, where accept/dismiss and the draft live.
 *  4. An empty answer is said as such and no row is invented.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import {
  ANALYSES, CABLE, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS, coveredSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import { RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView, ImprovementOpportunitySummary } from "../../src/spring/types";

const ORG_GOAL = "최근 반복 문제에서 개선할 만한 것이 있어?";
const PRODUCT_GOAL = `${MOLDING.name}에서 개선할 만한 것이 있어?`;

const AUTHORED = "AUTHORED (Opportunity Engine v1)";

function plan(goal: string, product: string | null): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal,
    unresolvedEntities: product ? [{ kind: "PRODUCT", mention: product }] : [],
    informationNeeds: [{ id: "n1", question: "반복 문제에서 판매자가 손볼 수 있는 곳은 어디인가",
      kind: "IMPROVEMENT_OPPORTUNITY", why: "개선 기회 자체가 질문이다", required: true }],
    specialists: product ? ["PRODUCT_OPS", "REVIEW_OPS"] : ["REVIEW_OPS"],
    tools: product ? ["resolve_product", "list_improvement_opportunities"] : ["list_improvement_opportunities"],
    retrievalOrder: ["n1"], retrievalParallel: [], retrievalStopWhen: null, evidenceRequirements: [],
    riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null,
    clarificationNeeded: false, clarificationReason: null, rationale: null, providerVersion: AUTHORED,
  };
}

function opportunity(over: Partial<ImprovementOpportunitySummary> = {}): ImprovementOpportunitySummary {
  return {
    issueId: "aaaa0000-0000-0000-0000-0000000000a2", kind: "FAQ_SUPPLEMENT", kindLabelKo: "FAQ 보완",
    status: "OPEN", statusLabelKo: "검토 전", issueTitle: "접착 탈락", aspect: "접착", problem: "탈락", severity: "NORMAL",
    evidenceCount: 5, firstEvidenceOn: "2026-08-01", lastEvidenceOn: "2026-09-01", changeLabelsKo: ["증가 중"],
    productId: MOLDING.id, productName: MOLDING.name,
    whyKo: ["「접착 탈락」 근거 리뷰 5건 (2026-08-01 ~ 2026-09-01)."],
    recommendationKo: "'접착' 관련 안내를 이 상품의 자주 묻는 질문에 추가하는 것을 검토하세요.",
    evidenceTo: "/memory/aaaa0000-0000-0000-0000-0000000000a2", nextActionKo: "FAQ 초안 준비", decidedAt: null,
    ...over,
  };
}

function build(opportunities: ImprovementOpportunitySummary[]) {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX, products: [MOLDING, CABLE],
    signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
    knowledge: KNOWLEDGE, customerMemory: MEMORY, repeats: REPEATS, itemAnalyses: ANALYSES,
    plansByGoal: { ...RECORDED_PLANS, [ORG_GOAL]: plan(ORG_GOAL, null), [PRODUCT_GOAL]: plan(PRODUCT_GOAL, MOLDING.name) },
  });
  const inquiry = new FakeSpringClient(twoInquiries());
  const issue = new FakeIssueSpringClient();
  issue.opportunities = opportunities;
  return { runtime: new OperatorAgentRuntime({ operator, inquiry, issue }), operator, inquiry, issue };
}

function done(result: OperatorRunResult) {
  if (result.status !== "DONE") throw new Error(`expected DONE, got ${result.status}: ${result.failureCode} — ${result.reason}`);
  return result;
}

describe("Opportunity Engine v1 — the conversation shows the same derived object, and derives none", () => {
  it("an org question reads the backend's rows once and draws them as the OPPORTUNITY_LIST card", async () => {
    const { runtime, issue } = build([
      opportunity(),
      opportunity({ kind: "PRODUCT_IMPROVEMENT_REVIEW", kindLabelKo: "제품 개선 검토",
        recommendationKo: "'접착 탈락' 불만이 반복됩니다. 제품이나 포장 자체를 바꿔야 하는지 검토하세요." }),
    ]);
    const result = done(await runtime.run("o-1", { text: ORG_GOAL }));
    expect(issue.reads.opportunities).toBe(1);
    const card = result.artifacts.find((a) => a.type === "OPPORTUNITY_LIST");
    expect(card).toBeDefined();
    if (card?.type !== "OPPORTUNITY_LIST") throw new Error("card");
    expect(card.productId).toBeNull();
    expect(card.items.map((i) => i.kindLabelKo)).toEqual(["FAQ 보완", "제품 개선 검토"]);
    expect(card.items[0]!.to).toBe("/memory/aaaa0000-0000-0000-0000-0000000000a2");
    // The findings carry the backend's sentence verbatim and rest on IMPROVEMENT_OPPORTUNITY evidence.
    const findings = result.answer.findings.filter((f) => f.specialist === "REVIEW_OPS");
    expect(findings.map((f) => f.statement)).toEqual([
      "FAQ 보완 — '접착' 관련 안내를 이 상품의 자주 묻는 질문에 추가하는 것을 검토하세요. (근거 리뷰 5건, " + MOLDING.name + ")",
      "제품 개선 검토 — '접착 탈락' 불만이 반복됩니다. 제품이나 포장 자체를 바꿔야 하는지 검토하세요. (근거 리뷰 5건, " + MOLDING.name + ")",
    ]);
    expect(result.answer.evidence.filter((e) => e.kind === "IMPROVEMENT_OPPORTUNITY")).toHaveLength(2);
    expect(findings.every((f) => f.surfaceLink?.startsWith("/memory/"))).toBe(true);
    // No cause or effect anywhere in the answer — the vocabulary the engine refuses.
    for (const f of findings) expect(f.statement).not.toMatch(/원인입니다|때문입니다|해결됩니다/);
  });

  it("a product question narrows the read to the resolved product's rows", async () => {
    const { runtime, issue } = build([
      opportunity(),
      opportunity({ issueId: "aaaa0000-0000-0000-0000-0000000000a9", productId: CABLE.id, productName: CABLE.name,
        issueTitle: "포장 파손", kind: "PRODUCT_IMPROVEMENT_REVIEW", kindLabelKo: "제품 개선 검토" }),
    ]);
    const result = done(await runtime.run("o-2", { text: PRODUCT_GOAL }));
    const card = result.artifacts.find((a) => a.type === "OPPORTUNITY_LIST");
    if (card?.type !== "OPPORTUNITY_LIST") throw new Error("card");
    expect(card.productId).toBe(MOLDING.id);
    expect(card.items).toHaveLength(1);
    expect(card.items[0]!.issueTitle).toBe("접착 탈락");
    expect(issue.reads.opportunities).toBe(1);
  });

  it("nothing derived is said as nothing — no row, no invented suggestion", async () => {
    const { runtime } = build([]);
    const result = done(await runtime.run("o-3", { text: ORG_GOAL }));
    const card = result.artifacts.find((a) => a.type === "OPPORTUNITY_LIST");
    if (card?.type !== "OPPORTUNITY_LIST") throw new Error("card");
    expect(card.items).toHaveLength(0);
    expect(result.answer.findings.filter((f) => f.specialist === "REVIEW_OPS")).toHaveLength(0);
    expect(result.answer.evidence.filter((e) => e.kind === "IMPROVEMENT_OPPORTUNITY")).toHaveLength(0);
  });
});
