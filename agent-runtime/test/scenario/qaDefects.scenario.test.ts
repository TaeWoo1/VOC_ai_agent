/**
 * <b>The manual-QA defects, as conversations.</b>
 *
 * Agent Semantic Ownership v1 §6. Every scenario below is a symptom someone actually read on screen —
 * in this session's manual pilot QA or in the live sittings the packages before it recorded — stated in
 * the world it appeared in. They are here because a defect that only ever existed as a paragraph in a
 * document comes back; one that exists as a `never` does not.
 *
 * Most of what these assert is `never`. That is not a stylistic choice: almost every one of these
 * defects was a sentence that should not have been said — 「지금 먼저 하실 일은 없습니다」 to a shop with
 * no channels, a capability card printed twice, a set that silently kept the previous question's
 * channel, a notice about reply drafts on a request that had nothing to do with replies.
 *
 * <b>CI calls no vendor</b>: every plan is replayed from `SCENARIO_PLANS`, and the deterministic lanes
 * assert `llmCalls: 0` precisely because they must not reach one.
 */
import { describe } from "vitest";
import { scenario } from "./scenario";

/** The absence claim this whole line of work started from. It is true in exactly one world. */
const NO_WORK = "지금 먼저 하실 일은 없습니다";
/** The graph's retired capability notice — manufactured from a word list (§5). */
const DRAFT_NOTICE = "답변 초안 작성은 이 대화 창구에서 하지 않습니다";
/** How an answer says it stayed inside the previous set. Wrong on a NEW question of the org. */
const REFINED = "방금 본";

describe("first contact — a shop with nothing connected", () => {
  // Manual QA defect #1, turn 3 (2026-09-05): the seller had connected nothing and was told there was
  // nothing to do, under two zeroes that were reads that never happened.
  scenario("an empty answer over an unconnected org says why, and never reports zeros as facts", {
    world: "NO_CHANNEL",
    turns: [
      { say: "내가 해야 할 일 정리해줘", expect: {
        status: "DONE",
        says: ["아직 연결된 판매 채널이 없어서"],
        never: [NO_WORK, "0건"],
        artifacts: ["CHECKLIST"],
        noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "EVIDENCE"],
        link: "/connect",
      } },
    ],
  });

  // The same sentence, one world over: the collection HAS run and returned nothing, or has not run yet.
  // Neither is 「할 일이 없다」, and neither is the connect step.
  scenario("a shop connected this morning is told its collection state, not that it has no work", {
    world: "CONNECTED_NO_DATA",
    turns: [
      { say: "내가 해야 할 일 정리해줘", expect: {
        status: "DONE",
        never: [NO_WORK],
        says: ["연결은 끝났고"],
      } },
    ],
  });

  // Manual QA defect #1, turns 1→2: two different questions, one answer printed twice.
  scenario("the second capability question is answered with the next step, not the same card", {
    world: "NO_CHANNEL",
    turns: [
      { say: "이 서비스를 통해 할 수 있는 일이 뭐야?", expect: {
        artifacts: ["SUMMARY"], says: ["판매 채널을 연결하시면"], link: "/connect",
      } },
      { say: "아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?", expect: {
        differsFrom: 0, says: ["시작하는 방법"],
        // The local helper belongs to one channel's guided lanes. A seller who has not chosen a channel
        // is not asked to install anything.
        never: ["도우미"],
      } },
    ],
  });
});

describe("a working shop — the CTA and the card that should not appear", () => {
  // Live browser QA, 2026-09-05: the capability card was printed in full a second time to a seller with
  // three channels connected. Said once is a fact about the ANSWER, not about the world it was said in.
  scenario("a connected seller hears the capability answer once, and is never sent to /connect", {
    world: "WORKING",
    turns: [
      { say: "너는 어떤 일을 도와줄 수 있어?", expect: { artifacts: ["SUMMARY"], noLink: "/connect" } },
      { say: "이 서비스를 통해 할 수 있는 일이 뭐야?", expect: {
        differsFrom: 0, noLink: "/connect", never: ["판매 채널을 연결하시면"],
      } },
    ],
  });

  // Live browser QA, 2026-09-05: 「지금 먼저 하실 일은 없습니다」 sat directly above 「답변이 필요한
  // 문의가 24건 있습니다」. A turn that FOUND work may not claim there is none.
  scenario("a turn that found work never claims there is none", {
    world: "WORKING",
    turns: [
      { say: "내가 해야 할 일 정리해줘", expect: { status: "DONE", never: [NO_WORK], noLink: "/connect" } },
    ],
  });
});

describe("scope — what a new question inherits, and what it must not", () => {
  // Conversation Core v1 §9, reproduced live: a narrowed set followed by a NEW question of the org came
  // back as 「방금 본 문의 중 …」 — the previous question's axes riding into a read that never used them.
  scenario("a new list of the org does not inherit the previous set's frame", {
    world: "WORKING",
    turns: [
      { say: "오늘 내가 답해야 할 문의 정리해줘", expect: { status: "DONE" } },
      { say: "배송 관련부터", expect: { status: "DONE" } },
      { say: "답변 안 한 문의 보여줘", expect: { status: "DONE", never: [REFINED] } },
    ],
  });

  // Conversation Contract Correctness v2 §E: a demonstrative with nothing to point at authorises no
  // investigation. It used to spend three to nine seconds reading the org's queues before asking back.
  scenario("a pronoun with no referent asks back and buys nothing", {
    world: "WORKING",
    turns: [
      { say: "그거 어떻게 처리하지?", expect: { status: "DONE", llmCalls: 0, noArtifacts: ["INQUIRY_LIST", "CHECKLIST"] } },
    ],
  });

  // Agent Interaction Model v2: a refine over the visible set stays on it, and costs no planner call.
  scenario("a refine of the rows on screen stays on them", {
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"] } },
      { say: "안 좋은 것만 봐줘", expect: { status: "DONE", noLink: "/connect" } },
    ],
  });
});

describe("meaning the plan owns — the three this package took back", () => {
  // §5. 「써줘」 was on a word list the graph consulted whenever the plan said `NONE`; the planner reads
  // this sentence as a request for product copy, and it is not about replies at all.
  scenario("a request that merely contains 「써줘」 is not answered with the reply-draft notice", {
    world: "WORKING",
    turns: [
      { say: "제품 설명 문구 써줘", expect: { status: "DONE", never: [DRAFT_NOTICE] } },
    ],
  });

  // §4. The axis is settled once in the graph and read back off the answer. If the composer settled it
  // again, this pair is where the two settlements could disagree — the rows come from the first, the
  // sentence about them from the second.
  scenario("the sentence about a set and the set itself are scoped by one decision", {
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"] } },
      { say: "카페24만 봐봐", expect: { status: "DONE", never: ["네이버"] } },
    ],
  });
});

describe("what is refused, and what is not invented", () => {
  // Response Hygiene v1: an unsupported sentence is refused in the product's own words, with nothing
  // drawn beside it — a refusal that also prints a list is a refusal the seller will not believe.
  scenario("an off-topic sentence is refused without an answer-shaped artifact beside it", {
    world: "WORKING",
    turns: [
      { say: "점심 메뉴 추천해줘", expect: {
        // A refusal IS a terminal state, and saying so here is what distinguishes it from a sentence
        // nobody recorded a plan for.
        status: "FAILED",
        noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "CHECKLIST", "DRAFT"],
        never: [NO_WORK, DRAFT_NOTICE],
      } },
    ],
  });

  // Agent Object v1 §1-C: an ordinal over the visible set is a click, answered by the object with no
  // planner call. The regression it guards is the list being printed a second time instead.
  scenario("an ordinal over the visible set opens that object and calls no model", {
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"] } },
      { say: "두 번째 거 자세히 보여줘", expect: {
        llmCalls: 0, artifacts: ["REVIEW_DETAIL"], noArtifacts: ["REVIEW_LIST"],
      } },
    ],
  });
});
