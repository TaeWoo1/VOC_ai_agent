/**
 * Pilot Readiness Closure v1 — the two interaction contracts (§6).
 *
 * §6-A <b>Naming a row by its position is the same act as pressing it.</b> An ordinal over a review
 *      list used to narrow the working set and announce 「N번째 리뷰를 골랐습니다」 — the product telling
 *      the seller that something happened somewhere else. The click path and the 「이 리뷰」 path both
 *      draw the review's own card; the ordinal is neither more ambiguous nor cheaper than either.
 *
 * §6-B <b>UNKNOWN was a budget decision, not an honest one.</b> The deterministic inspect lane
 *      hardcoded `replyCapability: "UNKNOWN"` because it had chosen to make one read, so the reply
 *      control never appeared on the path a seller actually reaches by clicking. It now resolves the
 *      question with the same read and the same resolver the planner path uses — and still answers
 *      UNKNOWN when nothing answered, because 「확인하지 못했습니다」 and 「지원하지 않습니다」 are
 *      different claims and only one of them was observed.
 */
import { describe, it, expect } from "vitest";
import { TOKEN, artifact, harness, say } from "./support";
import type { AgentPlanView, ReviewChannelCapabilityView, ReviewDetailResponse } from "../../src/spring/types";
import { MOLDING } from "../support/operatorFixtures";

const V3 = "test-planner/v3";

const ROWS_PLAN: AgentPlanView = {
  available: true, supported: true, userGoal: "오늘 새로 달린 리뷰", unresolvedEntities: [],
  informationNeeds: [{ id: "n1", question: "리뷰", kind: "REVIEW_SIGNAL", why: "", required: true }],
  specialists: ["REVIEW_OPS"], tools: ["list_recent_reviews"],
  retrievalOrder: ["n1"], retrievalParallel: [], retrievalStopWhen: null, evidenceRequirements: [],
  riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4, stopWhenEnough: null, clarificationNeeded: false,
  clarificationReason: null, rationale: null, providerVersion: V3, requestedAction: "NONE", tone: null,
  filters: { period: "TODAY", rating: null, channel: null, scope: null, topic: null } as never,
  target: { selector: "NONE", index: null },
};

function detail(over: Partial<ReviewDetailResponse> = {}): ReviewDetailResponse {
  return {
    id: "r-2", sellerAccountId: "acc-cafe24", channelCode: "CAFE24", channelNameKo: "카페24",
    writtenOn: "2026-08-27", rating: 2, negative: true,
    body: "접착이 금방 떨어졌어요. 다시 붙여도 마찬가지입니다.", bodyRedacted: false,
    productId: MOLDING.id, productName: MOLDING.name, replyState: "NONE", executableIdentity: "MARKETPLACE",
    triageTier: "NEEDS_ATTENTION", issues: [],
    ...over,
  };
}

const REPLIES_ALLOWED: ReviewChannelCapabilityView = {
  channelCode: "CAFE24", aiTriage: true, originalLocate: "EXACT", replySupported: true,
  executionKind: "API_EXECUTION",
};
const REPLIES_UNSUPPORTED: ReviewChannelCapabilityView = {
  channelCode: "COUPANG", aiTriage: true, originalLocate: "EXACT", replySupported: false,
};

/** A thread that has drawn the review list — nothing selected yet. */
async function listed(capabilities?: Record<string, ReviewChannelCapabilityView>) {
  const h = harness({
    plansByGoal: { "오늘 새로 달린 리뷰 보여줘": ROWS_PLAN },
    reviewDetails: { "r-2": detail() },
    ...(capabilities ? { reviewChannelCapabilities: capabilities } : {}),
  });
  const { conversationId: id } = await h.service.create(TOKEN);
  const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
  return { h, id, rows: first.turn.continuation.workingSet };
}

describe("§6-A — an ordinal over a review list selects AND shows the exact review", () => {
  it("draws the same card a click draws, anchors the same object, and calls no planner", async () => {
    const { h, id, rows } = await listed();
    expect(rows?.kind).toBe("REVIEWS");
    const index = (rows?.ids ?? []).indexOf("r-2") + 1;
    expect(index).toBeGreaterThan(0);
    const plansBefore = h.operator.calls.plan;

    const { turn } = await say(h, id, `${index}번째 리뷰 자세히 보여줘`);

    expect(h.operator.calls.plan).toBe(plansBefore);
    const card = artifact(turn, "REVIEW_DETAIL");
    expect(card).toMatchObject({ reviewId: "r-2", rating: 2, productId: MOLDING.id });
    expect(card.body).toContain("접착이 금방 떨어졌어요");
    expect(turn.continuation.workingSet?.selectedObject).toMatchObject({ kind: "REVIEW", id: "r-2" });
    expect(turn.continuation.activeTask).toBe("INSPECT");
    // The old behaviour: an announcement that a selection happened, and nothing to look at.
    expect(turn.message).not.toContain("골랐습니다");
  });

  it("an ordinal past the end of the set is not answered from the anchor", async () => {
    const { h, id, rows } = await listed();
    const past = (rows?.ids.length ?? 0) + 5;

    const { turn } = await say(h, id, `${past}번째 리뷰 자세히 보여줘`);

    expect(turn.artifacts.some((a) => a.type === "REVIEW_DETAIL")).toBe(false);
  });
});

describe("§6-B — the deterministic lane answers what the seller can DO with the review", () => {
  it("resolves DRAFTABLE from the channel's own capability, not from the channel code", async () => {
    const { h, id, rows } = await listed({ "acc-cafe24": REPLIES_ALLOWED });
    const index = (rows?.ids ?? []).indexOf("r-2") + 1;

    const { turn } = await say(h, id, `${index}번째 리뷰 자세히 보여줘`);

    expect(artifact(turn, "REVIEW_DETAIL").replyCapability).toBe("DRAFTABLE");
    expect(h.operator.calls.reviewChannelCapability).toBe(1);
  });

  it("a channel with no seller reply flow is stated as unsupported, not as unchecked", async () => {
    const { h, id, rows } = await listed({ "acc-cafe24": REPLIES_UNSUPPORTED });
    const index = (rows?.ids ?? []).indexOf("r-2") + 1;

    const { turn } = await say(h, id, `${index}번째 리뷰 자세히 보여줘`);

    expect(artifact(turn, "REVIEW_DETAIL").replyCapability).toBe("NOT_SUPPORTED");
  });

  it("a capability read that answers nothing stays UNKNOWN — an absent view is not a refusal", async () => {
    const { h, id, rows } = await listed();
    const index = (rows?.ids ?? []).indexOf("r-2") + 1;

    const { turn } = await say(h, id, `${index}번째 리뷰 자세히 보여줘`);

    expect(artifact(turn, "REVIEW_DETAIL").replyCapability).toBe("UNKNOWN");
  });
});
