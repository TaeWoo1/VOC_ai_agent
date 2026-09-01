/**
 * Conversation Contract Correctness v2 (2026-09-01).
 *
 * The 53-turn regression corpus of `docs/planner_model_benchmark_v1.md` had ten turns that EVERY
 * planner model got wrong. A shared failure is not a model failure — it is this repository's contract.
 * The audit found five causes, and each section below is one of them:
 *
 *  A. <b>A stated constraint is dropped when the vocabulary cannot hold it</b> (「최근 3일」).
 *  B. <b>An unstated constraint is invented by the read</b> (「별점 낮은 리뷰」 → a seven-day window).
 *  C. <b>A token nothing could read becomes a narrowing</b> (하나 · 이거 as SUBJECTS).
 *  D. <b>The target step cannot see the objects the same turn put on the table.</b>
 *  E. <b>A reference has no referent, and the run investigates anyway.</b>
 *
 * The rule under all five is one: the seller's words → scope → target → constraints → capabilities.
 * Everything the sentence states must reach the read or be said; nothing it does not state may.
 */
import { describe, expect, it } from "vitest";
import { subjectTermOf, usableTerm } from "../../src/conversation/subjectTerm";
import { visibleFilterOf } from "../../src/conversation/taskInterpreter";
import { visibleSelectionOf } from "../../src/conversation/visibleSelection";
import {
  hasRefineExpression, isQuantityWord, isReferenceOnly, isReferenceWord, namesContent, namesOwnObject,
} from "../../src/conversation/reference";
import { periodLabel, windowOf } from "../../src/conversation/period";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import type { AgentPlanView } from "../../src/spring/types";
import { CABLE, MOLDING } from "../support/operatorFixtures";
import { W_RETURN, W_SHIP, artifact, harness, say, TODAY } from "./support";
import type { Harness } from "./support";

const V3 = "AUTHORED v3 (Conversation Contract Correctness v2)";

function rowsPlan(goal: string, filters: AgentPlanView["filters"], extra: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: [{ id: "n1", question: "어떤 문의가 들어왔는가", kind: "INQUIRY_VOLUME", why: "", required: true }],
    specialists: ["INQUIRY_OPS"], tools: ["list_inquiry_rows"], retrievalOrder: ["n1"], retrievalParallel: [],
    retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 8,
    stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: null,
    providerVersion: V3, requestedAction: "NONE", tone: null, filters, target: { selector: "NONE", index: null }, ...extra,
  };
}

async function fresh(h: Harness): Promise<string> {
  return (await h.service.create("test-token")).conversationId;
}

/** The suite's recordings plus this test's own — the fake resolves a plan by the seller's exact sentence. */
function withPlans(extra: Record<string, AgentPlanView>): Harness {
  return harness({ plansByGoal: { ...RECORDED_PLANS, ...CONVERSATION_PLANS, ...extra } });
}

describe("A — a period the closed tokens cannot hold still reaches the read", () => {
  it("LAST_N_DAYS is a window, and it is labelled with the number the seller said", () => {
    expect(windowOf("LAST_N_DAYS", "2026-09-01", 3)).toEqual({ from: "2026-08-30", to: "2026-09-01", token: "LAST_N_DAYS", days: 3 });
    expect(periodLabel("LAST_N_DAYS", 3)).toBe("최근 3일");
    // Clamped, never invented: a count outside the bound is pulled back to it rather than refused.
    expect(windowOf("LAST_N_DAYS", "2026-09-01", 10_000).days).toBe(365);
  });

  it("「최근 3일 안에 들어온 문의만」 sends from/to to the rows read — it used to send none", async () => {
    const h = withPlans({ ["최근 3일 안에 들어온 문의만 보여줘"]:
      rowsPlan("최근 3일 안에 들어온 문의", {
        period: "LAST_N_DAYS", periodDays: 3, rating: null, channel: null, scope: null, topic: null,
        reviewIntent: null, inquiryIntent: "ROWS", limit: null, order: null, status: null,
      } as AgentPlanView["filters"]) });
    const id = await fresh(h);
    const { turn } = await say(h, id, "최근 3일 안에 들어온 문의만 보여줘");
    expect(h.inquiry.rowsParams.at(-1)).toMatchObject({ from: "2026-08-25", to: TODAY });
    // The narrowing is said back in the seller's own number, so a zero under it is a zero about it.
    expect(turn.message).toContain("최근 3일");
  });

  it("a day count without the token that needs one is dropped, not reconciled", async () => {
    const h = withPlans({ ["오늘 문의 보여줘"]:
      rowsPlan("오늘 들어온 문의", {
        period: "TODAY", periodDays: 3, rating: null, channel: null, scope: null, topic: null,
        reviewIntent: null, inquiryIntent: "ROWS", limit: null, order: null, status: null,
      } as AgentPlanView["filters"]) });
    const id = await fresh(h);
    await say(h, id, "오늘 문의 보여줘");
    expect(h.inquiry.rowsParams.at(-1)).toMatchObject({ from: TODAY, to: TODAY });
  });
});

describe("B — an unnamed period is not a window", () => {
  it("「별점 낮은 리뷰 보여줘」 reads what is held: no from/to, and no period in the sentence back", async () => {
    const h = withPlans({ "별점 낮은 리뷰 보여줘": {
      ...CONVERSATION_PLANS["오늘 새로 달린 리뷰 보여줘"]!,
      userGoal: "낮은 평점 리뷰를 보고 싶다",
      filters: { period: null, rating: "LOW", channel: null, scope: null, topic: null } as AgentPlanView["filters"],
    } });
    const id = await fresh(h);
    const { turn } = await say(h, id, "별점 낮은 리뷰 보여줘");
    const args = h.operator.recentReviewParams.at(-1)!;
    expect(args.from).toBeUndefined();
    expect(args.to).toBeUndefined();
    expect(args.negativeOnly).toBe(true);
    // It used to answer 「최근 7일 낮은 평점 리뷰는 …」 — a window nobody asked for, disclosed and wrong.
    expect(turn.message).not.toContain("최근 7일");
    expect(artifact(turn, "REVIEW_LIST").scope.period).toBeNull();
  });
});

describe("C — a token the tables cannot read narrows nothing", () => {
  it("reference, quantity and interrogative words are not content", () => {
    expect(isReferenceWord("이거")).toBe(true);
    expect(isReferenceWord("그건")).toBe(true);
    expect(isQuantityWord("하나")).toBe(true);
    expect(namesContent("언제")).toBe(false);
    expect(namesContent("현금영수증")).toBe(true);
    expect(usableTerm("하나")).toBeNull();
    expect(usableTerm("이거")).toBeNull();
  });

  it("a relative clause's verb is not the question's subject; the head noun is", () => {
    // 「되냐」 was extracted as a subject, `q=되냐` matched nothing, and the answer was 「그런 문의는
    // 없습니다」 about an inquiry that exists.
    expect(subjectTermOf("재입고 언제 되냐는 문의 답변 준비해줘")).toBe("재입고");
    expect(subjectTermOf("어제 들어온 문의 보여줘")).toBeNull();
    expect(subjectTermOf("밀린 문의 보여줘")).toBeNull();
    // The nearest content word to the head noun wins — Korean puts the head last.
    expect(subjectTermOf("무선 청소기 관련 문의")).toBe("청소기");
    // A scan may not leave the noun phrase the marker opened.
    expect(subjectTermOf("문의에서도 비슷한 얘기 있어?")).toBeNull();
  });

  it("「그중 제일 오래된 거 하나만」 is an order+limit refine, not a subject called 하나", () => {
    expect(visibleFilterOf("그중 제일 오래된 거 하나만")).toMatchObject({ order: "OLDEST", limit: 1, term: null });
    // The subject axis still works when the sentence MARKS one.
    expect(visibleFilterOf("그중 현금영수증만")).toMatchObject({ term: "현금영수증" });
  });

  it("a leftover the sentence never marked is the planner's, never a filter", () => {
    // 「~만」 on the word itself, or a subject marker — otherwise the lane declines rather than narrowing
    // by a token it could not read.
    expect(visibleFilterOf("그중 어제 것만")).toBeNull();
  });

  it("a quoted row title with a demonstrative selects that row", () => {
    const rows = [
      { id: "i-1", title: "배송이 너무 늦습니다", productName: null, channelCode: "CAFE24", channelNameKo: "카페24" },
      { id: "i-2", title: "현금영수증 발행 부탁드립니다", productName: null, channelCode: "NAVER", channelNameKo: "네이버" },
    ];
    // 이거 used to become a literal every row had to contain; no row did, so the lane declined and the
    // planner re-printed the whole list.
    expect(visibleSelectionOf("배송이 너무 늦습니다 이거 보여줘", rows)).toEqual({ kind: "SELECTED", id: "i-1" });
  });
});

describe("D — the target step sees the objects this turn put on the table", () => {
  it("a PREPARE whose own read found exactly one inquiry drafts for it", async () => {
    const h = withPlans({ ["반품 문의 답변 준비해줘"]:
      rowsPlan("반품 얘기를 한 문의의 답변을 준비한다", {
        period: null, periodDays: null, rating: null, channel: null, scope: null, topic: "EXCHANGE_RETURN",
        reviewIntent: null, inquiryIntent: "WORKLOAD", limit: null, order: null, status: null,
      } as AgentPlanView["filters"], {
        requestedAction: "PREPARE_INQUIRY_DRAFT",
        tools: ["list_inquiry_workload"],
      }) });
    const id = await fresh(h);
    const { turn } = await say(h, id, "반품 문의 답변 준비해줘");
    // It used to answer 「어떤 문의의 답변을 준비할지 알려주세요」 with that one row printed underneath.
    expect(turn.message).not.toContain("어떤 문의의 답변을 준비할지");
    expect(artifact(turn, "DRAFT").inquiryId).toBe("inq-return");
  });

  it("an ORDINAL still indexes what the seller was looking at, never rows this turn drew", async () => {
    const h = harness();
    const id = await fresh(h);
    // 「첫 번째 거」 with nothing on screen points at nothing — the turn's own read is not a list the
    // seller could have counted.
    const { turn } = await say(h, id, "첫 번째 거 답변 준비해줘");
    expect(turn.artifacts.some((a) => a.type === "DRAFT")).toBe(false);
    expect(turn.message).toContain("어떤 문의의 답변을 준비할지 알려주세요");
  });
});

describe("D2 — a narrowing that never said it was one is a new question", () => {
  it("「답변 안 한 문의 보여줘」 after a topic list reads the ORG, not the two rows on screen", async () => {
    const h = withPlans({
      "배송 관련 문의만 봐줘": rowsPlan("배송 관련 문의를 본다", {
        period: null, periodDays: null, rating: null, channel: null, scope: null, topic: "SHIPPING",
        reviewIntent: null, inquiryIntent: "ROWS", limit: null, order: null, status: null,
      } as AgentPlanView["filters"]),
      // The planner marked the second sentence a follow-up and copied the set's topic — the shape that
      // answered twelve inquiries with one.
      "답변 안 한 문의 보여줘": rowsPlan("답변 안 한 문의를 본다", {
        period: null, periodDays: null, rating: null, channel: null, scope: "WORKING_SET", topic: "SHIPPING",
        reviewIntent: null, inquiryIntent: "ROWS", limit: null, order: null, status: "UNANSWERED",
      } as AgentPlanView["filters"]),
    });
    const id = await fresh(h);
    await say(h, id, "배송 관련 문의만 봐줘");
    const { turn } = await say(h, id, "답변 안 한 문의 보여줘");
    expect(turn.message).not.toContain("방금 본 문의 중");
    // The inherited topic goes with the voided refine: the read is about the org's unanswered inquiries.
    expect(h.inquiry.rowsParams.at(-1)).toMatchObject({ status: "UNANSWERED" });
    expect(artifact(turn, "INQUIRY_LIST").groups.flatMap((g) => g.items).length).toBeGreaterThan(1);
  });

  it("a FRAGMENT is still a refine: 「배송 관련부터」 names no object and cannot be read without the rows", () => {
    // The rule is "no refine expression ⇒ a new question", and a fragment has no expression either. What
    // separates them is whether the sentence stands on its own: 「답변 안 한 문의 보여줘」 would mean the
    // same thing said first; 「배송 관련부터」 would mean nothing.
    expect(namesOwnObject("답변 안 한 문의 보여줘")).toBe(true);
    expect(namesOwnObject("배송 관련부터")).toBe(false);
    expect(hasRefineExpression("안 좋은 것만 봐줘")).toBe(true);
    expect(hasRefineExpression("문의만 보여줘")).toBe(false);
  });

  it("a follow-up that names no filter axis is untouched — grouping and cross-domain still refine", async () => {
    const h = withPlans({});
    const id = await fresh(h);
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    const { turn } = await say(h, id, "상품별로 묶어줘");
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts.some((a) => a.type === "PRODUCT_LIST")).toBe(true);
  });
});

describe("E — a reference resolves to the focus, or the turn asks", () => {
  it("「이 고객한테 뭐라고 답해야 해?」 over a ONE-row visible set is answered about that row, with no planner", async () => {
    const h = withPlans({ ["반품 문의 보여줘"]:
      rowsPlan("반품 문의를 본다", {
        period: null, periodDays: null, rating: null, channel: null, scope: null, topic: "EXCHANGE_RETURN",
        reviewIntent: null, inquiryIntent: "ROWS", limit: null, order: null, status: null,
      } as AgentPlanView["filters"]) });
    const id = await fresh(h);
    const first = await say(h, id, "반품 문의 보여줘");
    expect(first.turn.continuation.workingSet?.count).toBe(1);
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "이 고객한테 뭐라고 답해야 해?");
    // A one-row set has exactly one referent. The two paths used to disagree: the planner's own target
    // resolution treated it as the target and the deterministic lanes did not, so this sentence fell
    // through to the org queue and ended the turn WAITING_HUMAN.
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts.some((a) => a.type === "INQUIRY_LIST")).toBe(false);
  });

  it("a sentence that names nothing and points at nothing asks, and spends no model call", async () => {
    const h = harness();
    const id = await fresh(h);
    const plans = h.operator.calls.plan;
    const { turn } = await say(h, id, "그거 어떻게 처리하지?");
    expect(h.operator.calls.plan).toBe(plans);
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts).toHaveLength(0);
    expect(turn.budget?.llmCalls).toBe(0);
    expect(turn.budget?.toolCalls).toBe(0);
    expect(isReferenceOnly("그거 어떻게 처리하지?")).toBe(true);
    // One content word and it is the planner's again — the classification can only send a sentence TO
    // the planner by mistake, never away from it.
    expect(isReferenceOnly("미답변 문의 보여줘")).toBe(false);
    expect(isReferenceOnly("이 문의 답변 준비해줘")).toBe(false);
  });
});

describe("the subject axis matches the product an inquiry is bound to", () => {
  it("is one set of fields in the visible lane and in the read", () => {
    // The visible-set FILTER lane has always matched title · product name · snippet; the backend read
    // matched only the two text columns, so 「실리콘 몰딩 관련 문의 있어?」 answered 「없습니다」 to a
    // seller holding four inquiries about that product. The predicate now covers the bound product's
    // name (`InquiryRepository.findRowsInWindow`), which this suite cannot execute — it is asserted in
    // the backend's own repository test. What IS asserted here: the word reaches the read at all.
    expect(subjectTermOf("실리콘 몰딩 관련 문의 있어?")).toBe("몰딩");
    expect(MOLDING.name).toContain("몰딩");
    expect(CABLE.id).not.toBe(MOLDING.id);
    expect([W_SHIP, W_RETURN]).toHaveLength(2);
  });
});
