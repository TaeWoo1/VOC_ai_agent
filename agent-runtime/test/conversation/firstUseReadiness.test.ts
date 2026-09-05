/**
 * <b>Before the first connection, «nothing found» is not «nothing to do».</b>
 *
 * Reproduces the three turns measured live on a clean organisation (2026-09-05) and asserts the state
 * each one actually reads. The defect was never in the words: all three answers were composed from
 * inputs that could not see whether this seller had connected anything.
 *
 * §A the readiness derivation itself — the coverage read, and what UNKNOWN refuses to claim.
 * §B 「이 서비스로 뭘 할 수 있어?」 — one scannable item per domain, no prompt a disconnected seller
 *    cannot ask, and the one action that exists.
 * §C 「어떻게 시작해?」 — the second capability question is answered with the next step, not the same
 *    card again. Told apart by the conversation's own state; nothing here reads the sentence.
 * §D 「뭐부터 하면 돼?」 — an empty checklist over an unconnected org says why it is empty.
 */
import { describe, it, expect } from "vitest";
import { TOKEN, artifact, coverageRow, harness, say } from "./support";
import type { AgentPlanView, RecentReviewsResponse } from "../../src/spring/types";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import { sellerReadinessOf, UNKNOWN_READINESS } from "../../src/operator/capability/SellerReadiness";

/** What `GET /api/channels/coverage` returns for an org that has connected nothing (measured live). */
function noChannelCoverage() {
  const off = { connected: false, connectionStatus: null, state: "NOT_CONNECTED" as const, rows: 0, openRows: 0,
    routineEnabled: false, lastSuccessfulSyncAt: null, newestObservedAt: null };
  return [
    coverageRow({ channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", dataType: "INQUIRY", ...off }),
    coverageRow({ channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", dataType: "REVIEW", ...off, state: "NOT_SUPPORTED", supported: false }),
    coverageRow({ channelCode: "CAFE24", channelNameKo: "카페24 자사몰", dataType: "INQUIRY", ...off }),
    coverageRow({ channelCode: "CAFE24", channelNameKo: "카페24 자사몰", dataType: "REVIEW", ...off }),
    coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", dataType: "ORDER_SUMMARY", ...off }),
  ];
}

function noReviews(): RecentReviewsResponse {
  return { from: "2026-09-05", to: "2026-09-05", negativeOnly: false, total: 0, items: [], coverage: noChannelCoverage() };
}

/**
 * What the planner actually emitted for BOTH capability sentences in the live session (trace,
 * 2026-09-05): the action, and nothing to look up. Identical plans — which is exactly why the two
 * answers were identical, and why telling them apart cannot be the planner's job here.
 */
const ASSISTANT_PLAN: AgentPlanView = {
  available: true, supported: true, userGoal: "reviewnary가 무엇을 할 수 있는지", unresolvedEntities: [],
  informationNeeds: [], specialists: [], tools: [], retrievalOrder: [], retrievalParallel: [],
  retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4,
  stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: null,
  providerVersion: "test-planner/v3", requestedAction: "EXPLAIN_CAPABILITY", tone: null,
  filters: { period: null, rating: null, channel: null, scope: null, topic: null },
  target: { selector: "NONE", index: null },
};

/** A clean seller: no channel connected, no inquiry, no review — the org the live session used. */
function cleanSeller() {
  return harness({
    plansByGoal: {
      ...RECORDED_PLANS, ...CONVERSATION_PLANS,
      "너는 어떤 일을 도와줄 수 있어?": ASSISTANT_PLAN,
      "아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?": ASSISTANT_PLAN,
    },
    channelCoverage: noChannelCoverage(),
    inbox: { items: [], total: 0, unansweredInquiries: 0 },
    recentReviews: { "false:ALL": noReviews(), "true:ALL": { ...noReviews(), negativeOnly: true } },
  }, []);
}

describe("§A — readiness is derived from the coverage read, and UNKNOWN claims nothing", () => {
  it("tells 'connected nothing' from 'connected and quiet' from 'could not tell'", () => {
    const clean = sellerReadinessOf(noChannelCoverage());
    expect(clean.kind).toBe("NO_CHANNEL");
    expect(clean.connected).toEqual([]);
    // The options behind 「어떻게 시작해?」 come from the table, never from a list in the source.
    expect(clean.connectable).toEqual(["네이버 스마트스토어", "카페24 자사몰", "쿠팡"]);
    // NAVER has no review path, CAFE24 does — so 리뷰 is promised, and it is promised because a row says so.
    expect(clean.delegable).toEqual(["INQUIRY", "REVIEW", "ORDER"]);

    const empty = noChannelCoverage().map((r) => ({ ...r, connected: true, connectionStatus: "CONNECTED", state: "ZERO" as const }));
    expect(sellerReadinessOf(empty).kind).toBe("NO_DATA");
    expect(sellerReadinessOf(empty.map((r) => ({ ...r, rows: 4 }))).kind).toBe("WORKING");
    // A backlog older than any window is still data held (`homeFirstUse.ts` names the same hazard).
    expect(sellerReadinessOf(empty.map((r) => ({ ...r, openRows: 2 }))).kind).toBe("WORKING");

    // A read that failed is a state, not an empty store: telling a connected seller they have no
    // channels is the one error they cannot check.
    expect(sellerReadinessOf(null)).toEqual(UNKNOWN_READINESS);
    expect(sellerReadinessOf(null).kind).toBe("UNKNOWN");
  });
});

describe("§B/§C — the capability answer is shaped by readiness, and is not said twice", () => {
  it("answers what connecting buys, offers no prompt this seller cannot ask, and then answers how to start", async () => {
    const h = cleanSeller();
    const { conversationId: id } = await h.service.create(TOKEN);

    const first = (await say(h, id, "너는 어떤 일을 도와줄 수 있어?")).turn;
    const card = artifact(first, "SUMMARY");
    expect(card.title).toBe("제가 도와드릴 수 있는 일");
    // One scannable item per domain — the eight-line document was six domain lines plus two.
    expect(card.lines.length).toBeLessThanOrEqual(6);
    expect(card.lines.filter((l) => /^(문의|리뷰|상품|주문) — /.test(l)).length).toBeLessThanOrEqual(4);
    expect(card.lines.some((l) => l.startsWith("문의 — "))).toBe(true);
    // The state is the seller's, and it is the one this org is actually in.
    expect(card.lines.some((l) => l.includes("아직 연결된 판매 채널이 없어"))).toBe(true);
    expect(first.message).toContain("판매 채널을 연결하시면");
    // A particle glued to a name without looking at it is how machine output reads (`korean.ts`).
    expect(first.message).toContain("주문을 대신 확인하고");
    // No prompt chip: every one of them asks about rows this org cannot have. One action instead.
    expect(first.suggestedActions.filter((a) => a.kind === "PROMPT")).toHaveLength(0);
    expect(first.suggestedActions).toContainEqual({ label: "판매 채널 연결하기", kind: "LINK", to: "/connect" });

    // The second capability question is a different question. Before this it was the same eight lines.
    const second = (await say(h, id, "아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?")).turn;
    const start = artifact(second, "SUMMARY");
    expect(start.title).toBe("시작하는 방법");
    expect(start.lines).not.toEqual(card.lines);
    expect(start.lines.some((l) => l.includes("네이버 스마트스토어 · 카페24 자사몰 · 쿠팡"))).toBe(true);
    // The local 도우미 belongs to one channel's guided lanes; a seller who has not chosen a channel is
    // not asked to install anything.
    expect(start.lines.join(" ")).not.toContain("도우미");
    expect(second.suggestedActions).toContainEqual({ label: "판매 채널 연결하기", kind: "LINK", to: "/connect" });
  });
});

describe("§D — an empty answer over an unconnected org says why it is empty", () => {
  it("「내가 해야 할 일 정리해줘」 names the connect step instead of reporting zeros", async () => {
    const h = cleanSeller();
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, "내가 해야 할 일 정리해줘");

    expect(turn.status).toBe("DONE");
    expect(turn.message).not.toContain("지금 먼저 하실 일은 없습니다");
    expect(turn.message).toContain("아직 연결된 판매 채널이 없어서");
    // `CHANNEL_CONNECT` has been in the vocabulary since it was written with nothing producing it.
    expect(artifact(turn, "CHECKLIST").items).toEqual([{ label: "판매 채널 연결하기", to: "/connect" }]);
    // The zero cards go with the zero sentences: a 「문의 0건」 card under the explanation is the same
    // disproven claim, drawn.
    expect(turn.artifacts.some((a) => a.type === "INQUIRY_LIST" || a.type === "REVIEW_LIST")).toBe(false);
    expect(turn.message).not.toMatch(/0건/);
    // A limit is an absence claim too, and so is 「확인한 자료」 over reads that answered nothing.
    expect((turn.notes ?? []).join(" ")).not.toContain("없습니다");
    expect(turn.artifacts.some((a) => a.type === "EVIDENCE")).toBe(false);
    // An empty set is not a set to point at.
    expect(turn.continuation.workingSet).toBeNull();
    expect(turn.suggestedActions).toContainEqual({ label: "판매 채널 연결하기", kind: "LINK", to: "/connect" });
  });

  it("a seller who HAS rows is untouched — the branch is unreachable with data", async () => {
    const h = harness();
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, "내가 해야 할 일 정리해줘");
    expect(turn.message.startsWith("지금 하실 일을 정리했습니다")).toBe(true);
    expect(artifact(turn, "CHECKLIST").items.length).toBeGreaterThan(0);
  });
});
