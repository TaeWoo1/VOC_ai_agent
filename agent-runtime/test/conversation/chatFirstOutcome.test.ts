/**
 * Chat-first Outcome & Visual Closure v1 — the three runtime contracts this package added.
 *
 * §3 a freshness question the product can answer is never left to the planner's mood;
 * §3 the same intent picks GUIDED or AUTOMATIC by capability, never by the sentence;
 * §2 the completion turn says which channel, which days, and what came in.
 */
import { describe, expect, it } from "vitest";
import { TODAY, TOKEN, artifact, coverageRow, freshReviews, harness, say } from "./support";
import { freshnessQuestionOf } from "../../src/conversation/freshnessQuestion";

describe("§3 — the freshness question is a shape, not a sentence", () => {
  it("takes the three-part question and refuses everything wider", () => {
    expect(freshnessQuestionOf("오늘 네이버 리뷰 있어?")).toEqual({ ask: "ROWS", period: "TODAY" });
    expect(freshnessQuestionOf("리뷰 뭐 들어왔어?")).toEqual({ ask: "ROWS", period: null });
    expect(freshnessQuestionOf("이번 달 리뷰 어때?")).toEqual({ ask: "ROWS", period: "THIS_MONTH" });
    // The STATE of the collection is its own shape: 「최신이야?」 names the object, 「언제까지 확인했어?」
    // leans on the thread for it and carries a collection word instead.
    expect(freshnessQuestionOf("네이버 리뷰 최신이야?")).toEqual({ ask: "AS_OF", period: null });
    expect(freshnessQuestionOf("언제까지 확인했어?")).toEqual({ ask: "AS_OF", period: null });
    expect(freshnessQuestionOf("마지막으로 확인한 게 언제야?")).toEqual({ ask: "AS_OF", period: null });
    // …but a bare 「언제야?」 names neither an object nor a collection, and stays the planner's.
    expect(freshnessQuestionOf("언제야?")).toBeNull();
    // Wider questions stay the planner's: a rating, a product axis, a follow-up over a set, a "why".
    expect(freshnessQuestionOf("안 좋은 리뷰 있어?")).toBeNull();
    expect(freshnessQuestionOf("그중 리뷰 있어?")).toBeNull();
    expect(freshnessQuestionOf("리뷰 왜 이렇게 줄었어?")).toBeNull();
    expect(freshnessQuestionOf("반복되는 리뷰 문제 있어?")).toBeNull();
    // Another operational object is another question.
    expect(freshnessQuestionOf("오늘 문의 있어?")).toBeNull();
    // An instruction is the acquisition lane's, not this one's.
    expect(freshnessQuestionOf("네이버 리뷰 최신화해줘")).toBeNull();
  });

  it("is ROUTED here, not recovered: no planner call, and the same answer every time", async () => {
    const h = harness();
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false });
    const naver = () => [
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: `${TODAY}T03:00:00Z`, newestObservedAt: `${TODAY}T02:00:00Z` }),
    ];
    h.recentReviews["false:ALL"] = freshReviews(naver());
    h.recentReviews["false:NAVER"] = freshReviews(naver());
    const view = await h.service.create(TOKEN);

    // There is no recorded plan for this sentence — and it does not matter, because the planner is not
    // asked. Before this the same sentence failed with 「요청을 어떻게 조사할지 계획하지 못했습니다」.
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, view.conversationId, "오늘 네이버 리뷰 들어온 거 있어?");

    expect(turn.status).not.toBe("FAILED");
    expect(turn.message).not.toContain("계획하지 못했습니다");
    const list = artifact(turn, "REVIEW_LIST");
    expect(list.scope.channelCode).toBe("NAVER");
    expect(list.freshness.every((f) => f.channelCode === "NAVER")).toBe(true);
    expect(turn.budget?.stopReason).toBe("FRESHNESS");
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.budget?.llmCalls ?? 0).toBe(0);
  });

  it("variance 0 — the same question asked three times answers identically", async () => {
    const naver = () => [
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: `${TODAY}T03:00:00Z`, newestObservedAt: `${TODAY}T02:00:00Z` }),
    ];
    const h = harness();
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false });
    h.recentReviews["false:ALL"] = freshReviews(naver());
    h.recentReviews["false:NAVER"] = freshReviews(naver());

    const answers: string[] = [];
    for (const sentence of ["오늘 네이버 리뷰 있어?", "네이버 리뷰 최신이야?", "언제까지 확인했어?"]) {
      for (let i = 0; i < 3; i += 1) {
        const view = await h.service.create(TOKEN);
        const { turn } = await say(h, view.conversationId, sentence);
        answers.push(`${sentence}::${turn.status}::${turn.budget?.stopReason}::${turn.message}`);
      }
    }
    // Three sentences x three runs: each sentence's three answers are the same string, character for
    // character. A deterministic route has no distribution to sample.
    for (let i = 0; i < answers.length; i += 3) {
      expect(answers[i + 1]).toBe(answers[i]);
      expect(answers[i + 2]).toBe(answers[i]);
    }
    expect(answers[3]).toContain("네이버");
    expect(answers[6]).toContain("네이버");
  });

  it("a question it does not recognise keeps the planner's failure — the recovery never widens", async () => {
    const h = harness();
    const view = await h.service.create(TOKEN);
    const { turn } = await say(h, view.conversationId, "점심 메뉴 추천해줘");
    expect(turn.status).toBe("FAILED");
  });
});

describe("§3 — the same intent, a different action per channel", () => {
  it("an AUTOMATIC channel is refreshed by the product; it is never asked for a step that does not exist", async () => {
    const h = harness();
    h.recentReviews["false:ALL"] = freshReviews([
      coverageRow({ channelCode: "CAFE24", channelNameKo: "카페24", state: "OBSERVED_FRESHNESS_UNPROVEN", supported: true,
        connected: true, rows: 40, lastSuccessfulSyncAt: "2026-08-10T00:00:00Z" }),
    ]);
    h.recentReviews["false:CAFE24"] = h.recentReviews["false:ALL"]!;
    const view = await h.service.create(TOKEN);

    const { turn } = await say(h, view.conversationId, "카페24 리뷰 최신화해줘");

    expect(turn.status).toBe("DONE");
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    expect(turn.message).toContain("카페24");
    expect(turn.budget?.llmCalls ?? 0).toBe(0);
  });
});
