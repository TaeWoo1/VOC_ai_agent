/**
 * Agent Object + First-use Closure v1 — the runtime half.
 *
 * §1 <b>A review the seller is standing on can be worked with.</b> Before this the anchor existed and
 *    answered nothing: the only review reads were a window list and an org-wide issue list, so
 *    「이 리뷰 자세히 봐줘」 either printed a list again or — when the demonstrative was let through to
 *    the product — answered a question about a ★1 with that product's most recent ★5 (measured live
 *    2026-09-01 and reverted the same day). The exact read is the object; the widening is named.
 * §1-B <b>The anchor survives the turn that answers about it.</b> `workingSetOf` returns null for a
 *    turn that drew artifacts but no SET, so a product/review anchor used to be dropped by the very
 *    turn it produced — the second 「이 리뷰…」 went to the org.
 * §3 <b>One channel's collection state is said once</b> — by the card that also carries the control.
 * §4 <b>The capability answer follows the catalogue</b>, down to a single new read.
 */
import { describe, it, expect } from "vitest";
import { TOKEN, artifact, harness, say } from "./support";
import type { AgentPlanView, ReviewChannelCapabilityView, ReviewDetailResponse } from "../../src/spring/types";
import { OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";
import { MOLDING } from "../support/operatorFixtures";
import { overviewAnswer } from "../../src/operator/capability/ProductSelfKnowledge";
import type { SellerReadiness } from "../../src/operator/capability/SellerReadiness";

/** A seller who has started: the capability answer's readiness input, in its ordinary shape. */
const WORKING = (connected: string[]): SellerReadiness =>
  ({ kind: "WORKING", connected, connectable: [], delegable: ["INQUIRY", "REVIEW", "ORDER"] });
import { issueSentence, reviewLine } from "../../src/operator/graph/reviewDetail";
import { TOOL_CAPABILITIES } from "../../src/operator/tools/ToolReachability";

const V3 = "test-planner/v3";

const REVIEW_PLAN: AgentPlanView = {
  available: true, supported: true, userGoal: "선택한 리뷰를 자세히", unresolvedEntities: [],
  informationNeeds: [{ id: "n1", question: "이 리뷰는", kind: "REVIEW_SIGNAL", why: "", required: true }],
  specialists: ["REVIEW_OPS"], tools: [OPERATOR_TOOL.GET_REVIEW_DETAIL, OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY],
  retrievalOrder: ["n1"], retrievalParallel: [], retrievalStopWhen: null, evidenceRequirements: [],
  riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4, stopWhenEnough: null, clarificationNeeded: false,
  clarificationReason: null, rationale: null, providerVersion: V3, requestedAction: "NONE", tone: null,
  filters: { period: null, rating: null, channel: null, scope: null, topic: null },
  target: { selector: "NONE", index: null },
};

/** The same anchored turn, but the seller asked for ROWS — the widening, which the sentence must name. */
const SIMILAR_PLAN: AgentPlanView = {
  ...REVIEW_PLAN,
  userGoal: "같은 상품의 비슷한 리뷰",
  tools: [OPERATOR_TOOL.LIST_RECENT_REVIEWS],
  filters: { period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: "ROWS" } as never,
};

const ROWS_PLAN: AgentPlanView = {
  ...REVIEW_PLAN,
  userGoal: "오늘 새로 달린 리뷰",
  tools: [OPERATOR_TOOL.LIST_RECENT_REVIEWS],
  filters: { period: "TODAY", rating: null, channel: null, scope: null, topic: null } as never,
};

function detail(over: Partial<ReviewDetailResponse> = {}): ReviewDetailResponse {
  return {
    id: "r-2", sellerAccountId: "acc-cafe24", channelCode: "CAFE24", channelNameKo: "카페24",
    writtenOn: "2026-08-27", rating: 2, negative: true,
    body: "접착이 금방 떨어졌어요. 다시 붙여도 마찬가지입니다.", bodyRedacted: false,
    productId: MOLDING.id, productName: MOLDING.name, replyState: "NONE", executableIdentity: "MARKETPLACE",
    triageTier: "NEEDS_ATTENTION",
    issues: [{ issueId: "iss-1", title: "접착력 부족", severity: "HIGH", occurredOn: "2026-08-27" }],
    ...over,
  };
}

/** A conversation that has drawn the review list and clicked one of its rows. */
async function anchored(
  plans: Record<string, AgentPlanView>, reviewDetails: Record<string, ReviewDetailResponse>,
  reviewChannelCapabilities?: Record<string, ReviewChannelCapabilityView>,
) {
  const h = harness({
    plansByGoal: { "오늘 새로 달린 리뷰 보여줘": ROWS_PLAN, ...plans }, reviewDetails,
    ...(reviewChannelCapabilities ? { reviewChannelCapabilities } : {}),
  });
  const { conversationId: id } = await h.service.create(TOKEN);
  await say(h, id, "오늘 새로 달린 리뷰 보여줘");
  await h.service.turn(TOKEN, id, { select: { kind: "REVIEW", reviewId: "r-2" } } as never, () => undefined);
  return { h, id };
}

describe("§1 — the selected review is the object the answer is about", () => {
  it("reads THAT review exactly, states its own facts and what it is evidence for, and keeps the customer's words transient", async () => {
    const { h, id } = await anchored({ "이 리뷰 자세히 봐줘": REVIEW_PLAN }, { "r-2": detail() });
    const before = h.operator.calls.recentReviews;

    const { turn } = await say(h, id, "이 리뷰 자세히 봐줘");

    expect(h.operator.reviewDetailIds).toEqual(["r-2"]);
    // Not the window list, not the issue list: an anchored review question buys neither.
    expect(h.operator.calls.recentReviews).toBe(before);
    const card = artifact(turn, "REVIEW_DETAIL");
    expect(card).toMatchObject({
      reviewId: "r-2", rating: 2, negative: true, productId: MOLDING.id, channelNameKo: "카페24",
      // No channel capability exists to read in this harness, so the honest verdict is UNKNOWN — the
      // card says it did not check rather than claiming the channel refuses replies.
      replyCapability: "UNKNOWN",
    });
    expect(card.issues).toEqual([{ issueId: "iss-1", title: "접착력 부족", severity: "HIGH", to: "/memory/iss-1" }]);
    expect(card.body).toContain("접착이 금방 떨어졌어요");
    // The anchor is still the anchor after the turn that answered about it (§1-B).
    expect(turn.continuation.workingSet?.selectedObject).toMatchObject({ kind: "REVIEW", id: "r-2" });
  });

  it("a review the exact read cannot return is said as unread — never described from the anchor's own fields", async () => {
    const { h, id } = await anchored({ "이 리뷰 자세히 봐줘": REVIEW_PLAN }, {});

    const { turn } = await say(h, id, "이 리뷰 자세히 봐줘");

    expect(turn.artifacts.some((a) => a.type === "REVIEW_DETAIL")).toBe(false);
    // Nothing about the review is claimed: no rating, no date, no product — the anchor's own fields are
    // not a description of a review this runtime could not read.
    const said = `${turn.message} ${(turn.notes ?? []).join(" ")}`;
    expect(said).not.toContain("★");
    expect(said).not.toContain(MOLDING.name);
  });

  it("「비슷한 리뷰」 widens to THIS review's product and says so — the demonstrative never becomes the wider scope silently", async () => {
    const { h, id } = await anchored({ "같은 상품의 비슷한 리뷰도 보여줘": SIMILAR_PLAN }, { "r-2": detail() });

    const { turn } = await say(h, id, "같은 상품의 비슷한 리뷰도 보여줘");

    // The read is scoped to the anchored review's product…
    expect(h.operator.recentReviewParams.at(-1)?.productId).toBe(MOLDING.id);
    // …and the widening is stated rather than presented as 「이 리뷰」.
    expect(`${turn.message} ${(turn.notes ?? []).join(" ")}`).toContain("같은 상품의 리뷰");
  });

  it("the seller's sentence and the issue titles are ours, and an unlinked review says so without diagnosing it", () => {
    expect(reviewLine(detail())).toBe(`★2 · 카페24 · 2026-08-27 작성 · ${MOLDING.name}`);
    expect(issueSentence(detail())).toContain("「접착력 부족」");
    expect(issueSentence(detail({ issues: [] }))).toContain("아직 반복 문제로 묶이지 않았습니다");
  });
});

describe("§4 — the capability answer follows the catalogue, one read at a time", () => {
  it("the review clause appears only when the exact review read is registered", () => {
    const names = TOOL_CAPABILITIES.map((r) => r.tool);
    const answerFor = (tools: readonly string[]) => overviewAnswer({
      registeredTools: tools, actionClasses: ["READ"], readiness: WORKING(["카페24"]), coverage: null,
    });
    const withDetail = answerFor(names);
    const without = answerFor(names.filter((n) => n !== OPERATOR_TOOL.GET_REVIEW_DETAIL));

    expect(withDetail.lines.some((l: string) => l.includes("리뷰 하나를 고르시면"))).toBe(true);
    expect(without.lines.some((l: string) => l.includes("리뷰 하나를 고르시면"))).toBe(false);
    // The domain itself survives: ReviewOps owns other tools, and the clause is the only thing that moved.
    expect(without.lines.some((l: string) => l.includes("반복해서 올라오는 문제"))).toBe(true);
  });
});

describe("§1-C — 「이 리뷰 자세히 봐줘」 is answered by the object, with no planner", () => {
  it("reads the anchored review once and calls no model — the planner has no token for 'this object'", async () => {
    const { h, id } = await anchored({}, { "r-2": detail() });
    const plansBefore = h.operator.calls.plan;

    const { turn } = await say(h, id, "이 리뷰 자세히 봐줘");

    expect(h.operator.calls.plan).toBe(plansBefore);
    expect(h.operator.reviewDetailIds).toEqual(["r-2"]);
    const card = artifact(turn, "REVIEW_DETAIL");
    expect(card.reviewId).toBe("r-2");
    expect(card.body).toContain("접착이 금방 떨어졌어요");
    // Nothing to read about this channel's replies here, so the card says it did not check.
    expect(card.replyCapability).toBe("UNKNOWN");
    expect(turn.continuation.activeTask).toBe("INSPECT");
    // §3: the object's own card names its product — the answer does not roll the same evidence up
    // into 「이 답변이 가리키는 상품」 underneath it.
    expect(turn.artifacts.some((a) => a.type === "PRODUCT_LIST")).toBe(false);
  });

  it("the persisted turn keeps the identity and drops the customer's words", async () => {
    const { h, id } = await anchored({}, { "r-2": detail() });
    await say(h, id, "이 리뷰 자세히 봐줘");

    const view = await h.service.get(TOKEN, id);
    const stored = view.turns.flatMap((t) => t.artifacts).find((a) => a.type === "REVIEW_DETAIL");

    expect(stored).toMatchObject({ type: "REVIEW_DETAIL", reviewId: "r-2", productName: MOLDING.name });
    expect((stored as { body?: string | null }).body).toBeUndefined();
  });
});
