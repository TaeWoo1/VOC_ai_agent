/** The six defects live QA found on the real stack (2026-08-27), each pinned by one test. */
import { describe, expect, it } from "vitest";
import { TODAY, TOKEN, artifact, freshReviews, harness, negativeReviews, say, staleCoupangCoverage } from "./support";
import { MOLDING } from "../support/operatorFixtures";
import { redundantWithHeadline } from "../../src/conversation/ConversationService";

async function fresh(seed?: Parameters<typeof harness>[0]) {
  const h = harness(seed);
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}

describe("R1 — a filter follow-up never re-fires the freshness gate", () => {
  it("「그중 안 좋은 것만 봐줘」 over a set with 0 matches is DONE, with the freshness rows still shown", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    h.recentReviews["true:ALL"] = { ...negativeReviews(staleCoupangCoverage()), items: [], total: 0 };
    const first = await say(h, id, "지난 7일 동안 들어온 상품평 좀 보여봐");
    expect(first.turn.status).toBe("DONE");
    const { turn } = await say(h, id, "그중 안 좋은 것만 봐줘");
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    expect(turn.continuation.pendingHumanAction).toBeNull();
    expect(artifact(turn, "REVIEW_LIST").freshness.length).toBe(3);
    expect(turn.message).toContain("방금 본 3건 중 낮은 평점 리뷰는 0건입니다.");
  });
});

describe("R2 — an empty filtered result keeps the previous working set", () => {
  it("the continuation still carries the ids and products of the set the seller saw", async () => {
    const { h, id } = await fresh();
    h.recentReviews["true:ALL"] = { ...negativeReviews(), items: [], total: 0 };
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "안 좋은 것만 봐줘");
    expect(turn.message).toContain("0건");
    expect(turn.continuation.workingSet?.ids).toEqual(first.turn.continuation.workingSet?.ids);
    expect(turn.continuation.workingSet?.productIds).toContain(MOLDING.id);
    const cross = await say(h, id, "문의에서도 같은 문제가 있는지 봐줘");
    expect(artifact(cross.turn, "INQUIRY_LIST").totalCount).toBe(2);
  });
});

describe("R3 — the count finding does not repeat the list headline", () => {
  it("says the inquiry count once", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "오늘 내가 답해야 할 문의 정리해줘");
    expect(turn.message.match(/답변이 필요한 문의가/g)?.length).toBe(1);
    expect(turn.message).toContain("답변이 필요한 문의가 3건입니다");
    expect(turn.message).not.toContain("3건 있습니다");
    // The finding is not lost — it stays in the answer with its evidence; only the prose says it once.
    expect(turn.answer?.findings.some((f) => f.statement.includes("3건 있습니다"))).toBe(true);
  });

  it("the rule is numbers-as-subset plus a shared noun", () => {
    expect(redundantWithHeadline("답변이 필요한 문의가 20건 있습니다 (초안 준비됨 1건).", "답변이 필요한 문의가 20건입니다 (초안 준비됨 1건 · 미답변 19건).")).toBe(true);
    expect(redundantWithHeadline("그중 4건은 접수된 지 30일이 넘었습니다.", "답변이 필요한 문의가 20건입니다.")).toBe(false);
    expect(redundantWithHeadline("리뷰가 20건입니다.", "문의가 20건입니다.")).toBe(false);
  });
});

describe("R4 — a product answer becomes a PRODUCT_LIST and a PRODUCTS set", () => {
  it("「요즘 문제 생기는 상품 있어?」 names the product the evidence is about", async () => {
    const { h, id } = await fresh();
    const { turn } = await say(h, id, "요즘 문제 생기는 상품 있어?");
    expect(turn.status).toBe("DONE");
    const list = artifact(turn, "PRODUCT_LIST");
    expect(list.items.map((i) => i.productId)).toEqual([MOLDING.id]);
    expect(list.items[0]!.productName).toBe(MOLDING.name);
    expect(list.items[0]!.facts.length).toBeGreaterThan(0);
    expect(turn.continuation.workingSet).toMatchObject({ kind: "PRODUCTS", ids: [MOLDING.id], count: 1 });
  });
});

describe("R5 — an ordinal over a PRODUCTS set resolves that product before dispatch", () => {
  it("「첫 번째 거 자세히 봐줘」 investigates the first product, charged through the registry", async () => {
    const { h, id } = await fresh();
    await say(h, id, "요즘 문제 생기는 상품 있어?");
    const before = h.operator.calls.signals;
    const { turn } = await say(h, id, "첫 번째 거 자세히 봐줘");
    expect(turn.status).toBe("DONE");
    expect(h.operator.calls.signals).toBeGreaterThan(before);
    expect(turn.answer?.evidence.some((e) => e.locator.productId === MOLDING.id)).toBe(true);
    expect(turn.answer?.evidence.filter((e) => e.kind === "INBOX_COUNT")).toHaveLength(0);
    // R8: the anchor stays the PRODUCTS set of that one product, whatever list the turn drew.
    expect(turn.continuation.workingSet).toMatchObject({ kind: "PRODUCTS", ids: [MOLDING.id] });
    // The next sentence about "it" carries the product as the verified hint, and the planner hears 상품 특정:예.
    await say(h, id, "요즘 문제 생기는 상품 있어?");
    expect(h.operator.planPriorContexts.at(-1)).toContain("상품 특정:예");
    expect(h.operator.planGoals.at(-1)).toBe("요즘 문제 생기는 상품 있어?");
  });
});

describe("R6 — 「내가 해야 할 일 정리해줘」 composes a CHECKLIST without a model", () => {
  it("lists only items whose source is present, and counts them in the headline", async () => {
    const { h, id } = await fresh();
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "내가 해야 할 일 정리해줘");
    expect(turn.status).toBe("DONE");
    const checklist = artifact(turn, "CHECKLIST");
    expect(checklist.items.map((i) => i.label)).toEqual(["답변이 필요한 문의 3건", "낮은 평점 리뷰 1건 확인"]);
    expect(turn.message.startsWith("지금 하실 일을 정리했습니다 (2건).")).toBe(true);
    expect(h.operator.calls.plan).toBe(plans + 1);
  });

  it("a stale channel becomes a 「리뷰 가져오기」 item, and nothing else invents one", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = freshReviews(staleCoupangCoverage());
    const { turn } = await say(h, id, "내가 해야 할 일 정리해줘");
    expect(artifact(turn, "CHECKLIST").items[0]).toMatchObject({ label: "쿠팡 리뷰 가져오기", to: "/connect/channels/acct-coupang" });
  });
});

describe("TODAY zero wording", () => {
  it("says 「오늘 들어온 리뷰는 없습니다」 only when every channel is FRESH", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = { ...freshReviews(), items: [], total: 0 };
    const { turn } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("오늘 들어온 리뷰는 없습니다.");
  });

  it("omits the 0 sentence entirely while a channel is unproven", async () => {
    const { h, id } = await fresh();
    h.recentReviews["false:ALL"] = { ...freshReviews(staleCoupangCoverage()), items: [], total: 0 };
    const { turn } = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(turn.message).not.toContain("0건");
    expect(turn.message).toContain("지금까지 확인한 범위에는 오늘 리뷰가 없습니다.");
    // The stale channel is named by its own step card now, not a second time in the prose
    // (Agent Object + First-use Closure v1 §3).
    expect(turn.message).not.toContain("쿠팡 리뷰는");
    expect(TODAY).toBeTruthy();
  });
});
