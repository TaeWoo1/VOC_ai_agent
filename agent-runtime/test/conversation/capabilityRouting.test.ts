/**
 * <b>Who owns a product question when something else is already on the table.</b>
 *
 * Manual QA (2026-09-08) ran fourteen product questions down one thread and most of them never reached
 * the lane built to answer them. Two different owners had taken them, and neither is a wording problem:
 *
 * <ul>
 *   <li><b>The working set took them.</b> `explainCapability` sent a capability question to the
 *       per-OBJECT lane whenever a list happened to be on screen, and lent it that list's channel. So
 *       after any turn that drew reviews, 「네이버 문의는 다 가져와?」 was answered about the reviews and
 *       「판매자센터랑 뭐가 달라?」 came back as 「쿠팡에서는 판매자가 리뷰에 직접 답글을…」.</li>
 *   <li><b>The freshness lane took them.</b> 「쿠팡 리뷰에도 답글 달아줄 수 있어?」 names reviews and ends
 *       in an existence cue, so a lane that answers 「오늘 리뷰 있어?」 answered it with a row count in
 *       40ms — without the planner ever seeing the sentence.</li>
 * </ul>
 *
 * <p>Both fixes are about OWNERSHIP, not about words: the plan's own target selector says whether the
 * seller pointed at a row, and the ability/experience constructions are excluded by the pre-planner
 * lane's own list of "different question about the same rows". These tests pin the ownership.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOKEN, harness, say } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS, SCENARIO_PLANS, capabilityPlan } from "../support/recordedPlans";
import { freshnessQuestionOf } from "../../src/conversation/freshnessQuestion";
import type { CanonicalProductTruth } from "../../src/spring/types";

const LEDGER: CanonicalProductTruth = JSON.parse(
  readFileSync(resolve(__dirname, "../../../contracts/product-truth/v1/ledger.json"), "utf8"),
);

const REVIEWS_ASK = "오늘 새로 달린 리뷰 보여줘";
const NAVER_ASK = "네이버 문의는 다 가져와?";
const DIFFERENCE_ASK = "판매자센터랑 뭐가 달라?";
const FUTURE_ASK = "앞으로 뭐 할 거야?";

/** The four sentences of the manual-QA thread, with the plans the live planner produced for them. */
const THREAD_PLANS = {
  ...RECORDED_PLANS, ...CONVERSATION_PLANS, ...SCENARIO_PLANS,
  [NAVER_ASK]: capabilityPlan("네이버 문의 수집 범위", "CHANNEL_ACTION", "NAVER"),
  [DIFFERENCE_ASK]: capabilityPlan("판매자센터와의 차이", "PRODUCT_DIFFERENCE", null),
  [FUTURE_ASK]: capabilityPlan("앞으로의 방향", "FUTURE_DIRECTION", null),
};

function threadHarness() {
  return harness({
    plansByGoal: THREAD_PLANS,
    productTruth: LEDGER,
    // Answered, so the assertions are about which facts REACHED the model rather than about prose.
    converse: { available: true, answer: "제품 사실에서 답했습니다.", providerVersion: "t" },
  });
}

describe("a capability question is not taken by what is still on the table", () => {
  /**
   * The exact manual-QA sequence. Each product question must be answered from the reviewed ledger, and
   * the review list drawn first must not decide which channel or which object they are about.
   */
  it("reviews, then three product questions, and each one is answered from the ledger", async () => {
    const h = threadHarness();
    const { conversationId: id } = await h.service.create(TOKEN);

    const list = await say(h, id, REVIEWS_ASK);
    // Precondition: the thread really is holding a set — without it this test proves nothing.
    expect(list.turn.artifacts.some((a) => a.type === "REVIEW_LIST")).toBe(true);

    const before = h.operator.converseRequests.length;
    await say(h, id, NAVER_ASK);
    await say(h, id, DIFFERENCE_ASK);
    await say(h, id, FUTURE_ASK);

    const sent = h.operator.converseRequests.slice(before);
    expect(sent, "세 질문 모두 grounded lane 으로 가야 합니다").toHaveLength(3);

    const [naver, difference, future] = sent.map((r) => r.facts.join("\n"));
    // The NAVER question is about NAVER's inquiries — not about the reviews still on screen, and not
    // about the channel those reviews belonged to.
    expect(naver).toContain("네이버 문의 가져오기");
    expect(naver).toContain("톡톡");
    expect(naver).not.toContain("카페24 리뷰");
    // The difference question stands on the narrative written for it, with no channel grid.
    expect(difference).toContain("판매자센터는 채널마다");
    expect(difference).not.toContain("카페24 리뷰 가져오기");
    // The future question carries the hedge and the roadmap.
    expect(future).toContain("앞으로의 방향(현재 제공되는 기능이 아닙니다)");
  });

  /**
   * The per-object lane still exists and is still reachable — it is the answer to 「이 건은 왜 답변 못
   * 해?」. What changed is the signal: the seller has to have POINTED at a row, which the plan reports
   * in its target selector. Removing the lane would have been the other way to break this.
   */
  it("a question that points at a row still gets that row's verdict", async () => {
    const POINTED = "이 건은 왜 답변 못 해?";
    const plan = {
      ...capabilityPlan("이 리뷰의 답변 가능 여부", "CHANNEL_ACTION", "COUPANG"),
      target: { selector: "FIRST", index: null },
    };
    const h = harness({
      plansByGoal: { ...THREAD_PLANS, [POINTED]: plan as never },
      productTruth: LEDGER,
      converse: { available: true, answer: "…", providerVersion: "t" },
    });
    const { conversationId: id } = await h.service.create(TOKEN);
    await say(h, id, REVIEWS_ASK);

    const before = h.operator.converseRequests.length;
    const turn = await say(h, id, POINTED);

    // The per-object lane composes its own sentence and does not go through the grounded lane.
    expect(h.operator.converseRequests.length).toBe(before);
    expect(turn.turn.message.length).toBeGreaterThan(0);
  });
});

describe("a product question the reviewed facts cannot answer says so", () => {
  const ASK = "직원이랑 같이 써도 돼?";
  const PLANS = { ...THREAD_PLANS, [ASK]: capabilityPlan("여러 사용자 이용 가능 여부", "PRODUCT_OVERVIEW", null) };

  /**
   * The model read the whole selected sheet and declined. That is a fact about the product's knowledge
   * and it is what the seller is told — not a summary of what the product does, which is what they
   * used to get and could easily read as an answer.
   */
  it("answers with the bounded gap sentence when the model finds no basis", async () => {
    const h = harness({
      plansByGoal: PLANS,
      productTruth: LEDGER,
      converse: { available: false, answer: null, providerVersion: "t", reason: "NO_BASIS" },
    });
    const { conversationId: id } = await h.service.create(TOKEN);
    const { turn } = await say(h, id, ASK);

    expect(turn.message).toBe("현재 확인된 제품 정보만으로는 이 질문에 정확히 답할 수 없습니다.");
    // It states the limit and stops: no invented capability, no guessed next step, no summary card.
    expect(turn.artifacts).toHaveLength(0);
  });

  /**
   * Every OTHER failure keeps the composer. A capability that is off has said nothing about the
   * product, and telling a seller 「정확히 답할 수 없습니다」 because of a deployment switch would be
   * this lane inventing a limit the ledger does not have.
   */
  it("keeps the old answer when the lane was not really asked", async () => {
    for (const reason of ["NOT_ENABLED", "REQUEST_REFUSED", "UNAVAILABLE"]) {
      const h = harness({
        plansByGoal: PLANS,
        productTruth: LEDGER,
        converse: { available: false, answer: null, providerVersion: "t", reason },
      });
      const { conversationId: id } = await h.service.create(TOKEN);
      const { turn } = await say(h, id, ASK);
      expect(turn.message, reason).not.toContain("정확히 답할 수 없습니다");
      expect(turn.message.length, reason).toBeGreaterThan(0);
    }
  });
});

describe("the pre-planner review lane owns row questions, not product questions", () => {
  /** What it still owns — unchanged, and the reason it exists. */
  it("still answers the existence and state questions it was built for", () => {
    expect(freshnessQuestionOf("오늘 리뷰 있어?")).not.toBeNull();
    expect(freshnessQuestionOf("네이버 리뷰 최신이야?")).not.toBeNull();
    expect(freshnessQuestionOf("새 후기 들어왔나?")).not.toBeNull();
    expect(freshnessQuestionOf("리뷰 몇 건 있어?")).not.toBeNull();
  });

  /**
   * What it must not own. Both sentences name reviews and end in an existence cue, and both ask about
   * the PRODUCT — one about ability, one about whether it has ever happened. Answering either with a
   * row count is answering a question about the seller's store.
   */
  it("lets ability and experience questions through to the planner", () => {
    expect(freshnessQuestionOf("쿠팡 리뷰에도 답글 달아줄 수 있어?")).toBeNull();
    expect(freshnessQuestionOf("카페24 리뷰에 답글 실제로 보낸 적 있어?")).toBeNull();
    expect(freshnessQuestionOf("리뷰 답글 자동으로 보낼 수 있어?")).toBeNull();
    expect(freshnessQuestionOf("리뷰 가져오는 거 가능해?")).toBeNull();
  });
});
