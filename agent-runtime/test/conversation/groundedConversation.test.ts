/**
 * <b>Grounded Conversation Lane v1 — the lane, its grounding, and its fallback.</b>
 *
 * The defect this closes is structural rather than verbal: a product question is answered by whichever
 * of five composed answers its {@code capabilityAspect} names, so a SIXTH question — 「너랑 사방넷이랑
 * 뭐가 달라?」, 「내가 매일 여기 들어와야 돼?」, 「세 군데 다 연결하면 같은 문의가 중복으로 보여?」 — has
 * no answer that is about it, and the only way to give it one was a sixth token and a sixth composer.
 *
 * So the assertions below are about the SHAPE of the lane, never about a sentence a model wrote:
 * which facts it is grounded on, what it refuses to send, and — the load-bearing one — that every way
 * it can fail lands on the answer that shipped before it existed.
 */
import { describe, expect, it } from "vitest";
import { TOKEN, harness, say } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS, SCENARIO_PLANS, capabilityPlan } from "../support/recordedPlans";
import { checkGroundedAnswer, MAX_ANSWER_CHARS } from "../../src/conversation/groundedAnswer";
import { productFactSheet, STRUCTURAL_FACTS } from "../../src/operator/capability/ProductFactSheet";
import { envelopeTokens } from "../../src/conversation/ContextEnvelope";
import type { AgentConverseView } from "../../src/spring/types";

const PLANS = { ...RECORDED_PLANS, ...CONVERSATION_PLANS, ...SCENARIO_PLANS };

/** The eight sentences pilot QA put to a clean seller. None of them is one of the five aspects. */
const COMPARISON = "너랑 사방넷 같은 솔루션이랑 뭐가 달라?";
const DUPLICATES = "세 군데 다 연결하면 같은 문의가 중복으로 보일 수도 있어?";
const CANNOT = "너 지금 할 수 없는 건 뭔데?";

const QA_PLANS = {
  [COMPARISON]: capabilityPlan("제품 비교", "PRODUCT_OVERVIEW", null),
  [DUPLICATES]: capabilityPlan("중복 수집 여부", "AFTER_CONNECT", null),
  [CANNOT]: capabilityPlan("할 수 없는 일", "PRODUCT_OVERVIEW", null),
};

const answered = (answer: string): AgentConverseView =>
  ({ available: true, answer, providerVersion: "agent-converse/v1+test" });

function lane(converse: AgentConverseView) {
  return harness({ plansByGoal: { ...PLANS, ...QA_PLANS }, converse });
}

describe("a product question is answered by the question's own answer", () => {
  it("a sentence no aspect covers gets a grounded answer, and no capability card", async () => {
    const h = lane(answered("사방넷 같은 서비스는 제가 정확히 알지 못합니다. 제가 하는 일은 문의와 리뷰를 대신 확인하고 답변 초안까지 준비해 두는 것입니다."));
    const { conversationId: id } = await h.service.create(TOKEN);

    const { turn } = await say(h, id, COMPARISON);

    expect(turn.message).toContain("정확히 알지 못합니다");
    // The composed card is what this lane replaces: prose, and nothing document-shaped beside it.
    expect(turn.artifacts.filter((a) => a.type === "SUMMARY")).toHaveLength(0);
    expect(h.operator.calls.converse).toBe(1);
  });

  it("the question that reaches the model is the seller's own sentence, unedited", async () => {
    const h = lane(answered("채널마다 원본 글 단위로 저장하기 때문에 같은 글이 두 번 세어지지 않습니다."));
    const { conversationId: id } = await h.service.create(TOKEN);

    await say(h, id, DUPLICATES);

    expect(h.operator.converseRequests[0]!.question).toBe(DUPLICATES);
  });

  it("the second product question is answered too — the said-once rule does not stand in for an answer", async () => {
    // The rule this replaces keyed 「a fact is said once」 to the ASPECT, so a second question that the
    // planner reads as the same aspect came back as the shortened repeat whatever it had asked.
    const h = harness({
      plansByGoal: { ...PLANS, ...QA_PLANS },
      converseByQuestion: {
        [CANNOT]: answered("채널에 직접 보내는 일은 판매자님 확인 전에는 하지 않습니다."),
        [COMPARISON]: answered("다른 서비스는 제가 알지 못합니다."),
      },
    });
    const { conversationId: id } = await h.service.create(TOKEN);

    const first = await say(h, id, CANNOT);
    const second = await say(h, id, COMPARISON);

    expect(first.turn.message).not.toEqual(second.turn.message);
    expect(second.turn.message).toContain("알지 못합니다");
    // …and the model was told what had already been said, so it can avoid repeating it itself.
    expect(h.operator.converseRequests[1]!.recentTurns.join("\n")).toContain("판매자님 확인 전에는");
  });
});

describe("what the lane is grounded on", () => {
  it("the facts are this deployment's own — channels, per-channel verdicts, and the boundary", async () => {
    const h = lane(answered("네이버 · 쿠팡 · 카페24를 연결하실 수 있습니다."));
    const { conversationId: id } = await h.service.create(TOKEN);

    await say(h, id, "지원하는 이커머스 종류가 뭐가 있지?");

    const facts = h.operator.converseRequests[0]!.facts.join("\n");
    expect(facts).toContain("카페24");
    expect(facts).toContain("리뷰 가져오기");
    expect(facts).toContain("확인하신 뒤에");
    for (const structural of STRUCTURAL_FACTS) expect(facts).toContain(structural);
  });

  it("the envelope travels as closed tokens — no id, no name, no customer sentence", async () => {
    const h = lane(answered("문의와 리뷰를 확인해 드립니다."));
    const { conversationId: id } = await h.service.create(TOKEN);

    await say(h, id, COMPARISON);

    for (const line of h.operator.converseRequests[0]!.context) {
      for (const token of line.trim().split(/\s+/)) {
        expect(token, line).toMatch(/^[A-Za-z0-9_-]+=[A-Za-z0-9_:.,%|/+-]*$/);
      }
    }
  });

  it("a sentence that named a channel narrows the facts to that channel", async () => {
    const h = lane(answered("쿠팡은 리뷰 답글을 외부에서 보낼 수 있는 길이 없습니다."));
    const { conversationId: id } = await h.service.create(TOKEN);

    await say(h, id, "쿠팡은 어디까지 가능해?");

    const perChannel = h.operator.converseRequests[0]!.facts.filter((f) => f.includes("가져오기 —") || f.includes("보내기 —"));
    expect(perChannel.length).toBeGreaterThan(0);
    expect(perChannel.every((f) => f.startsWith("쿠팡"))).toBe(true);
  });

  it("the sheet says what is NOT done from the same list that says what is", () => {
    const sheet = productFactSheet({
      registeredTools: [], actionClasses: ["READ"],
      readiness: { kind: "NO_CHANNEL", connected: [], connectable: ["네이버"], delegable: [] },
      coverage: null,
    }, []);
    // No registered tool ⇒ no domain claimed, and therefore no 「이 목록에 없는」 sentence promising one.
    expect(sheet.some((f) => f.includes("이 목록에 없는"))).toBe(false);
  });
});

describe("every way this lane fails lands on the answer that shipped before it", () => {
  const deterministic = async () => {
    const h = harness({ plansByGoal: { ...PLANS, ...QA_PLANS } });
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, "지원하는 이커머스 종류가 뭐가 있지?");
    return turn;
  };

  it("no converse seam at all — the composed answer, unchanged", async () => {
    const turn = await deterministic();
    expect(turn.message).toContain("지원합니다");
    expect(turn.artifacts.some((a) => a.type === "SUMMARY")).toBe(true);
  });

  it("the capability is off for this org", async () => {
    const h = lane({ available: false, answer: null, providerVersion: null });
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, "지원하는 이커머스 종류가 뭐가 있지?");
    expect(turn.message).toEqual((await deterministic()).message);
  });

  it("the model printed one of our internal words", async () => {
    const h = lane(answered("쿠팡 리뷰 답글은 NOT_SUPPORTED 입니다."));
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, "지원하는 이커머스 종류가 뭐가 있지?");
    expect(turn.message).toEqual((await deterministic()).message);
  });

  it("the guard names the four shapes it refuses, and nothing else", () => {
    expect(checkGroundedAnswer("문의와 리뷰를 확인해 드립니다.").ok).toBe(true);
    expect(checkGroundedAnswer("").reason).toBe("EMPTY");
    expect(checkGroundedAnswer("가".repeat(MAX_ANSWER_CHARS + 1)).reason).toBe("TOO_LONG");
    expect(checkGroundedAnswer("결과는 API_EXECUTION 입니다").reason).toBe("INTERNAL_WORD");
    expect(checkGroundedAnswer("get_channel_coverage 를 읽었습니다").reason).toBe("INTERNAL_WORD");
    expect(checkGroundedAnswer("## 제목\n내용").reason).toBe("DOCUMENT_SHAPE");
    // …and it does not refuse ordinary business loanwords, which would make it fire on real answers.
    expect(checkGroundedAnswer("AI가 초안을 준비합니다. API 연동은 채널이 제공합니다.").ok).toBe(true);
  });
});

describe("the lane is READ only", () => {
  it("its modules name no writer, no approval and no channel call", async () => {
    const { readFileSync } = await import("node:fs");
    // Names of CALLS, not of nouns: the envelope legitimately carries the closed token `APPROVAL`,
    // which is how a grounded answer can SAY that a draft is waiting for the seller without being able
    // to give that confirmation. What must not appear is a way to reach a writer.
    const forbidden = new RegExp([
      "confirmInquiryPublish", "approveReply", "approveReviewReply", "createOrgKnowledge",
      "createProductKnowledgeSource", "generateDraftFor", "putReviewDraft", "putDraft",
      "\\.\\s*(?:publish|approve|execute)\\s*\\(",
    ].join("|"));
    for (const file of [
      "src/conversation/ContextEnvelope.ts",
      "src/conversation/groundedAnswer.ts",
      "src/operator/capability/ProductFactSheet.ts",
    ]) {
      const code = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(forbidden.test(code), file).toBe(false);
    }
  });

  it("a grounded turn writes no draft and stands up no approval", async () => {
    const h = lane(answered("문의와 리뷰를 확인해 드립니다."));
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, COMPARISON);
    expect(turn.artifacts.map((a) => a.type)).not.toContain("DRAFT");
    expect(turn.artifacts.map((a) => a.type)).not.toContain("APPROVAL_REQUIRED");
    expect(turn.continuation.pendingPrepared).toBeNull();
  });
});

describe("the envelope's own shape", () => {
  it("names where the conversation stands without naming which object", () => {
    const tokens = envelopeTokens({
      conversationId: "c-1", surface: "REVIEWS", readiness: "WORKING",
      focus: { kind: "REVIEW", id: "rev-secret", productId: "p-secret", channelCode: "NAVER" },
      workingSet: { kind: "REVIEWS", count: 12, shown: 3 },
      activeProcedure: { id: "ANSWER_REVIEW", version: "v1" }, activeTask: "PREPARE_REPLY",
      awaiting: "DRAFT_REVIEW", recentTurns: [],
    });
    const joined = tokens.join("\n");
    expect(joined).toContain("focus=REVIEW");
    expect(joined).toContain("awaiting=DRAFT_REVIEW");
    expect(joined).not.toContain("rev-secret");
    expect(joined).not.toContain("p-secret");
  });
});
