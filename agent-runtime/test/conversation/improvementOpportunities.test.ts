/**
 * Opportunity Engine v1 in the conversation: the card is the object, and the prose does not repeat its rows.
 */
import { describe, expect, it } from "vitest";
import { harness, say, artifact, TOKEN } from "./support";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues } from "../support/issueFixtures";
import { MOLDING } from "../support/operatorFixtures";
import type { AgentPlanView, ImprovementOpportunitySummary } from "../../src/spring/types";

const GOAL = "최근 반복 문제에서 개선할 만한 것이 있어?";

const PLAN: AgentPlanView = {
  available: true, supported: true, userGoal: GOAL, unresolvedEntities: [],
  informationNeeds: [{ id: "n1", question: "반복 문제에서 판매자가 손볼 수 있는 곳은 어디인가",
    kind: "IMPROVEMENT_OPPORTUNITY", why: "개선 기회 자체가 질문이다", required: true }],
  specialists: ["REVIEW_OPS"], tools: ["list_improvement_opportunities"],
  retrievalOrder: ["n1"], retrievalParallel: [], retrievalStopWhen: null, evidenceRequirements: [],
  riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null,
  clarificationNeeded: false, clarificationReason: null, rationale: null, providerVersion: "AUTHORED (Opportunity Engine v1)",
};

function row(kind: string, label: string, recommendation: string, issueId: string): ImprovementOpportunitySummary {
  return {
    issueId, kind, kindLabelKo: label, status: "OPEN", statusLabelKo: "검토 전", issueTitle: "접착 탈락", aspect: "접착",
    problem: "탈락", severity: "NORMAL", evidenceCount: 5, firstEvidenceOn: "2026-08-01", lastEvidenceOn: "2026-08-20",
    changeLabelsKo: [], productId: MOLDING.id, productName: MOLDING.name, whyKo: [], recommendationKo: recommendation,
    evidenceTo: `/memory/${issueId}`, nextActionKo: "FAQ 초안 준비", decidedAt: null,
  };
}

describe("개선 기회 — the conversation draws the derived object and says each fact once", () => {
  it("answers with the OPPORTUNITY_LIST card, rows into the issue surface, and no row repeated as prose", async () => {
    const issue = new FakeIssueSpringClient(fourIssues());
    const faq = "'접착' 관련 안내를 이 상품의 자주 묻는 질문에 추가하는 것을 검토하세요.";
    const memo = "'접착 탈락' 불만이 반복됩니다. 제품이나 포장 자체를 바꿔야 하는지 검토하세요.";
    issue.opportunities = [
      row("FAQ_SUPPLEMENT", "FAQ 보완", faq, "aaaa0000-0000-0000-0000-0000000000a2"),
      row("PRODUCT_IMPROVEMENT_REVIEW", "제품 개선 검토", memo, "aaaa0000-0000-0000-0000-0000000000a2"),
    ];
    const h = harness({ plansByGoal: { [GOAL]: PLAN } }, undefined, issue);
    const view = await h.service.create(TOKEN);
    const { turn } = await say(h, view.conversationId, GOAL);
    expect(turn.status).toBe("DONE");
    const card = artifact(turn, "OPPORTUNITY_LIST");
    expect(card.items.map((i) => i.kindLabelKo)).toEqual(["FAQ 보완", "제품 개선 검토"]);
    expect(card.items.every((i) => i.to === "/memory/aaaa0000-0000-0000-0000-0000000000a2")).toBe(true);
    expect(turn.message.startsWith("개선할 만한 기회 2건을 확인했습니다.")).toBe(true);
    // The card carries the recommendations; the prose does not say them again.
    expect(turn.message).not.toContain(faq);
    expect(turn.message).not.toContain(memo);
    expect(issue.reads.opportunities).toBe(1);
  });

  it("an empty derivation is said as such — no invented row", async () => {
    const issue = new FakeIssueSpringClient(fourIssues());
    const h = harness({ plansByGoal: { [GOAL]: PLAN } }, undefined, issue);
    const view = await h.service.create(TOKEN);
    const { turn } = await say(h, view.conversationId, GOAL);
    const card = artifact(turn, "OPPORTUNITY_LIST");
    expect(card.items).toHaveLength(0);
    expect(turn.message.startsWith("지금 제안할 개선 기회가 없습니다.")).toBe(true);
  });
});
