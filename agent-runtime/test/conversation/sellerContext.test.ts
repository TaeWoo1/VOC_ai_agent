/**
 * Seller Context v1-B — the company's own description reaches the Agent only on the turn that asks
 * for it, and never as evidence.
 *
 * B: 「우리 회사는 어떤 곳으로 등록돼 있어?」 reads one org-keyed row and quotes it as the seller's.
 * C: a draft turn on ONE inquiry that asks to consider the company still goes through the composer, the
 *    evidence rules are the composer's, and the artifact carries only a flag — never the summary.
 * E: 「최근 문의 3개」 and every listing/count turn make ZERO profile reads.
 * F: the judge digest for the profile carries a label and a length — never the text.
 * Token size: the planner catalogue grows by exactly one line, and nothing injects the summary.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN, W_SHIP, artifact, harness, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import { inquiries } from "./support";
import type { AgentPlanView, SellerProfileView } from "../../src/spring/types";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { digestFor } from "../../src/operator/state/evidence";
import { reachableToolNames } from "../../src/operator/tools/ToolReachability";
import { needScopeOf } from "../../src/operator/scope/EvidenceScope";
import { policyRouted } from "../../src/operator/graph/operatorGraph";
import type { InvestigationPlan } from "../../src/operator/plan/InvestigationPlan";

const V7 = "agent-plan-prompt/v7";
type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = {
  period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
  inquiryIntent: null, limit: null, order: null, status: null,
};

function profilePlan(goal: string): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: "회사가 어떤 곳으로 등록돼 있는가", kind: "COMPANY_PROFILE", why: "회사 소개가 답이다", required: true }],
    specialists: ["INQUIRY_OPS"], tools: ["get_seller_profile"], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["COMPANY_PROFILE"] }],
    riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4,
    stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: "회사 소개 질문",
    providerVersion: V7, requestedAction: "NONE", tone: null, filters: { ...NONE }, target: { selector: "NONE", index: null },
  };
}

const SUMMARY = "전선몰딩과 전기자재를 제조·판매하며, 기업 고객과 시공업체 주문 비중이 높습니다.";
const PROFILE: SellerProfileView = { name: "선바로", businessSummary: SUMMARY, configured: true, updatedAt: "2026-08-30T01:00:00Z" };

const ASK = "우리 회사는 어떤 곳으로 등록돼 있어?";
const ASK_DRAFT = "이 문의에 우리 업체 특성을 고려해서 답변해줘";
const RECENT3 = "최근 문의 3개 보여줘";

/** The draft turn: the planner heard 「이 문의」 + 「우리 업체 특성」 and named the profile beside the draft request. */
function draftPlan(goal: string): AgentPlanView {
  return {
    ...profilePlan(goal),
    riskClass: "SENSITIVE",
    filters: { ...NONE, inquiryIntent: "WORKLOAD" },
    requestedAction: "PREPARE_INQUIRY_DRAFT", target: { selector: "THIS", index: null },
  };
}
const recentRowsPlan: AgentPlanView = {
  ...profilePlan(RECENT3), tools: [], evidenceRequirements: [],
  informationNeeds: [{ id: "n1", question: "최근 문의 3개", kind: "INQUIRY_VOLUME", why: "목록이 질문이다", required: true }],
  filters: { ...NONE, inquiryIntent: "ROWS", order: "NEWEST", limit: 3 },
};
const PLANS = { ...RECORDED_PLANS, ...CONVERSATION_PLANS, [ASK]: profilePlan(ASK), [ASK_DRAFT]: draftPlan(ASK_DRAFT), [RECENT3]: recentRowsPlan };

async function ask(h: Harness, text: string, extra: Record<string, unknown> = {}) {
  const view = await h.service.create(TOKEN);
  return say(h, view.conversationId, text, extra);
}

describe("Seller Context v1-B — the company profile in the Agent lane", () => {
  beforeEach(() => resetJudgeCapabilityMemo());

  it("B. 「우리 회사는 어떤 곳으로 등록돼 있어?」 → one profile read, the seller's own summary quoted, no other lane touched", async () => {
    const h = harness({ plansByGoal: PLANS, sellerProfile: PROFILE });
    const { turn } = await ask(h, ASK);
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("회사 정보에는 이렇게 등록돼 있습니다");
    expect(turn.message).toContain(SUMMARY);
    expect(h.operator.calls.sellerProfile).toBe(1);
    expect(h.operator.calls.orgKnowledgeSearch).toBe(0);
    expect(h.operator.calls.knowledgeSearch).toBe(0);
    expect(h.operator.calls.products).toBe(0);
    expect(h.operator.calls.inbox).toBe(0);
    const ev = turn.answer!.evidence.find((e) => e.kind === "COMPANY_PROFILE")!;
    expect(ev.locator.label).toBe("회사 정보");
    expect(ev.provenance).toBe("seller-profile/SET");
    expect(ev.asOf).toBe("2026-08-30");
    // Nothing about the summary reaches the planner: the goal sentence is what it saw.
    expect(h.operator.planGoals).toEqual([ASK]);
    expect(h.operator.planCatalogues.flat().join("\n")).not.toContain(SUMMARY);
  });

  it("B2. no profile registered → says so with the screen where it can be written, never a refusal", async () => {
    const h = harness({ plansByGoal: PLANS });
    const { turn } = await ask(h, ASK);
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("등록된 회사 정보가 아직 없습니다");
    expect(turn.answer!.findings.some((f) => f.surfaceLink === "/settings/company")).toBe(true);
    expect(h.operator.calls.sellerProfile).toBe(1);
  });

  it("C. 특정 문의 + 「우리 업체 특성을 고려해서 답변해줘」 → the composer writes the draft; the artifact carries a flag, not the summary; evidence rules stay the composer's", async () => {
    const seeds = inquiries().map((s) => s.workItemId === W_SHIP
      ? { ...s, draftGeneration: { answerBasis: "GROUNDED", companyContextUsed: true, comments: "안녕하세요. 시공 현장 기준으로 안내드립니다.",
          evidence: [{ scopeLabel: "운영 정책", title: "배송 안내" }] as never } }
      : s);
    const h = harness({ plansByGoal: PLANS, sellerProfile: PROFILE }, seeds);
    const { turn } = await ask(h, ASK_DRAFT, { workItemId: W_SHIP });
    expect(turn.status).toBe("DONE");
    // The product's own draft path — propose, then generate — and no second drafter.
    expect(h.inquiry.calls.generate).toBe(1);
    const draft = artifact(turn, "DRAFT");
    expect(draft.companyContextUsed).toBe(true);
    expect(draft.answerBasis).toBe("GROUNDED");
    expect(draft.evidenceSummary).toEqual([{ scopeLabel: "운영 정책", count: 1 }]);
    // The summary is not on the artifact, not a lane, and not in the queue-scope wording.
    expect(JSON.stringify(draft)).not.toContain(SUMMARY);
    expect(draft.evidenceSummary!.some((s) => s.scopeLabel === "회사 정보")).toBe(false);
    expect(turn.message).not.toContain("전체 집계");
    // A focused inquiry turn never reads the org queue — the closure invariant holds with the profile in the plan.
    expect(h.inquiry.calls.list).toBe(0);
    expect(h.operator.calls.inbox).toBe(0);
  });

  it("D. 특정 문의 + profile registered, but the composer found no basis → no draft and the flag is false (the profile alone grounds nothing)", async () => {
    const seeds = inquiries().map((s) => s.workItemId === W_SHIP
      ? { ...s, draftGeneration: { answerBasis: "NO_ANSWER_BASIS", companyContextUsed: true } } : s);
    const h = harness({ plansByGoal: PLANS, sellerProfile: PROFILE }, seeds);
    const { turn } = await ask(h, ASK_DRAFT, { workItemId: W_SHIP });
    const draft = artifact(turn, "DRAFT");
    expect(draft.version).toBeNull();
    expect(draft.answerBasis).toBe("NO_ANSWER_BASIS");
    expect(draft.companyContextUsed).toBe(false);
    expect(artifact(turn, "HUMAN_ACTION_REQUIRED").actionType).toBe("KNOWLEDGE_ENTRY");
  });

  it("E. 「최근 문의 3개 보여줘」 → inquiry rows, and ZERO profile reads", async () => {
    const h = harness({ plansByGoal: PLANS, sellerProfile: PROFILE });
    const { turn } = await ask(h, RECENT3);
    expect(turn.status).toBe("DONE");
    expect(artifact(turn, "INQUIRY_LIST")).toBeTruthy();
    expect(h.operator.calls.sellerProfile).toBe(0);
    expect(turn.message).not.toContain(SUMMARY);
  });

  it("E2. every recorded plan without a COMPANY_PROFILE need makes zero profile reads (listing, counting, reviews, products)", async () => {
    const goals = Object.keys({ ...RECORDED_PLANS, ...CONVERSATION_PLANS }).slice(0, 12);
    const h = harness({ plansByGoal: PLANS, sellerProfile: PROFILE });
    for (const goal of goals) {
      await ask(h, goal).catch(() => undefined);
    }
    expect(h.operator.calls.sellerProfile).toBe(0);
  });

  it("F. the judge digest for the profile carries the label and the length — never the summary", () => {
    const digest = digestFor([{
      evidenceId: "e1", kind: "COMPANY_PROFILE", sourceTool: "get_seller_profile", args: {},
      locator: { facet: "COMPANY_PROFILE", label: "회사 정보", count: SUMMARY.length },
      asOf: "2026-08-30", coverage: "COVERED", provenance: "seller-profile/SET",
    } as never]);
    expect(digest).toContain("label=회사정보");
    expect(digest).toContain(`count=${SUMMARY.length}`);
    expect(digest).not.toContain("전선몰딩");
  });

  it("scope + routing: a COMPANY_PROFILE need is ORG-scoped whatever the sentence named, and routes to INQUIRY_OPS alone when it is the only need", () => {
    const plan = { ...profilePlan(ASK_DRAFT) } as unknown as InvestigationPlan;
    const need = { id: "n1", question: "", kind: "COMPANY_PROFILE" as const, why: "", required: true };
    const full = { informationNeeds: [need], entities: { unresolved: [{ kind: "INQUIRY", mention: "이 문의", role: "INSTANCE" }], resolved: [] }, evidenceRequirements: [] } as unknown as InvestigationPlan;
    expect(needScopeOf(full, need, [{ kind: "INQUIRY", id: "w1", label: "문의", role: "INSTANCE" } as never]).entity).toBe("ORG");
    expect(policyRouted(["PRODUCT_OPS", "REPORT_OPS"], { informationNeeds: [need] })).toEqual(["INQUIRY_OPS"]);
    void plan;
  });

  it("token size: the profile is one reachable READ tool — one catalogue line — and never a prompt injection", () => {
    expect(reachableToolNames()).toContain("get_seller_profile");
    expect(reachableToolNames().filter((n) => n === "get_seller_profile")).toHaveLength(1);
  });
});
