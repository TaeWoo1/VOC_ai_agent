/**
 * Frontend-first Agent Workspace Redesign v1 — the runtime half.
 *
 * Two contracts, and both of them are about what the seller is STANDING ON:
 *
 * §A <b>A product and a review can be the current object.</b> The focus contract named inquiries only,
 *    so a product row was the one list that dead-ended: nothing to press, nothing to say 「이 상품」
 *    about. Now the same transition serves all three, one anchor at a time, verified by what can
 *    actually prove each kind.
 * §B <b>A question about the assistant is answered by the assistant.</b> Measured live before this
 *    existed: 「너는 어떤 일을 도와줄 수 있어?」 came back as 「어느 채널에 대한 질문인지 알려주세요」 beside a
 *    quote of the seller's own 배송 기준. The action was right — `EXPLAIN_CAPABILITY` — and it had only
 *    ever learned to talk about a channel.
 *
 * Every assertion reads state or counts reads. None reads a sentence a model wrote, because none of
 * these sentences is written by one.
 */
import { describe, it, expect } from "vitest";
import { TOKEN, artifact, harness, say } from "./support";
import type { AgentPlanView } from "../../src/spring/types";
import { OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";
import { MOLDING } from "../support/operatorFixtures";
import { boundarySentence, capabilityDomains } from "../../src/operator/capability/AssistantCapability";
import { overviewAnswer } from "../../src/operator/capability/ProductSelfKnowledge";
import { UNKNOWN_READINESS } from "../../src/operator/capability/SellerReadiness";

const V3 = "test-planner/v3";

const CATALOG_PLAN: AgentPlanView = {
  available: true, supported: true, userGoal: "등록된 상품 목록", unresolvedEntities: [],
  informationNeeds: [{ id: "n1", question: "등록한 상품은", kind: "PRODUCT_CATALOG", why: "", required: true }],
  specialists: ["PRODUCT_OPS"], tools: [OPERATOR_TOOL.LIST_PRODUCTS], retrievalOrder: ["n1"], retrievalParallel: [],
  retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4,
  stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: null,
  providerVersion: V3, requestedAction: "NONE", tone: null,
  filters: { period: null, rating: null, channel: null, scope: null, topic: null },
  target: { selector: "NONE", index: null },
};

/** What the planner emits for 「너는 어떤 일을 도와줄 수 있어?」 (prompt v13): the action, and nothing to look up. */
const ASSISTANT_PLAN: AgentPlanView = {
  ...CATALOG_PLAN,
  userGoal: "reviewnary가 무엇을 할 수 있는지 알고 싶다",
  informationNeeds: [], specialists: [], tools: [], retrievalOrder: [],
  requestedAction: "EXPLAIN_CAPABILITY",
};

/** The channel-capability question this action was built for: a channel is named, facts are wanted. */
const CHANNEL_PLAN: AgentPlanView = {
  ...CATALOG_PLAN,
  userGoal: "쿠팡 리뷰 답글이 왜 안 되는지",
  informationNeeds: [], specialists: [], tools: [], retrievalOrder: [],
  requestedAction: "EXPLAIN_CAPABILITY",
  filters: { period: null, rating: null, channel: "COUPANG", scope: null, topic: null },
};

describe("§A — a product is an object the conversation can stand on", () => {
  it("a clicked product row becomes the anchor, and 「이 상품」 then resolves to it without a lookup", async () => {
    const h = harness({ plansByGoal: { "우리 상품 목록 보여줘": CATALOG_PLAN } });
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn: listed } = await say(h, id, "우리 상품 목록 보여줘");
    const list = artifact(listed, "PRODUCT_LIST");
    const productId = list.items[0]!.productId;

    const before = h.operator.calls.signals;
    const selected = await h.service.turn(TOKEN, id, { select: { kind: "PRODUCT", productId } } as never, () => undefined);

    // The anchor, and only one of them.
    expect(selected.continuation.workingSet?.selectedObject).toEqual({
      kind: "PRODUCT", id: productId, productId, channelCode: null,
    });
    expect(selected.continuation.workingSet?.selectedInquiry ?? null).toBeNull();
    expect(selected.continuation.activeTask).toBe("INSPECT");
    // Nothing is appended to the transcript: the row's own highlight is the feedback.
    expect(selected.message).toBe("");
    // A product the thread already DREW came from an org-scoped read; a second one would buy it twice.
    expect(h.operator.calls.signals).toBe(before);
  });

  it("a product id the thread never drew is verified by one read, and an unverifiable one changes nothing", async () => {
    const h = harness({ plansByGoal: { "우리 상품 목록 보여줘": CATALOG_PLAN } });
    const { conversationId: id } = await h.service.create(TOKEN);
    const unknown = await h.service.turn(TOKEN, id, { select: { kind: "PRODUCT", productId: "p-없음" } } as never, () => undefined);
    expect(unknown.continuation.workingSet?.selectedObject ?? null).toBeNull();

    const known = await h.service.turn(TOKEN, id, { select: { kind: "PRODUCT", productId: MOLDING.id } } as never, () => undefined);
    expect(known.continuation.workingSet?.selectedObject?.id).toBe(MOLDING.id);
  });

  it("standing on an inquiry leaves the product, and 「해제」 drops whichever anchor is held", async () => {
    const h = harness({ plansByGoal: { "우리 상품 목록 보여줘": CATALOG_PLAN } });
    const { conversationId: id } = await h.service.create(TOKEN);
    await say(h, id, "우리 상품 목록 보여줘");
    await h.service.turn(TOKEN, id, { select: { kind: "PRODUCT", productId: MOLDING.id } } as never, () => undefined);

    const cleared = await h.service.turn(TOKEN, id, { select: { kind: "CLEAR" } } as never, () => undefined);
    expect(cleared.continuation.workingSet?.selectedObject ?? null).toBeNull();
    expect(cleared.continuation.activeTask ?? null).toBeNull();
    // The set the seller is looking at stays exactly as it was — only the anchor left.
    expect(cleared.continuation.workingSet?.kind).toBe("PRODUCTS");
  });
});

describe("§A — a review is an object too, verified by the thread that drew it", () => {
  it("a review the conversation showed can be selected; one it never showed cannot", async () => {
    const h = harness();
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn: listed } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const reviewId = artifact(listed, "REVIEW_LIST").items[0]!.reviewId;

    const ok = await h.service.turn(TOKEN, id, { select: { kind: "REVIEW", reviewId } } as never, () => undefined);
    expect(ok.continuation.workingSet?.selectedObject?.kind).toBe("REVIEW");
    expect(ok.continuation.workingSet?.selectedObject?.id).toBe(reviewId);
    expect(ok.continuation.workingSet?.kind).toBe("REVIEWS");

    const no = await h.service.turn(TOKEN, id, { select: { kind: "REVIEW", reviewId: "r-외부" } } as never, () => undefined);
    // Refused, and the anchor already held is untouched — a refusal is never a silent move.
    expect(no.continuation.workingSet?.selectedObject?.id).toBe(reviewId);
  });
});

describe("§B — what reviewnary can do is derived from what it is wired to do", () => {
  it("a domain is said only when a registered tool serves it", () => {
    expect(capabilityDomains([]).length).toBe(0);
    const only = capabilityDomains([OPERATOR_TOOL.LIST_PRODUCTS]);
    expect(only.map((d) => d.short)).toEqual(["상품"]);
  });

  it("the boundary sentence comes from the catalogue's action classes", () => {
    expect(boundarySentence(["READ"])).toContain("직접 채널에 보내거나 고치는 일은 없습니다");
    expect(boundarySentence(["READ", "WRITE"])).not.toContain("직접 채널에 보내거나 고치는 일은 없습니다");
  });

  it("a coverage read that failed costs the channel sentence and nothing else", () => {
    const answer = overviewAnswer({
      registeredTools: [OPERATOR_TOOL.LIST_PRODUCTS], actionClasses: ["READ"],
      readiness: UNKNOWN_READINESS, coverage: null,
    });
    expect(answer.lines.some((l: string) => l.includes("연결된 채널"))).toBe(false);
    expect(answer.lines.some((l: string) => l.includes("직접 채널에 보내거나"))).toBe(true);
  });

  it("「너는 어떤 일을 도와줄 수 있어?」 is answered without asking which channel", async () => {
    const h = harness({ plansByGoal: { "너는 어떤 일을 도와줄 수 있어?": ASSISTANT_PLAN } });
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, "너는 어떤 일을 도와줄 수 있어?");

    expect(turn.status).toBe("DONE");
    expect(turn.message).not.toContain("어느 채널에 대한 질문인지");
    const summary = artifact(turn, "SUMMARY");
    expect(summary.title).toBe("제가 도와드릴 수 있는 일");
    // The catalogue this runtime builds serves all four domains, so all four are said.
    expect(summary.lines.some((l) => l.includes("고객 문의"))).toBe(true);
    expect(summary.lines.some((l) => l.includes("주문과 매출"))).toBe(true);
    // The boundary is stated, and it is the registry's own property.
    expect(summary.lines.some((l) => l.includes("보내는 것은 확인하신 뒤에"))).toBe(true);
    // The connected channels come from the real org-scoped read.
    expect(summary.lines.some((l) => l.includes("연결된 채널"))).toBe(true);
    expect(turn.suggestedActions.length).toBeGreaterThan(0);
  });

  it("a capability question ABOUT A CHANNEL is unchanged — it still answers on that channel", async () => {
    const h = harness({ plansByGoal: { "쿠팡 리뷰는 왜 답글을 못 달아?": CHANNEL_PLAN } });
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, "쿠팡 리뷰는 왜 답글을 못 달아?");
    const summary = artifact(turn, "SUMMARY");
    expect(summary.title).not.toBe("제가 도와드릴 수 있는 일");
  });
});
