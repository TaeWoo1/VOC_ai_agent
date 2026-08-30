/**
 * Seller-facing Response Hygiene v1 (2026-08-30) — what the seller reads is closed vocabulary, short,
 * 존댓말, and never an internal token, a stamp, a planner sentence, or the same fact twice.
 *
 *  §1 no internal terminology in any seller-facing string (message, artifact, evidence label).
 *  §2 direct answer first; NO_ANSWER_BASIS = what is missing + one next step, said once.
 *  §3 the company profile is referred to, not read back — unless the introduction itself was asked.
 *  §4 one sentence per retrieval outcome, and 없다·찾지 못했다·적용하기 어렵다 never mix.
 *  §6 a selected inquiry is not asked for again; a draft-ready claim never stands beside a knowledge gap.
 *  §7 「방금 본 리뷰를 …묶었습니다」 only when a review set was actually grouped.
 *  §8 planner rationale / clarification text never leaves the trace.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN, W_SHIP, artifact, harness, inquiries, say } from "./support";
import type { Harness } from "./support";
import { CLARIFY_PLAN, CONVERSATION_PLANS, RECORDED_PLANS, REFUSED_PLAN } from "../support/recordedPlans";
import type { AgentPlanView, KnowledgeSearchResult, OrgKnowledgeSearchResult, SellerProfileView } from "../../src/spring/types";
import { resetJudgeCapabilityMemo } from "../../src/operator/judge/EvidenceJudge";
import { MOLDING } from "../support/operatorFixtures";
import {
  INTERNAL_TOKEN, clarificationKindOf, clarificationSentence, excerpt, factSourceLabel, isSellerSafeLabel,
  retrievalSentence, unsupportedSentence,
} from "../../src/operator/wording/sellerWording";
import { dedupeNear, sellerSentence } from "../../src/conversation/ConversationService";

const V8 = "agent-plan-prompt/v8";
type Filters = NonNullable<AgentPlanView["filters"]>;
const NONE: Filters = {
  period: null, rating: null, channel: null, scope: null, topic: null, reviewIntent: null,
  inquiryIntent: null, limit: null, order: null, status: null,
};

function plan(goal: string, need: { kind: string; question: string } | null,
  specialists: string[], tools: string[], extra: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    available: true, supported: true, userGoal: goal, unresolvedEntities: [],
    informationNeeds: need ? [{ id: "n1", question: need.question, kind: need.kind, why: "근거", required: true }] : [],
    specialists, tools, retrievalOrder: need ? ["n1"] : [], retrievalParallel: [], retrievalStopWhen: null,
    evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 6, stopWhenEnough: null,
    clarificationNeeded: false, clarificationReason: null, rationale: "근거 조회", providerVersion: V8,
    requestedAction: "NONE", tone: null, filters: { ...NONE }, target: { selector: "NONE", index: null }, ...extra,
  };
}

const SUMMARY = "전선몰딩과 전기자재를 제조·판매하며, 기업 고객과 시공업체 주문 비중이 높습니다.";
const PROFILE: SellerProfileView = { name: "선바로", businessSummary: SUMMARY, configured: true, updatedAt: "2026-08-30T01:00:00Z" };

const POLICY_ASK = "이 문의에 우리 배송 정책 기준으로 답해줘";
const DOC_ASK = `${MOLDING.name} 반품 조건이 명시돼 있는지 확인해줘`;
const ROWS_ASK = "최근 문의 3개 보여줘";
const PROFILE_HINT_ASK = "우리 회사 특성 고려하면 배송 문의에 어떻게 답하는 게 좋을까";
const PROFILE_INTRO_ASK = "우리 회사는 어떤 곳으로 등록돼 있어?";
const WHICH_ASK = "그거 뭐라고 답할까";
const RAW_REFUSE = "그 객체 삭제해줘";
const DRAFT_ASK = "답변 준비해줘";

const PLANS: Record<string, AgentPlanView> = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS,
  [POLICY_ASK]: plan(POLICY_ASK, { kind: "POLICY", question: "회사의 배송 기준" }, ["INQUIRY_OPS"], ["search_org_knowledge"]),
  [DOC_ASK]: plan(DOC_ASK, { kind: "PRODUCT_KNOWLEDGE_DOC", question: "이 상품의 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘" },
    ["PRODUCT_OPS"], ["search_product_knowledge"], { unresolvedEntities: [{ kind: "PRODUCT", mention: MOLDING.name }] }),
  [ROWS_ASK]: plan(ROWS_ASK, { kind: "INQUIRY_VOLUME", question: "최근 문의 3개" }, ["INQUIRY_OPS"], [],
    { filters: { ...NONE, inquiryIntent: "ROWS", order: "NEWEST", limit: 3 } }),
  [PROFILE_HINT_ASK]: plan(PROFILE_HINT_ASK, { kind: "COMPANY_PROFILE", question: "회사가 어떤 곳인가" }, ["INQUIRY_OPS"], ["get_seller_profile"]),
  [PROFILE_INTRO_ASK]: plan(PROFILE_INTRO_ASK, { kind: "COMPANY_PROFILE", question: "회사가 어떤 곳으로 등록돼 있는가" }, ["INQUIRY_OPS"], ["get_seller_profile"]),
  [WHICH_ASK]: { ...CLARIFY_PLAN, userGoal: WHICH_ASK, clarificationReason: "어떤 문의를 말씀하시는지 알려주세요.", rationale: "대상 문의가 특정되지 않았습니다." },
  [RAW_REFUSE]: { ...REFUSED_PLAN, userGoal: RAW_REFUSE, rationale: "대상 텍스트나 객체가 지정되지 않아 조사 자체를 수행할 수 없다" },
  [DRAFT_ASK]: plan(DRAFT_ASK, { kind: "INQUIRY_VOLUME", question: "이 문의" }, ["INQUIRY_OPS"], [],
    { requestedAction: "PREPARE_INQUIRY_DRAFT", target: { selector: "THIS", index: null }, filters: { ...NONE, inquiryIntent: "WORKLOAD" } }),
};

const policy = (outcome: OrgKnowledgeSearchResult["outcome"], documentsSearched: number): OrgKnowledgeSearchResult =>
  ({ query: "", documentsSearched, passagesSearched: documentsSearched, passages: [], outcome, rejectedNotApplicable: outcome === "NOT_APPLICABLE" ? 1 : 0, candidatesTried: 3 });
const knowledge = (outcome: KnowledgeSearchResult["outcome"]): KnowledgeSearchResult =>
  ({ productId: MOLDING.id, query: "", documentsSearched: 3, passagesSearched: 3, passages: [], outcome, rejectedNotApplicable: outcome === "NOT_APPLICABLE" ? 1 : 0, candidatesTried: 3 });

async function ask(h: Harness, text: string, extra: Record<string, unknown> = {}) {
  const view = await h.service.create(TOKEN);
  return say(h, view.conversationId, text, extra);
}

/** The fields an artifact renders as text (closed enums such as `reason`/`actionType` render through FE maps, never raw). */
const DISPLAY_KEYS = new Set(["title", "note", "label", "lines", "message", "statement", "preview", "name", "channelNameKo", "productName",
  "prompt", "unavailableMessage", "answerBasisNote", "answerBasisAction", "comments", "scopeLabel", "reasonKo", "detail", "summary"]);

function displayStrings(value: unknown, key: string | null, out: string[]): void {
  if (typeof value === "string") { if (key && DISPLAY_KEYS.has(key)) out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) displayStrings(v, key, out); return; }
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) displayStrings(v, k, out);
}

/** Every string a seller can read on a turn: the message, every artifact's display fields, every evidence label, the chips. */
function sellerFacing(turn: Awaited<ReturnType<typeof ask>>["turn"]): string[] {
  const out = [turn.message];
  for (const a of turn.artifacts) {
    if (a.type === "EVIDENCE") out.push(...a.items.map((i) => i.label));
    else displayStrings(a, null, out);
  }
  out.push(...turn.suggestedActions.map((s) => s.label));
  return out;
}

beforeEach(() => resetJudgeCapabilityMemo());

describe("§4 — the closed wording table", () => {
  it("one sentence per (lane, outcome); 없다 · 찾지 못했다 · 바로 적용하기 어렵다 never mix", () => {
    expect(retrievalSentence("POLICY", "ABSENT", { topic: "배송" })).toBe("등록된 배송 기준이 아직 없습니다.");
    expect(retrievalSentence("POLICY", "NO_RELEVANT_EVIDENCE")).toBe("등록된 운영 정책에서 이 질문에 맞는 근거를 찾지 못했습니다.");
    expect(retrievalSentence("POLICY", "NOT_APPLICABLE", { topic: "배송" })).toBe("배송 기준은 등록되어 있지만 이 문의에 바로 적용하기 어렵습니다.");
    expect(retrievalSentence("PRODUCT", "NO_RELEVANT_EVIDENCE", { subject: "몰딩", documents: 2 })).toBe("몰딩의 등록된 상품 정보(2건)에서 이 질문에 맞는 근거를 찾지 못했습니다.");
    expect(retrievalSentence("PAST_ANSWER", "ABSENT")).toBe("저장된 과거 답변이 아직 없습니다.");
    for (const lane of ["POLICY", "PRODUCT", "PAST_ANSWER"] as const) {
      expect(retrievalSentence(lane, "ABSENT")).not.toMatch(/찾지 못했|적용하기 어렵/);
      expect(retrievalSentence(lane, "NO_RELEVANT_EVIDENCE")).not.toMatch(/아직 없습니다|적용하기 어렵/);
      expect(retrievalSentence(lane, "NOT_APPLICABLE")).not.toMatch(/아직 없습니다|찾지 못했/);
    }
  });

  it("excerpts are bounded and end at a sentence; labels with tokens are not seller-safe; fact stamps get words", () => {
    const long = "첫 문장입니다. ".repeat(30);
    expect(excerpt(long).length).toBeLessThanOrEqual(162);
    expect(excerpt(long).endsWith("…")).toBe(true);
    expect(excerpt("짧은 글")).toBe("짧은 글");
    expect(isSellerSafeLabel("교환 및 반품 안내")).toBe(true);
    expect(isSellerSafeLabel("폭|길이")).toBe(false);
    expect(isSellerSafeLabel("NAVER:PRODUCT_API:v1")).toBe(false);
    expect(isSellerSafeLabel("shipping_delay")).toBe(true);
    expect(factSourceLabel("CAFE24:PRODUCT_API:v2")).toBe("채널 상품 정보");
    expect(factSourceLabel("DERIVED:INGEST")).toBe("상품 등록 정보");
  });
});

describe("§8 — planner text is read, never repeated", () => {
  it("a refusal about an unspecified object becomes 「어떤 문의를 확인할지 먼저 선택해 주세요」", () => {
    expect(unsupportedSentence("대상 텍스트나 객체가 지정되지 않아 조사 자체를 수행할 수 없다"))
      .toBe("어떤 문의를 확인할지 먼저 선택해 주세요. 방금 본 목록에서 「첫 번째 거」처럼 말씀해 주시면 됩니다.");
    expect(unsupportedSentence("판매 운영과 관련이 없는 요청입니다.")).toBe("이 요청은 아직 도와드리기 어렵습니다. 문의·리뷰·상품·주문 중 무엇을 확인할지 알려주세요.");
    expect(clarificationKindOf("어떤 상품을 말씀하시는지 알려주세요.")).toBe("PRODUCT");
    expect(clarificationKindOf("어느 기간을 볼지 불명확")).toBe("PERIOD");
    expect(clarificationSentence("INQUIRY")).toMatch(/^어떤 문의를 확인할지 알려주세요\./);
  });

  it("a FAILED turn carries the closed sentence — the model's 반말 rationale is not in it", async () => {
    const h = harness({ plansByGoal: PLANS });
    const { turn } = await ask(h, RAW_REFUSE);
    expect(turn.status).toBe("FAILED");
    expect(turn.failureCode).toBe("GOAL_UNSUPPORTED");
    expect(turn.message).toBe("어떤 문의를 확인할지 먼저 선택해 주세요. 방금 본 목록에서 「첫 번째 거」처럼 말씀해 주시면 됩니다.");
    expect(turn.message).not.toContain("객체");
    expect(turn.failureReason).toBe(turn.message);
  });
});

describe("§6 — a selected inquiry is not asked for again", () => {
  it("clarification 「어떤 문의?」 after 「두 번째 거」 → the anchor is shown and the next moves offered", async () => {
    const h = harness({ plansByGoal: PLANS });
    const view = await h.service.create(TOKEN);
    await say(h, view.conversationId, ROWS_ASK);
    await say(h, view.conversationId, "두 번째 거");
    const { turn } = await say(h, view.conversationId, WHICH_ASK);
    expect(turn.status).toBe("DONE");
    expect(turn.message).not.toContain("어떤 문의");
    expect(turn.message).toContain("지금 보고 있는 문의 기준으로 계속하겠습니다.");
    expect(artifact(turn, "SUMMARY")).toBeTruthy();
    expect(turn.suggestedActions.map((s) => s.label)).toContain("답변 준비해줘");
    expect(turn.continuation.workingSet?.selectedInquiry).toBeTruthy();
  });

  it("without an anchor the same clarification is put to the seller, in the closed form", async () => {
    const h = harness({ plansByGoal: PLANS });
    const { turn } = await ask(h, WHICH_ASK);
    expect(turn.message).toBe("어떤 문의를 확인할지 알려주세요. 방금 본 목록에서 「첫 번째 거」처럼 말씀해 주시면 됩니다.");
  });
});

describe("§2 — NO_ANSWER_BASIS: what is missing, one next step, said once", () => {
  it("the message is the gap + the step; the step's title is the button; no 「초안이 준비돼 있습니다」 beside it", async () => {
    const seeds = inquiries().map((s) => s.workItemId === W_SHIP
      ? { ...s, draftGeneration: { answerBasis: "NO_ANSWER_BASIS", answerBasisNote: "'배송' 관련 내용이 없습니다.", answerBasisAction: "등록된 배송 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다." } } : s);
    const h = harness({ plansByGoal: PLANS }, seeds);
    const { turn } = await ask(h, DRAFT_ASK, { workItemId: W_SHIP });
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(turn.message).toBe("'배송' 관련 내용이 없습니다. 등록된 배송 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다.");
    expect(turn.message).not.toContain("초안이 준비돼 있습니다");
    expect(turn.message.split("답변 기준이 필요합니다").length - 1).toBeLessThanOrEqual(1);
    const step = artifact(turn, "HUMAN_ACTION_REQUIRED");
    expect(step).toMatchObject({ actionType: "KNOWLEDGE_ENTRY", title: "답변 기준 추가", to: "/inquiries/inq-ship" });
    expect(artifact(turn, "DRAFT").answerBasisAction).toBe("등록된 배송 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다.");
    expect(h.inquiry.calls.generate).toBe(1);
  });
});

describe("§3 — the company profile is referred to, not read back", () => {
  it("a question that only considers the company says 「참고했습니다」 and never the summary", async () => {
    const h = harness({ plansByGoal: PLANS, sellerProfile: PROFILE });
    const { turn } = await ask(h, PROFILE_HINT_ASK);
    expect(turn.status).toBe("DONE");
    expect(turn.message).toContain("등록된 회사 정보를 참고했습니다.");
    expect(turn.message).not.toContain(SUMMARY);
    expect(h.operator.calls.sellerProfile).toBe(1);
  });

  it("asking for the introduction itself reads it back — once", async () => {
    const h = harness({ plansByGoal: PLANS, sellerProfile: PROFILE });
    const { turn } = await ask(h, PROFILE_INTRO_ASK);
    expect(turn.message).toContain(SUMMARY);
    expect(turn.message.split(SUMMARY).length - 1).toBe(1);
    expect(sellerSentence(`회사 정보에는 이렇게 등록돼 있습니다: "${SUMMARY}"`, "회사 소개 뭐야")).toContain(SUMMARY);
    expect(sellerSentence(`회사 정보에는 이렇게 등록돼 있습니다: "${SUMMARY}"`, "배송 문의 답변")).toBe("등록된 회사 정보를 참고했습니다.");
    expect(sellerSentence("근거 CUSTOMER_MEMORY 3건", "x")).toBeNull();
  });
});

describe("§6 — one limit is said once", () => {
  it("the resolver's and the scope gate's 「찾지 못했습니다」 about the same product collapse to the first", () => {
    expect(dedupeNear([
      "어떤 문의의 답변을 준비할지 알려주세요.",
      "\"이 상품\"에 해당하는 상품을 찾지 못했습니다.",
      "「이 상품」에 해당하는 상품을 찾지 못해, 상품 단위로 확인할 수 있는 근거가 없습니다.",
      "어떤 문의의 답변을 준비할지 알려주세요.",
    ])).toEqual(["어떤 문의의 답변을 준비할지 알려주세요.", "\"이 상품\"에 해당하는 상품을 찾지 못했습니다."]);
  });
});

describe("§7 — the product headline says what happened", () => {
  it("a product knowledge miss with no review set never says 「방금 본 리뷰를 …묶었습니다」", async () => {
    const h = harness({ plansByGoal: PLANS, productKnowledgeSearch: { [MOLDING.id]: knowledge("NO_RELEVANT_EVIDENCE") } });
    const { turn } = await ask(h, DOC_ASK);
    expect(turn.status).toBe("DONE");
    expect(turn.message).not.toContain("방금 본 리뷰");
    expect(turn.message).toContain("등록된 상품 정보(3건)에서 이 질문에 맞는 근거를 찾지 못했습니다.");
    expect(artifact(turn, "PRODUCT_LIST").items).toHaveLength(1);
  });
});

describe("§1 — no internal terminology reaches the seller", () => {
  const cases: Array<[string, Parameters<typeof harness>[0]]> = [
    [POLICY_ASK, { plansByGoal: PLANS, orgKnowledgeSearch: policy("NOT_APPLICABLE", 2) }],
    [POLICY_ASK, { plansByGoal: PLANS, orgKnowledgeSearch: policy("ABSENT", 0) }],
    [DOC_ASK, { plansByGoal: PLANS, productKnowledgeSearch: { [MOLDING.id]: knowledge("NOT_APPLICABLE") } }],
    [PROFILE_HINT_ASK, { plansByGoal: PLANS, sellerProfile: PROFILE }],
    [ROWS_ASK, { plansByGoal: PLANS }],
    [RAW_REFUSE, { plansByGoal: PLANS }],
    ["오늘 새 리뷰 보여줘", { plansByGoal: PLANS }],
    ["지난주보다 왜 매출이 떨어졌어?", { plansByGoal: PLANS }],
  ];
  for (const [text, seed] of cases) {
    it(`「${text}」 — message, artifacts, evidence labels and chips carry no kind token, stamp, path or product name`, async () => {
      const h = harness(seed);
      const { turn } = await ask(h, text);
      for (const s of sellerFacing(turn)) {
        expect(s, s).not.toMatch(INTERNAL_TOKEN);
        expect(s, s).not.toMatch(/이렇게 적혀 있습니다|갖고 있지 않습니다/);
      }
      const evidence = turn.artifacts.find((a) => a.type === "EVIDENCE");
      if (evidence && evidence.type === "EVIDENCE") {
        for (const item of evidence.items) expect(isSellerSafeLabel(item.label), item.label).toBe(true);
      }
    });
  }

  it("an evidence row whose locator label is a token falls back to the source word", async () => {
    const h = harness({ plansByGoal: PLANS });
    const { turn } = await ask(h, "케이블타이 폭이 몇 mm인가요?");
    const evidence = turn.artifacts.find((a) => a.type === "EVIDENCE");
    expect(evidence?.type).toBe("EVIDENCE");
    if (evidence?.type === "EVIDENCE") {
      expect(evidence.items.some((i) => i.label === "상품 정보")).toBe(true);
      expect(evidence.items.every((i) => !/[|:]/.test(i.label))).toBe(true);
    }
  });
});
