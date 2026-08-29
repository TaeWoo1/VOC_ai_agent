/**
 * The conversation lane, end to end through the real graph — every turn LLM-planned (a v3 recording
 * replayed at the transport), every read a seeded fake, nothing sent.
 */
import { describe, expect, it } from "vitest";
import {
  CAFE24_ACCOUNT, COUPANG_ACCOUNT, TODAY, TOKEN, W_SHIP, artifact, freshReviews, harness, say,
  staleCoupangCoverage,
} from "./support";
import { MOLDING } from "../support/operatorFixtures";

async function fresh() {
  const h = harness();
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}

describe("A — a free-form review question becomes a REVIEW_LIST", () => {
  it("reads the rows for the planner's window and shows exactly them", async () => {
    const { h, id } = await fresh();
    const { turn, stages } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");

    expect(turn.status).toBe("DONE");
    expect(stages.slice(0, 2)).toEqual(["UNDERSTANDING", "PLANNED"]);
    expect(stages).toContain("READING");
    expect(stages[stages.length - 1]).toBe("COMPOSING");
    const list = artifact(turn, "REVIEW_LIST");
    expect(list.items.map((i) => i.reviewId)).toEqual(["r-1", "r-2", "r-3"]);
    expect(list.scope.period).toMatchObject({ from: TODAY, to: TODAY, token: "TODAY" });
    expect(h.operator.recentReviewParams[0]).toMatchObject({ from: TODAY, to: TODAY, negativeOnly: false });
    expect(turn.message).toContain("오늘 확인 가능한 리뷰가 3건입니다.");
    expect(list.freshness.find((f) => f.channelCode === "COUPANG")?.verdict).toBe("FRESH");
    expect(turn.continuation.workingSet).toMatchObject({ kind: "REVIEWS", count: 3, ids: ["r-1", "r-2", "r-3"] });
    expect(turn.continuation.workingSet?.productIds).toContain(MOLDING.id);
    expect(turn.artifacts.some((a) => a.type === "EVIDENCE")).toBe(true);
    expect(turn.suggestedActions.map((s) => s.label)).toContain("안 좋은 것만 봐줘");
  });

  it("the planner was told the working set in closed tokens on the follow-up, never a count or an id", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    await say(h, id, "안 좋은 것만 봐줘");
    const prior = h.operator.planPriorContexts.at(-1) ?? "";
    expect(prior).toContain("직전 작업 집합: REVIEWS (기간:TODAY, 채널:전체, 평점:ALL, 상태:없음, 상품 특정:예)");
    expect(prior).not.toContain("r-1");
    expect(prior).not.toContain("3건");
  });
});

describe("B — stale coverage asks for one human step instead of saying 0", () => {
  it("emits HUMAN_ACTION_REQUIRED per stale channel and WAITING_HUMAN", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const { turn } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");

    expect(turn.status).toBe("WAITING_HUMAN");
    const human = artifact(turn, "HUMAN_ACTION_REQUIRED");
    expect(human).toMatchObject({
      actionType: "REVIEW_IMPORT", reason: "FRESHNESS_UNPROVEN", path: "WING_READ_ACTION_WINDOW", channelCode: "COUPANG",
      accountId: COUPANG_ACCOUNT, dataType: "REVIEW", to: `/connect/channels/${COUPANG_ACCOUNT}`, resumable: true,
      requiresLocalAgent: true,
    });
    expect(turn.message).toContain("현재 리뷰는 최신 상태가 아닙니다. 새 리뷰를 확인하려면 판매자님의 한 번의 작업이 필요합니다.");
    expect(turn.message).not.toContain("0건");
    expect(turn.message).toContain("지금까지 수집된");
    expect(turn.continuation.pendingHumanAction).toMatchObject({ accountId: COUPANG_ACCOUNT, dataType: "REVIEW" });
    // Rows already held are still shown.
    expect(artifact(turn, "REVIEW_LIST").items).toHaveLength(3);
  });

  it("resume without completion stays WAITING_HUMAN, spends no planner call and no tool", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const plans = h.operator.calls.plan;
    const reads = h.operator.calls.recentReviews;

    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(turn.message).toContain("아직 수집이 끝나지 않았습니다.");
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(true);
    expect(h.operator.calls.plan).toBe(plans);
    expect(h.operator.calls.recentReviews).toBe(reads);
    expect(h.inquiry.calls.syncRuns).toBe(1);
  });

  it("resume after a completed sync re-runs the request and marks resumedFrom", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    h.inquiry.syncRuns.push({
      id: "run-1", sellerAccountId: COUPANG_ACCOUNT, channelId: "chan-coupang", dataType: "REVIEW", trigger: "MANUAL",
      status: "SUCCESS", successRows: 2, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:01:00Z",
    });
    h.recentReviews["false:ALL"] = freshReviews();

    const { turn, stages } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("DONE");
    expect(turn.resumedFrom).toBe(first.turn.turnId);
    expect(turn.message.startsWith("새 리뷰 가져오기가 끝났습니다. 계속 확인하겠습니다.")).toBe(true);
    expect(artifact(turn, "REVIEW_LIST").items).toHaveLength(3);
    expect(stages[0]).toBe("UNDERSTANDING");
    expect(turn.continuation.pendingHumanAction).toBeNull();
  });

  it("a FAILED sync run is said honestly and the turn stays WAITING_HUMAN", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    h.inquiry.syncRuns.push({
      id: "run-2", sellerAccountId: COUPANG_ACCOUNT, channelId: "chan-coupang", dataType: "REVIEW", trigger: "MANUAL",
      status: "FAILED", successRows: 0, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:01:00Z",
    });
    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(turn.message).toContain("수집이 실패했습니다");
  });

  it("a successful collection on or after the window's first day makes a ZERO/UNPROVEN channel FRESH", async () => {
    const { h, id } = await fresh();
    const rows = staleCoupangCoverage().map((r) => r.channelCode === "COUPANG"
      ? { ...r, lastSuccessfulSyncAt: `${TODAY}T05:00:00Z` } : r);
    h.recentReviews["false:ALL"] = freshReviews(rows);
    const { turn } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.status).toBe("DONE");
    expect(artifact(turn, "REVIEW_LIST").freshness.find((f) => f.channelCode === "COUPANG")?.verdict).toBe("FRESH");
  });
});

describe("C — a filter follow-up intersects with the previous ids", () => {
  it("「안 좋은 것만 봐줘」 keeps only rows the seller already saw", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "안 좋은 것만 봐줘");

    const list = artifact(turn, "REVIEW_LIST");
    expect(list.items.map((i) => i.reviewId)).toEqual(["r-2"]);
    expect(list.scope.rating).toBe("LOW");
    expect(list.scope.period?.token).toBe("TODAY");
    expect(h.operator.recentReviewParams.at(-1)).toMatchObject({ from: TODAY, to: TODAY, negativeOnly: true });
    expect(turn.message).toContain("방금 본 3건 중 낮은 평점 리뷰는 1건입니다.");
    expect(turn.continuation.workingSet).toMatchObject({ kind: "REVIEWS", count: 1, ids: ["r-2"] });
  });

  it("「상품별로 묶어줘」 groups the intersected rows in-process", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "상품별로 묶어줘");
    const grouped = artifact(turn, "PRODUCT_LIST");
    expect(grouped.items.map((i) => [i.productId, i.facts[0]!.count])).toEqual([[MOLDING.id, 2], ["p-cable", 1]]);
    expect(turn.message).toContain("상품 2개로 묶었습니다");
    expect(h.operator.calls.products).toBe(0);
  });
});

describe("D — a cross-domain follow-up uses the previous set's products", () => {
  it("「문의에서도 비슷한 얘기 있어?」 reads the workload for those products and customer memory by product", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "문의에서도 비슷한 얘기 있어?");

    const list = artifact(turn, "INQUIRY_LIST");
    const ids = list.groups.flatMap((g) => g.items.map((i) => i.workItemId));
    expect(ids).toEqual([W_SHIP, "w-return"]);
    // One customer-memory search per product of the review set, anchored by productId — never by text.
    expect(h.operator.calls.memory).toBe(2);
    expect(["p-cable", MOLDING.id]).toContain(h.operator.lastMemoryParams?.productId);
    expect(turn.continuation.workingSet).toMatchObject({ kind: "INQUIRIES", workItemIds: [W_SHIP, "w-return"] });
  });

  it("an empty cross-domain result is said as empty, with the evidence of what was read", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = { ...freshReviews(), items: freshReviews().items.map((i) => ({ ...i, productId: "p-nowhere", productName: "없는 상품" })) };
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "문의에서도 비슷한 얘기 있어?");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("같은 상품에 대한 미답변 문의는 없습니다.");
    expect(artifact(turn, "INQUIRY_LIST").totalCount).toBe(0);
    expect(artifact(turn, "EVIDENCE").items.length).toBeGreaterThan(0);
  });
});

describe("E/F/G — the inquiry loop: list → topic → draft → tone → approval", () => {
  it("lists the workload, then 「배송 관련부터」 narrows the previous ids by topic", async () => {
    const { h, id } = await fresh();
    const first = await say(h, id, "오늘 내가 답해야 할 문의 정리해줘");
    const all = artifact(first.turn, "INQUIRY_LIST");
    expect(all.groups.flatMap((g) => g.items.map((i) => i.workItemId))).toEqual([W_SHIP, "w-size", "w-return"]);
    expect(first.turn.message).toContain("답변이 필요한 문의가 3건입니다");

    const { turn } = await say(h, id, "배송 관련부터");
    const shipping = artifact(turn, "INQUIRY_LIST");
    expect(shipping.groups.flatMap((g) => g.items.map((i) => i.workItemId))).toEqual([W_SHIP]);
    expect(turn.continuation.workingSet?.workItemIds).toEqual([W_SHIP]);
    expect(turn.continuation.workingSet?.filters.topic).toBe("SHIPPING");
  });

  it("E — 「첫 번째 거 답변 준비해줘」 prepares a draft for the first shown inquiry", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 내가 답해야 할 문의 정리해줘");
    const { turn, stages } = await say(h, id, "첫 번째 거 답변 준비해줘");

    expect(stages).toContain("PREPARING_DRAFT");
    const draft = artifact(turn, "DRAFT");
    expect(draft).toMatchObject({ workItemId: W_SHIP, inquiryId: "inq-ship", version: 1, answerBasis: "GROUNDED", tone: null });
    expect(draft.comments).toBeTruthy();
    expect(h.inquiry.methodCalls.filter((c) => c.method === "generateDraftFor")).toEqual([{ method: "generateDraftFor", workItemId: W_SHIP, tone: null }]);
    expect(turn.message).toContain("답변 초안을 준비했습니다.");
    expect(turn.continuation.pendingPrepared).toMatchObject({ kind: "INQUIRY_DRAFT", workItemId: W_SHIP, draftVersion: 1 });
    expect(turn.suggestedActions.map((s) => s.label)).toEqual(expect.arrayContaining(["조금 더 부드럽게 써줘", "좋아 보내자"]));
  });

  it("F — a tone request forwards the tone and changes nothing else about the call", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 내가 답해야 할 문의 정리해줘");
    await say(h, id, "첫 번째 거 답변 준비해줘");
    const { turn } = await say(h, id, "조금 더 부드럽게 써줘");

    const generates = h.inquiry.methodCalls.filter((c) => c.method === "generateDraftFor");
    expect(generates).toEqual([
      { method: "generateDraftFor", workItemId: W_SHIP, tone: null },
      { method: "generateDraftFor", workItemId: W_SHIP, tone: "SOFTER" },
    ]);
    const draft = artifact(turn, "DRAFT");
    expect(draft.tone).toBe("SOFTER");
    expect(draft.version).toBe(2);
    // The facts the backend recorded are the same draft text; only the identity stamp moved with the tone.
    const detail = await h.inquiry.getInquiryDetail(W_SHIP);
    expect(detail.draft?.comments).toBe("안녕하세요. 문의 주신 내용 확인했습니다.");
    expect(turn.continuation.pendingPrepared?.draftVersion).toBe(2);
  });

  it("G — 「좋아 보내자」 yields an APPROVAL artifact and the lane made zero writes", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 내가 답해야 할 문의 정리해줘");
    await say(h, id, "첫 번째 거 답변 준비해줘");
    const { turn } = await say(h, id, "좋아 보내자");

    const approval = artifact(turn, "APPROVAL");
    const detail = await h.inquiry.getInquiryDetail(W_SHIP);
    expect(approval).toMatchObject({
      workItemId: W_SHIP, inquiryId: "inq-ship", draftVersion: 1, contentFingerprint: detail.draft?.contentFingerprint,
      to: "/inquiries/inq-ship",
    });
    expect(turn.message).toContain("다음 초안을 전송하려면 승인이 필요합니다. 전송은 승인 뒤 기존 실행 경로로만 진행됩니다.");
    const methods = new Set(h.inquiry.methodCalls.map((c) => c.method));
    // `proposeInquiry` is the product's own OPEN → PROPOSED step, a local row; still no send, no approval.
    expect([...methods].sort()).toEqual(["generateDraftFor", "getInquiryDetail", "listInquiries", "proposeInquiry"]);
    expect(h.inquiry.externalSendAttempts).toBe(0);
    expect(h.inquiry.phaseOf(W_SHIP)).toBe("PROPOSED");
  });

  it("a draft request with nothing to point at asks which one, without a model call for it", async () => {
    const { h, id } = await fresh();
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "첫 번째 거 답변 준비해줘");
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts.some((a) => a.type === "DRAFT")).toBe(false);
    expect(turn.message).toContain("어떤 문의의 답변을 준비할지 알려주세요");
    expect(h.operator.calls.plan).toBe(plans + 1);
    expect(h.inquiry.calls.generate).toBe(0);
  });

  it("NO_ANSWER_BASIS becomes a DRAFT without a version plus a KNOWLEDGE_ENTRY step", async () => {
    const seeds = harness().inquiry; void seeds;
    const h = harness({}, [{ ...(await import("./support")).inquiries()[0]!, draftGeneration: { answerBasis: "NO_ANSWER_BASIS" } }]);
    const view = await h.service.create(TOKEN);
    await say(h, view.conversationId, "오늘 내가 답해야 할 문의 정리해줘");
    const { turn } = await say(h, view.conversationId, "첫 번째 거 답변 준비해줘");
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(artifact(turn, "DRAFT").version).toBeNull();
    expect(artifact(turn, "HUMAN_ACTION_REQUIRED")).toMatchObject({ actionType: "KNOWLEDGE_ENTRY", path: "WORKSPACE", to: "/inquiries/inq-ship" });
    expect(turn.continuation.pendingPrepared).toBeNull();
  });
});

describe("H/I — orders: a summary and a chart, and a channel follow-up keeps the window", () => {
  it("「지난주보다 왜 매출이 떨어졌어?」 states the two weeks from the 14-day series", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "지난주보다 왜 매출이 떨어졌어?");
    expect(turn.status).toBe("DONE");
    const summary = artifact(turn, "ORDER_SUMMARY");
    expect(h.operator.overviewDays).toEqual([14]);
    expect(summary.period).toMatchObject({ days: 14, token: "LAST_WEEK" });
    expect(summary.totals).toMatchObject({ sales: 420_000, orders: 14, previousSales: 700_000, previousOrders: 21, salesDeltaPercent: -40 });
    expect(summary.exclusions).toEqual(["쿠팡: 미연결"]);
    expect(turn.message).toContain("매출은 420,000원(주문 14건)으로 직전 기간보다 40% 줄었습니다.");
    const chart = artifact(turn, "CHART");
    expect(chart.unit).toBe("원");
    expect(chart.series[0]!.points).toHaveLength(14);
    expect(turn.continuation.workingSet).toMatchObject({ kind: "ORDERS" });
  });

  it("「카페24만 봐봐」 reads that channel's own trend over the same window", async () => {
    const { h, id } = await fresh();
    await say(h, id, "지난주보다 왜 매출이 떨어졌어?");
    const { turn } = await say(h, id, "카페24만 봐봐");
    const summary = artifact(turn, "ORDER_SUMMARY");
    expect(h.operator.overviewDays).toEqual([14, 14]);
    expect(h.operator.ordersSummaryParams).toEqual([{ from: "2026-08-14", to: TODAY, channelId: "chan-cafe24" }]);
    expect(summary.channelCode).toBe("CAFE24");
    expect(summary.period.token).toBe("LAST_WEEK");
    expect(summary.totals).toMatchObject({ sales: 360_000, orders: 12 });
    expect(artifact(turn, "CHART").series[0]!.points).toHaveLength(7);
    expect(turn.message).toContain("카페24 매출은 360,000원(주문 12건)입니다.");
  });
});

describe("L / misc — failure, clarification, workspace link, persistence", () => {
  it("an unsupported sentence is a FAILED turn with no artifacts and no canned object", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "점심 메뉴 추천해줘");
    expect(turn.status).toBe("FAILED");
    expect(turn.failureCode).toBe("GOAL_UNSUPPORTED");
    expect(turn.artifacts).toEqual([]);
    expect(turn.message).toContain("판매 운영과 관련이 없는 요청입니다.");
  });

  it("a planner that cannot be reached fails the turn with the existing code", async () => {
    const h = harness({ plansByGoal: undefined, plan: undefined });
    const view = await h.service.create(TOKEN);
    const { turn } = await say(h, view.conversationId, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.status).toBe("FAILED");
    expect(turn.failureCode).toBe("PLANNER_CAPABILITY_OFF");
  });

  it("a clarification is the message, with no artifacts", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "상품에 문제 있어?");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toBe("어떤 상품을 말씀하시는지 알려주세요.");
    expect(turn.artifacts).toEqual([]);
  });

  it("「문의 화면 열어줘」 yields a WORKSPACE_LINK", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "문의 화면 열어줘");
    expect(artifact(turn, "WORKSPACE_LINK").link.to).toBe("/inquiries?state=NEEDS_REPLY");
  });

  it("persistence strips previews, titles, comments and the answer; the live turn keeps them", async () => {
    const { h, id } = await fresh();
    const a = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(artifact(a.turn, "REVIEW_LIST").items[0]!.preview).toBeTruthy();
    expect(a.turn.answer).toBeDefined();
    const b = await say(h, id, "문의에서도 비슷한 얘기 있어?");
    expect(artifact(b.turn, "INQUIRY_LIST").groups[0]!.items[0]!.title).toBeTruthy();
    await say(h, id, "첫 번째 거 답변 준비해줘");

    const stored = await h.service.get(TOKEN, id);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("붙이기 쉽고");
    expect(serialized).not.toContain("배송 언제 오나요");
    expect(serialized).not.toContain("문의 주신 내용 확인했습니다");
    expect(stored.turns.every((t) => t.answer === undefined)).toBe(true);
    expect(stored.turns).toHaveLength(6);
    expect(stored.workingSet?.kind).toBe("INQUIRIES");
    expect(stored.pendingPrepared?.workItemId).toBe(W_SHIP);
    expect(CAFE24_ACCOUNT).toBeTruthy();
  });

  it("list returns the seller's conversations newest first with the first sentence as headline", async () => {
    const { h, id } = await fresh();
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const rows = await h.service.list(TOKEN, 10);
    expect(rows[0]).toMatchObject({ conversationId: id, turnCount: 2, headline: "오늘 새로 달린 리뷰 보여줘" });
  });

  it("an unknown conversation is a 404", async () => {
    const { h } = await fresh();
    await expect(h.service.get(TOKEN, "nope")).rejects.toMatchObject({ status: 404 });
  });
});
