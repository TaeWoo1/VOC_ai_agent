/**
 * Agent Responsiveness v1 §5 — the chips describe THIS answer, not the last list.
 *
 * A conversation stays anchored on the set it last saw so that 「그중…」 keeps a referent. That anchor
 * used to reach the chip builder, so an org-scope answer that drew no list at all arrived with 「첫 번째
 * 거 답변 준비해줘」 attached — three next moves about rows the answer had nothing to do with, offered
 * under a policy sentence. The anchor is a fact about the conversation; the chips are examples of what
 * to say next about the answer, and the two had been the same value.
 *
 * What must NOT change with the fix: the anchor itself. If the set stopped being carried forward, the
 * refine lane would lose its noun and every 「그중」 would become a new org-wide question — which is the
 * defect this package's own scope-integrity ancestors were written to prevent. So both assertions live
 * in one test: the set survives, the chips about it do not.
 */
import { describe, it, expect } from "vitest";
import type { AgentPlanView } from "../../src/spring/types";
import { TODAY, TOKEN, artifact, harness } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";

const LIST_SENTENCE = "오늘 내가 답해야 할 문의 정리해줘";
/** A company-policy question: ORG scope, INQUIRY_OPS alone, and no rows of its own to draw. */
const ORG_SENTENCE = "우리 배송 정책 뭐였지?";

/**
 * The org-scope plan — POLICY-only, so `policyRouted` keeps it on INQUIRY_OPS and it resolves no
 * product. That is what makes it the shape this test needs: a turn that ANSWERS (so its chips are
 * really computed) while drawing no set of its own (so the only set in play is the carried anchor).
 */
const ORG_PLAN: AgentPlanView = {
  available: true, supported: true, userGoal: ORG_SENTENCE, unresolvedEntities: [],
  informationNeeds: [{ id: "n1", question: "회사의 배송 기준이 무엇인가", kind: "POLICY", why: "", required: true }],
  specialists: ["INQUIRY_OPS"], tools: ["search_org_knowledge"], retrievalOrder: ["n1"], retrievalParallel: [],
  retrievalStopWhen: null, evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["POLICY"] }],
  riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4, stopWhenEnough: null,
  clarificationNeeded: false, clarificationReason: null, rationale: "", providerVersion: "agent-plan-prompt/v10",
  requestedAction: "NONE", tone: null,
  filters: {
    period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
    inquiryIntent: null, limit: null, order: null, status: null,
  },
  target: { selector: "NONE", index: null },
};

function answering(): ReturnType<typeof harness> {
  return harness({ plansByGoal: { ...RECORDED_PLANS, ...CONVERSATION_PLANS, [ORG_SENTENCE]: ORG_PLAN } });
}

async function conversationId(h: ReturnType<typeof harness>): Promise<string> {
  const { conversationId: id } = await h.service.create(TOKEN);
  return id;
}

describe("chips follow the answer, the anchor follows the conversation", () => {
  it("an org-scope answer that drew no list offers no chips about the previous list", async () => {
    const h = answering();
    const id = await conversationId(h);

    const listed = await h.service.turn(TOKEN, id, { text: LIST_SENTENCE, referenceDate: TODAY } as never, () => undefined);
    const rows = artifact(listed, "INQUIRY_LIST").groups.flatMap((g) => g.items);
    expect(rows.length).toBeGreaterThan(1);
    const set = listed.continuation.workingSet;
    expect(set).not.toBeNull();
    // The list turn's own chips are about the list — that is the behaviour being preserved, not removed.
    expect(listed.suggestedActions.some((s) => s.kind === "PROMPT")).toBe(true);

    const org = await h.service.turn(TOKEN, id, { text: ORG_SENTENCE, referenceDate: TODAY } as never, () => undefined);
    // Both guards against a vacuous pass: a FAILED turn and a turn that drew its own list would each
    // satisfy the loop below without exercising the fix at all.
    expect(org.status).toBe("DONE");
    expect(org.message.length).toBeGreaterThan(0);
    expect(org.artifacts.some((a) => a.type === "INQUIRY_LIST")).toBe(false);

    // The defect: prompts naming rows this turn never drew.
    const prompts = org.suggestedActions.filter((s) => s.kind === "PROMPT").map((s) => s.label);
    for (const label of prompts) {
      expect(label).not.toMatch(/첫 번째|그중|안 좋은 것만|상품별로 묶어/);
    }

    // …and the anchor is still there, so the next 「그중…」 still has something to mean.
    expect(org.continuation.workingSet?.ids).toEqual(set?.ids);
    expect(org.continuation.workingSet?.count).toBe(set?.count);
  });

  /**
   * The half of the fix that is about NOT breaking something: dropping the chips must not drop the
   * anchor with them. A refine spoken after the org-scope answer still lands on the rows the seller
   * saw — if it went org-wide instead, this package would have re-opened the scope-contamination
   * defect Conversation Core §9 closed.
   */
  it("a refine after the org-scope answer still lands on the rows the seller saw", async () => {
    const h = answering();
    const id = await conversationId(h);
    const listed = await h.service.turn(TOKEN, id, { text: LIST_SENTENCE, referenceDate: TODAY } as never, () => undefined);
    const before = listed.continuation.workingSet!;
    expect(before.count).toBeGreaterThan(1);

    await h.service.turn(TOKEN, id, { text: ORG_SENTENCE, referenceDate: TODAY } as never, () => undefined);
    // The policy answer finds no registered standard and asks whether to save one, and while that
    // question is open the NEXT sentence is the seller's answer to it (Knowledge Capture v1) — so the
    // gap is closed first. That is existing behaviour and not what this test is about.
    await h.service.turn(TOKEN, id, { text: "취소", referenceDate: TODAY } as never, () => undefined);

    // The deterministic filter lane: no planner, no read — it acts on the visible set or it does not
    // run at all, so its answer is proof of which set the conversation is standing on.
    const refined = await h.service.turn(TOKEN, id, { text: "그중 카페24만", referenceDate: TODAY } as never, () => undefined);
    expect(refined.budget?.llmCalls ?? 0).toBe(0);
    expect(refined.message).toContain("방금 본");
  });
});
