/**
 * Chat-first Completion & Continuity v1 — the four deterministic readings this package added, and the
 * one integration claim that matters: the CHANNEL a seller named reaches the READ, not just the screen.
 */
import { describe, expect, it } from "vitest";
import { TODAY, TOKEN, artifact, coverageRow, freshReviews, harness, say } from "./support";
import type { Harness } from "./support";
import { CONVERSATION_PLANS, NEW_REVIEWS_TODAY_PLAN, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView } from "../../src/spring/types";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { channelFocusOf, channelInSentence, namesAllChannels } from "../../src/conversation/channelFocus";
import { periodTermOf, settledPeriod } from "../../src/conversation/periodTerm";
import { isAcquisitionRequest } from "../../src/conversation/acquisitionRequest";
import { acquisitionMeaning, acquisitionResultOf } from "../../src/conversation/acquisitionSummary";
import { windowOf, periodLabel } from "../../src/conversation/period";

const V4 = "agent-plan-prompt/v4";
type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = {
  period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
  inquiryIntent: null, limit: null, order: null, status: null,
};
function rowsPlan(goal: string, filters: Partial<Filters>): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: goal, kind: "INQUIRY_VOLUME", why: "목록이 질문이다", required: true }],
    specialists: ["INQUIRY_OPS"], tools: [], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 8,
    stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: "목록",
    providerVersion: V4, requestedAction: "NONE", tone: null, filters: { ...NONE, ...filters }, target: { selector: "NONE", index: null },
  };
}

const NAVER = { sellerAccountId: "acct-naver", channelId: "chan-naver", channelCode: "NAVER", channelNameKo: "네이버" } as const;
const CAFE24 = { sellerAccountId: "acct-cafe24-1", channelId: "chan-cafe24", channelCode: "CAFE24", channelNameKo: "카페24" } as const;

function seeds(): SeedInquiry[] {
  return [
    { workItemId: "w-n1", inquiryId: "i-n1", ...NAVER, title: "배송 언제 되나요", details: "…", receivedAt: `${TODAY}T05:00:00Z` },
    { workItemId: "w-c1", inquiryId: "i-c1", ...CAFE24, title: "택배가 아직 안 왔어요", details: "…", receivedAt: `${TODAY}T04:00:00Z` },
    { workItemId: "w-n2", inquiryId: "i-n2", ...NAVER, title: "규격이 어떻게 되나요", details: "…", receivedAt: `${TODAY}T02:00:00Z` },
  ];
}

const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  "네이버 문의 보여줘": rowsPlan("네이버 문의", { inquiryIntent: "ROWS", channel: "NAVER", order: "NEWEST" }),
  // The follow-up the seller writes next. The planner names NO channel — it is a plain new read — which
  // is exactly the sentence that used to come back org-wide.
  "안 좋은 거 있어?": rowsPlan("문의", { inquiryIntent: "ROWS", order: "NEWEST" }),
  "전체 채널 문의 보여줘": rowsPlan("문의", { inquiryIntent: "ROWS", order: "NEWEST" }),
};

async function fresh(): Promise<{ h: Harness; id: string }> {
  const h = harness({ plansByGoal: PLANS }, seeds());
  const view = await h.service.create(TOKEN);
  return { h, id: view.conversationId };
}
const ids = (turn: Awaited<ReturnType<typeof say>>["turn"]) =>
  artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items.map((i) => i.inquiryId));

describe("§5 channel continuity — the focus is the last channel the SELLER named", () => {
  it("reads one channel per sentence, and none when a sentence names two", () => {
    expect(channelInSentence("네이버 리뷰 보여줘")).toBe("NAVER");
    expect(channelInSentence("스마트스토어 최신 리뷰")).toBe("NAVER");
    expect(channelInSentence("쿠팡 문의")).toBe("COUPANG");
    expect(channelInSentence("카페24 문의")).toBe("CAFE24");
    expect(channelInSentence("네이버랑 쿠팡 비교해줘")).toBeNull();
    expect(channelInSentence("오늘 리뷰 있어?")).toBeNull();
    expect(namesAllChannels("전체 채널 기준으로 보여줘")).toBe(true);
    expect(namesAllChannels("네이버 리뷰")).toBe(false);
  });

  it("the newest settling sentence wins, and 「전체 채널」 clears the focus", () => {
    const turns = [
      { role: "USER", text: "네이버 리뷰 보여줘" },
      { role: "AGENT", text: null },
      { role: "USER", text: "오늘 들어온 건은?" },
    ] as never;
    expect(channelFocusOf(turns)).toBe("NAVER");
    expect(channelFocusOf(turns, "쿠팡은 어때?")).toBe("COUPANG");
    expect(channelFocusOf(turns, "전체 채널로 보여줘")).toBeNull();
    expect(channelFocusOf([] as never)).toBeNull();
  });

  it("integration: a NAVER thread's follow-up READS naver — the row set, not just the card", async () => {
    const { h, id } = await fresh();
    const first = await say(h, id, "네이버 문의 보여줘");
    expect(ids(first.turn)).toEqual(["i-n1", "i-n2"]);

    const { turn } = await say(h, id, "안 좋은 거 있어?");
    // Before this package the same sentence answered org-wide and the Cafe24 row rode in with it.
    expect(ids(turn)).toEqual(["i-n1", "i-n2"]);
    expect(h.inquiry.rowsParams.at(-1)!.channel).toBe("NAVER");
  });

  it("integration: 「전체 채널」 ends the focus in the same thread", async () => {
    const { h, id } = await fresh();
    await say(h, id, "네이버 문의 보여줘");
    const { turn } = await say(h, id, "전체 채널 문의 보여줘");
    expect(ids(turn)).toEqual(["i-n1", "i-c1", "i-n2"]);
    expect(h.inquiry.rowsParams.at(-1)!.channel).toBeUndefined();
  });
});

describe("§7 period drift — the axis can hold a month, and a named period outranks a different plan token", () => {
  it("THIS_MONTH / LAST_MONTH are calendar windows, not day counts", () => {
    expect(windowOf("THIS_MONTH", "2026-09-02")).toEqual({ from: "2026-09-01", to: "2026-09-02", token: "THIS_MONTH" });
    expect(windowOf("LAST_MONTH", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28", token: "LAST_MONTH" });
    expect(periodLabel("THIS_MONTH")).toBe("이번 달");
    expect(periodLabel("LAST_MONTH")).toBe("지난달");
  });

  it("reads the period the sentence names, and corrects a plan that named a different one", () => {
    expect(periodTermOf("이번 달 리뷰 어때?")).toBe("THIS_MONTH");
    expect(periodTermOf("지난달 문의")).toBe("LAST_MONTH");
    expect(periodTermOf("오늘 들어온 리뷰")).toBe("TODAY");
    // Two periods in one sentence determine nothing.
    expect(periodTermOf("지난달이랑 이번 달 비교해줘")).toBeNull();
    // The live drift: 「이번 달」 planned as THIS_WEEK.
    expect(settledPeriod("THIS_WEEK", "이번 달 리뷰 어때?")).toBe("THIS_MONTH");
    // It corrects; it never introduces. 「오늘 할 일」 is a queue question whose period is deliberately null.
    expect(settledPeriod(null, "오늘 내가 답해야 할 문의")).toBeNull();
    expect(settledPeriod("LAST_N_DAYS", "최근 3일 문의")).toBe("LAST_N_DAYS");
  });
});

describe("§1 an explicit READ instruction is not a question", () => {
  it("recognises the instruction and refuses anything shaped like a question", () => {
    expect(isAcquisitionRequest("네이버 리뷰 최신화해줘")).toBe(true);
    expect(isAcquisitionRequest("리뷰 새로 가져와줘")).toBe(true);
    expect(isAcquisitionRequest("쿠팡 후기 업데이트해줘")).toBe(true);
    expect(isAcquisitionRequest("오늘 네이버 리뷰 있어?")).toBe(false);
    expect(isAcquisitionRequest("리뷰 가져올 수 있어?")).toBe(false);
    expect(isAcquisitionRequest("네이버 문의 최신화해줘")).toBe(false);
    expect(isAcquisitionRequest("반복되는 문제 알려줘")).toBe(false);
    // The object may be the conversation's — but only when the sentence names no other one.
    expect(isAcquisitionRequest("그럼 최신화해줘")).toBe(false);
    expect(isAcquisitionRequest("그럼 최신화해줘", { reviewsInContext: true })).toBe(true);
    expect(isAcquisitionRequest("문의 최신화해줘", { reviewsInContext: true })).toBe(false);
  });
});

/**
 * Outcome Artifact v1 §1 — the completion's facts became an object and its prose became a meaning.
 * The old contract asserted five numbers inside one sentence; it is rewritten, not weakened: every fact
 * it checked is still checked, on the artifact that now carries it.
 */
describe("§3 the completion result is a structured object, and the prose is its meaning", () => {
  const NAVER = { periodStart: "2026-09-01", periodEnd: "2026-09-02", result: "SUCCEEDED",
    rowsNew: 115, rowsDuplicate: 33, rowsFailed: 0, finishedAt: null };

  it("carries the window and the three tallies as values", () => {
    expect(acquisitionResultOf("NAVER", "네이버", NAVER)).toEqual({
      artifactId: "a-acquisition-naver", type: "ACQUISITION_RESULT", title: "네이버 리뷰 가져오기 결과", titleSaid: true,
      channelCode: "NAVER", channelNameKo: "네이버",
      periodStart: "2026-09-01", periodEnd: "2026-09-02", rowsNew: 115, rowsDuplicate: 33, rowsFailed: 0,
    });
    // A tally the record does not hold stays null — never a zero we did not observe.
    expect(acquisitionResultOf("NAVER", "네이버", { ...NAVER, rowsDuplicate: null, rowsFailed: null }))
      .toMatchObject({ rowsNew: 115, rowsDuplicate: null, rowsFailed: null });
    // Half a range is not a period: it is dropped rather than completed with a placeholder.
    expect(acquisitionResultOf("NAVER", "네이버", { ...NAVER, periodEnd: null }))
      .toMatchObject({ periodStart: null, periodEnd: null });
    // Nothing to describe is not a run that brought in nothing.
    expect(acquisitionResultOf("NAVER", "네이버", {
      periodStart: null, periodEnd: null, result: "SUCCEEDED",
      rowsNew: null, rowsDuplicate: null, rowsFailed: null, finishedAt: null,
    })).toBeNull();
  });

  it("says what the result MEANS and not one number of it", () => {
    const one = acquisitionResultOf("NAVER", "네이버", NAVER)!;
    expect(acquisitionMeaning([one])).toBe("네이버 리뷰를 새로 가져왔습니다.");
    expect(acquisitionMeaning([acquisitionResultOf("NAVER", "네이버", { ...NAVER, rowsNew: 0 })!]))
      .toBe("네이버 리뷰를 확인했지만 새로 들어온 리뷰는 없습니다.");
    // An untallied run cannot claim either way.
    expect(acquisitionMeaning([acquisitionResultOf("NAVER", "네이버", { ...NAVER, rowsNew: null })!]))
      .toBe("네이버 리뷰를 확인했습니다.");
    expect(acquisitionMeaning([])).toBeNull();
    // Every digit of the record stays on the card.
    for (const digits of ["115", "33", "0", "9월 1일", "9월 2일"]) {
      expect(acquisitionMeaning([one])).not.toContain(digits);
    }
  });

  it("no internal word reaches the seller — in the sentence or on the card", () => {
    const card = acquisitionResultOf("NAVER", "네이버", NAVER)!;
    const seen = `${acquisitionMeaning([card])} ${card.title}`.toLowerCase();
    for (const word of ["sync", "segment", "plan", "구간", "계획", "동기화", "provenance", "ingest", "run"]) {
      expect(seen).not.toContain(word);
    }
  });
});

describe("§3 end to end — the resume says what the run DID, not that it happened", () => {
  it("a completed acquisition summarises its window and tallies in the same conversation", async () => {
    const h = harness();
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: true });
    const staleNaver = () => [
      coverageRow({}),
      coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "ZERO", rows: 0, openRows: 0, newestObservedAt: null }),
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: "2026-08-10T00:00:00Z", newestObservedAt: "2026-08-09T00:00:00Z" }),
    ];
    h.recentReviews["false:ALL"] = { ...freshReviews(staleNaver()), items: [], total: 0 };
    const view = await h.service.create(TOKEN);
    const id = view.conversationId;

    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(first.turn.status).toBe("WAITING_HUMAN");

    h.inquiry.syncRuns.push({
      id: "up-1", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 115, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z",
    });
    // What the backend says that run actually did — named by the run's id, never asserted by the client.
    h.inquiry.acquisitionResults.set("up-1", {
      periodStart: "2026-09-01", periodEnd: "2026-09-02", result: "SUCCEEDED",
      rowsNew: 115, rowsDuplicate: 33, rowsFailed: 0, finishedAt: "2099-01-01T00:02:00Z",
    });
    h.recentReviews["false:ALL"] = freshReviews(staleNaver());

    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("DONE");
    // The meaning is said once, in prose…
    expect(turn.message).toContain("네이버 리뷰를 새로 가져왔습니다");
    // …and the numbers and the window are on the card, not in the paragraph.
    const card = turn.artifacts.find((a) => a.type === "ACQUISITION_RESULT");
    expect(card).toMatchObject({
      channelCode: "NAVER", channelNameKo: "네이버",
      periodStart: "2026-09-01", periodEnd: "2026-09-02", rowsNew: 115, rowsDuplicate: 33, rowsFailed: 0,
    });
    expect(turn.message).not.toContain("115");
    expect(turn.message).not.toContain("33건");
    // The old sentence said only that it happened. It is gone when there is something better to say.
    expect(turn.message).not.toContain("새 리뷰 가져오기가 끝났습니다");
  });

  it("a run with no acquisition record keeps the sentence that was always true", async () => {
    const h = harness();
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: true });
    const staleNaver = () => [
      coverageRow({}),
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: "2026-08-10T00:00:00Z", newestObservedAt: "2026-08-09T00:00:00Z" }),
    ];
    h.recentReviews["false:ALL"] = { ...freshReviews(staleNaver()), items: [], total: 0 };
    const view = await h.service.create(TOKEN);
    const id = view.conversationId;
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    h.inquiry.syncRuns.push({
      id: "up-2", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 3, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z",
    });
    h.recentReviews["false:ALL"] = freshReviews(staleNaver());

    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.message.startsWith("새 리뷰 가져오기가 끝났습니다")).toBe(true);
  });
});

describe("§1 end to end — an explicit instruction produces the step even when the channel reads fresh", () => {
  it("「네이버 리뷰 최신화해줘」 asks for the guided run; the same words as a question do not", async () => {
    const freshNaver = () => [
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: `${TODAY}T03:00:00Z`, newestObservedAt: `${TODAY}T02:00:00Z` }),
    ];
    // The planner reads it as a plain review read — which is exactly the shape that used to answer with
    // rows and no way to collect once the channel had been read that morning.
    const h = harness({
      plansByGoal: { ...RECORDED_PLANS, ...CONVERSATION_PLANS, "네이버 리뷰 최신화해줘": NEW_REVIEWS_TODAY_PLAN },
      channelCoverage: freshNaver(),
    });
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false });
    h.recentReviews["false:ALL"] = freshReviews(freshNaver());
    // The thread's channel reaches the READ, so the fake is asked for NAVER — that key is the proof.
    h.recentReviews["false:NAVER"] = freshReviews(freshNaver());
    const view = await h.service.create(TOKEN);
    const id = view.conversationId;

    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "네이버 리뷰 최신화해줘");
    if (turn.status === "FAILED") throw new Error(`FAILED: ${turn.failureCode} ${turn.message}`);
    const step = turn.artifacts.find((a) => a.type === "HUMAN_ACTION_REQUIRED");
    expect(step).toBeTruthy();
    // The instruction already happened: the card starts on arrival instead of asking for it again.
    expect(step).toMatchObject({ actionType: "REVIEW_IMPORT", channelCode: "NAVER", autoStart: true });
    // A closed instruction about a channel the conversation is already about — no plan, no model call.
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.budget?.llmCalls ?? 0).toBe(0);
    expect(turn.status).toBe("WAITING_HUMAN");
    // The card is the only thing on screen: an instruction is not answered with a list nobody asked for.
    expect(turn.artifacts).toHaveLength(1);
    // The turn waits on the seller's own window, so a resume can settle it.
    expect(turn.continuation.pendingHumanAction).toMatchObject({ channelCode: "NAVER", dataType: "REVIEW" });
  });

  it("「그럼 최신화해줘」 after a NAVER review list is the same instruction — the thread supplies both words", async () => {
    const freshNaver = () => [
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: `${TODAY}T03:00:00Z`, newestObservedAt: `${TODAY}T02:00:00Z` }),
    ];
    const h = harness({
      plansByGoal: { ...RECORDED_PLANS, ...CONVERSATION_PLANS, "네이버 리뷰 보여줘": NEW_REVIEWS_TODAY_PLAN },
      channelCoverage: freshNaver(),
    });
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false });
    h.recentReviews["false:ALL"] = freshReviews(freshNaver());
    h.recentReviews["false:NAVER"] = freshReviews(freshNaver());
    const view = await h.service.create(TOKEN);
    const id = view.conversationId;
    await say(h, id, "네이버 리뷰 보여줘");

    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "그럼 최신화해줘");
    // Live 2026-09-02 this same sentence came back as a re-print of the two rows, and on a second attempt
    // as 「지금 먼저 하실 일은 없습니다」 — two different plans for one unmistakable instruction.
    expect(turn.artifacts.find((a) => a.type === "HUMAN_ACTION_REQUIRED")).toMatchObject({ channelCode: "NAVER", autoStart: true });
    expect(turn.artifacts.some((a) => a.type === "REVIEW_LIST")).toBe(false);
    expect(h.operator.calls.plan).toBe(plans);
  });
});
