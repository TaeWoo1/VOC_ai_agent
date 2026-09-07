/**
 * <b>The scenario eval's conversations, as data.</b>
 *
 * Planner Model & Prompt Benchmark v1 §2. Until this file the conversations lived inside the three
 * `*.scenario.test.ts` files, which meant they could only ever be run one way — replayed from
 * {@code SCENARIO_PLANS}, which is exactly right for CI and useless for measuring a planner. A
 * benchmark that restated them somewhere else would be grading a second copy that drifts.
 *
 * So the cases are stated once here and consumed twice: the test files run them against recorded
 * plans (CI calls no vendor), and {@code bench/} runs the same turns with the plan coming live from
 * whichever model an arm names. <b>The expectations do not change between the two</b> — that is the
 * whole point. A model is scored by whether the product's own assertions hold.
 *
 * Nothing about the format moved; see {@link ./scenario.ts} for `world`, `never` and the runner.
 */
import type { Scenario } from "./scenario";

export interface NamedScenario extends Scenario {
  readonly name: string;
}

/* ────────────────────────────── shared sentences and forbidden strings ───────────────────────── */

export const ASK_CAPABILITY = "이 서비스를 통해 할 수 있는 일이 뭐야?";
export const ASK_START = "아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?";
export const ASK_WHAT_FIRST = "뭐부터 하면 되냐고";

/** 「없습니다」 said about rows that could not exist — the sentence this whole layer was built for. */
export const ABSENCE_LIE = "지금 먼저 하실 일은 없습니다";
/** The graph's retired capability notice — manufactured from a word list (Semantic Ownership §5). */
export const DRAFT_NOTICE = "답변 초안 작성은 이 대화 창구에서 하지 않습니다";
/** How an answer says it stayed inside the previous set. Wrong on a NEW question of the org. */
export const REFINED = "방금 본";

/* ─────────────────────────────────────── first use ───────────────────────────────────────────── */

/**
 * <b>The product owner's three sentences, asked of two different shops.</b>
 *
 * Agent Procedure Layer v1 §4. These are the exact turns measured live on 2026-09-05, in order, and
 * the whole reason the scenario format exists: before it, the clean-organisation defect and the
 * working-organisation regression could not be expressed as one thing asked twice.
 *
 * The four minimum guarantees, one `never` each:
 *   1. NO_CHANNEL never hears 「지금 먼저 하실 일은 없습니다」.
 *   2. A follow-up never repeats the capability card.
 *   3. A WORKING seller is never offered the connect step.
 *   4. Neither world is told about rows the other one has.
 */
export const FIRST_USE_CASES: readonly NamedScenario[] = [
  {
    name: "a seller who has connected nothing is told what to connect, not that there is nothing to do",
    world: "NO_CHANNEL",
    turns: [
      {
        say: ASK_CAPABILITY,
        expect: {
          artifacts: ["SUMMARY"], says: ["판매 채널을 연결하시면", "아직 연결된 판매 채널이 없어"],
          link: "/connect",
          // Every prompt this answer used to offer asks about rows this org cannot have.
          never: ["답변 안 한 문의 보여줘", "별점 낮은 리뷰 보여줘", "최근 7일 매출 알려줘"],
        },
      },
      {
        say: ASK_START,
        expect: {
          artifacts: ["SUMMARY"], says: ["판매 채널을 연결하는 것부터"], link: "/connect", differsFrom: 0,
          // §2 — the capability card is a fact, and a fact is said once. Also: the local 도우미 is not
          // put in front of a seller who has not chosen a channel yet.
          never: ["제가 도와드릴 수 있는 일", "도우미"],
        },
      },
      {
        say: ASK_WHAT_FIRST,
        expect: {
          status: "DONE", artifacts: ["CHECKLIST"],
          // The zero cards go with the zero sentences.
          noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "EVIDENCE"],
          says: ["아직 연결된 판매 채널이 없어서", "판매 채널 연결하기"],
          never: [ABSENCE_LIE, "0건"],
        },
      },
    ],
  },
  {
    name: "a seller who has connected everything is answered from rows, and never offered the connect step",
    world: "WORKING",
    turns: [
      {
        say: ASK_CAPABILITY,
        expect: {
          artifacts: ["SUMMARY"], says: ["지금 연결된 채널은"],
          noLink: "/connect",
          never: ["아직 연결된 판매 채널이 없어", "판매 채널을 연결하시면"],
        },
      },
      {
        // §2 again, in the other world: a fact is said once whatever shop is asking. Measured live on
        // the Demo organisation (2026-09-06), this turn re-printed the whole card.
        say: ASK_START,
        expect: {
          noArtifacts: ["SUMMARY"], says: ["이미 연결돼 있습니다"], noLink: "/connect", differsFrom: 0,
          never: ["제가 도와드릴 수 있는 일", "판매 채널을 연결하는 것부터"],
        },
      },
      {
        say: ASK_WHAT_FIRST,
        expect: {
          status: "DONE", artifacts: ["CHECKLIST"], says: ["지금 하실 일을 정리했습니다"],
          noLink: "/connect",
          never: ["아직 연결된 판매 채널이 없어서", ABSENCE_LIE],
        },
      },
    ],
  },
  {
    name: "connected this morning and holding nothing yet — a third state, and it is not the other two",
    world: "CONNECTED_NO_DATA",
    turns: [
      {
        say: ASK_WHAT_FIRST,
        expect: {
          status: "DONE", says: ["연결은 끝났고, 아직 가져온 자료가 없습니다"],
          // Neither the absence lie nor the step they have already taken.
          never: [ABSENCE_LIE, "아직 연결된 판매 채널이 없어서"],
          noLink: "/connect",
        },
      },
    ],
  },
];

/* ────────────────────────────────────── exact objects ────────────────────────────────────────── */

/**
 * <b>The exact-object flows — the regression half of Agent Procedure Layer v1 §4.</b>
 *
 * The procedure layer moved three judgements (readiness, absence, draft precondition) into one place
 * each. These are the flows those judgements sit on the path of: a list, one row named by its
 * position, and the draft for that row; and the same for a review.
 *
 * Every turn but the first is answered by a DETERMINISTIC lane, which is what `llmCalls: 0` asserts:
 * selecting a row and preparing its draft cost no plan, before this package and after it.
 */
export const OBJECT_FLOW_CASES: readonly NamedScenario[] = [
  {
    name: "a list, the second row by position, and that row's draft",
    world: "WORKING",
    turns: [
      {
        say: "오늘 내가 답해야 할 문의 정리해줘",
        expect: { artifacts: ["INQUIRY_LIST"], noLink: "/connect", never: ["아직 연결된 판매 채널이 없어"] },
      },
      {
        // Naming a row by its position is the same act as pressing it — one card, no planner.
        say: "두 번째 거",
        expect: { artifacts: ["INQUIRY_DETAIL"], llmCalls: 0, never: ["방금 본 목록에는"] },
      },
      {
        // The ANSWER_INQUIRY precondition now lives in one place; the draft path it gates is unchanged.
        say: "답변 준비해줘",
        expect: { artifacts: ["DRAFT"], never: ["어떤 문의의 답변을 준비할지"] },
      },
      {
        say: "조금 더 부드럽게 써줘",
        expect: { artifacts: ["DRAFT"], llmCalls: 0, never: ["말투를 바꿀 초안을 찾지 못했습니다"] },
      },
    ],
  },
  {
    name: "a review list, one review inspected, and a channel that cannot take a reply",
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"], noLink: "/connect" } },
      {
        say: "첫 번째 거",
        // The exact single-review read — the lane that exists because the planner has no token for
        // «this object» (it expressed the sentence as review ROWS with limit 1).
        expect: { artifacts: ["REVIEW_DETAIL"], llmCalls: 0 },
      },
    ],
  },
];

/* ──────────────────────────────────── manual QA defects ──────────────────────────────────────── */

/**
 * <b>The manual-QA defects, as conversations.</b>
 *
 * Agent Semantic Ownership v1 §6. Every scenario below is a symptom someone actually read on screen —
 * in this session's manual pilot QA or in the live sittings the packages before it recorded — stated
 * in the world it appeared in. They are here because a defect that only ever existed as a paragraph
 * in a document comes back; one that exists as a `never` does not.
 *
 * Most of what these assert is `never`. That is not a stylistic choice: almost every one of these
 * defects was a sentence that should not have been said.
 */
export const QA_DEFECT_CASES: readonly NamedScenario[] = [
  // Manual QA defect #1, turn 3 (2026-09-05): the seller had connected nothing and was told there was
  // nothing to do, under two zeroes that were reads that never happened.
  {
    name: "an empty answer over an unconnected org says why, and never reports zeros as facts",
    world: "NO_CHANNEL",
    turns: [
      { say: "내가 해야 할 일 정리해줘", expect: {
        status: "DONE",
        says: ["아직 연결된 판매 채널이 없어서"],
        never: [ABSENCE_LIE, "0건"],
        artifacts: ["CHECKLIST"],
        noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "EVIDENCE"],
        link: "/connect",
      } },
    ],
  },
  // The same sentence, one world over: the collection HAS run and returned nothing, or has not run yet.
  // Neither is 「할 일이 없다」, and neither is the connect step.
  {
    name: "a shop connected this morning is told its collection state, not that it has no work",
    world: "CONNECTED_NO_DATA",
    turns: [
      { say: "내가 해야 할 일 정리해줘", expect: {
        status: "DONE", never: [ABSENCE_LIE], says: ["연결은 끝났고"],
      } },
    ],
  },
  // Manual QA defect #1, turns 1→2: two different questions, one answer printed twice.
  {
    name: "the second capability question is answered with the next step, not the same card",
    world: "NO_CHANNEL",
    turns: [
      { say: ASK_CAPABILITY, expect: {
        artifacts: ["SUMMARY"], says: ["판매 채널을 연결하시면"], link: "/connect",
      } },
      { say: ASK_START, expect: {
        differsFrom: 0, says: ["시작하는 방법"],
        // The local helper belongs to one channel's guided lanes. A seller who has not chosen a channel
        // is not asked to install anything.
        never: ["도우미"],
      } },
    ],
  },
  // Live browser QA, 2026-09-05: the capability card was printed in full a second time to a seller with
  // three channels connected. Said once is a fact about the ANSWER, not about the world it was said in.
  {
    name: "a connected seller hears the capability answer once, and is never sent to /connect",
    world: "WORKING",
    turns: [
      { say: "너는 어떤 일을 도와줄 수 있어?", expect: { artifacts: ["SUMMARY"], noLink: "/connect" } },
      { say: ASK_CAPABILITY, expect: {
        differsFrom: 0, noLink: "/connect", never: ["판매 채널을 연결하시면"],
      } },
    ],
  },
  // Live browser QA, 2026-09-05: 「지금 먼저 하실 일은 없습니다」 sat directly above 「답변이 필요한
  // 문의가 24건 있습니다」. A turn that FOUND work may not claim there is none.
  {
    name: "a turn that found work never claims there is none",
    world: "WORKING",
    turns: [
      { say: "내가 해야 할 일 정리해줘", expect: { status: "DONE", never: [ABSENCE_LIE], noLink: "/connect" } },
    ],
  },
  // Conversation Core v1 §9, reproduced live: a narrowed set followed by a NEW question of the org came
  // back as 「방금 본 문의 중 …」 — the previous question's axes riding into a read that never used them.
  {
    name: "a new list of the org does not inherit the previous set's frame",
    world: "WORKING",
    turns: [
      { say: "오늘 내가 답해야 할 문의 정리해줘", expect: { status: "DONE" } },
      { say: "배송 관련부터", expect: { status: "DONE" } },
      { say: "답변 안 한 문의 보여줘", expect: { status: "DONE", never: [REFINED] } },
    ],
  },
  // Conversation Contract Correctness v2 §E: a demonstrative with nothing to point at authorises no
  // investigation. It used to spend three to nine seconds reading the org's queues before asking back.
  {
    name: "a pronoun with no referent asks back and buys nothing",
    world: "WORKING",
    turns: [
      { say: "그거 어떻게 처리하지?", expect: { status: "DONE", llmCalls: 0, noArtifacts: ["INQUIRY_LIST", "CHECKLIST"] } },
    ],
  },
  // Agent Interaction Model v2: a refine over the visible set stays on it, and costs no planner call.
  {
    name: "a refine of the rows on screen stays on them",
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"] } },
      { say: "안 좋은 것만 봐줘", expect: { status: "DONE", noLink: "/connect" } },
    ],
  },
  // §5. 「써줘」 was on a word list the graph consulted whenever the plan said `NONE`; the planner reads
  // this sentence as a request for product copy, and it is not about replies at all.
  {
    name: "a request that merely contains 「써줘」 is not answered with the reply-draft notice",
    world: "WORKING",
    turns: [
      { say: "제품 설명 문구 써줘", expect: { status: "DONE", never: [DRAFT_NOTICE] } },
    ],
  },
  // §4. The axis is settled once in the graph and read back off the answer. If the composer settled it
  // again, this pair is where the two settlements could disagree — the rows come from the first, the
  // sentence about them from the second.
  {
    name: "the sentence about a set and the set itself are scoped by one decision",
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"] } },
      { say: "카페24만 봐봐", expect: { status: "DONE", never: ["네이버"] } },
    ],
  },
  // Response Hygiene v1: an unsupported sentence is refused in the product's own words, with nothing
  // drawn beside it — a refusal that also prints a list is a refusal the seller will not believe.
  {
    name: "an off-topic sentence is refused without an answer-shaped artifact beside it",
    world: "WORKING",
    turns: [
      { say: "점심 메뉴 추천해줘", expect: {
        // A refusal IS a terminal state, and saying so here is what distinguishes it from a sentence
        // nobody recorded a plan for.
        status: "FAILED",
        noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "CHECKLIST", "DRAFT"],
        never: [ABSENCE_LIE, DRAFT_NOTICE],
      } },
    ],
  },
  // Agent Object v1 §1-C: an ordinal over the visible set is a click, answered by the object with no
  // planner call. The regression it guards is the list being printed a second time instead.
  {
    name: "an ordinal over the visible set opens that object and calls no model",
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"] } },
      { say: "두 번째 거 자세히 보여줘", expect: {
        llmCalls: 0, artifacts: ["REVIEW_DETAIL"], noArtifacts: ["REVIEW_LIST"],
      } },
    ],
  },
];

/* ────────────────────────── product self-knowledge (2026-09-07) ────────────────────────── */

/**
 * <b>Six product questions from one clean seller, in the order they were asked.</b>
 *
 * Measured live 2026-09-07. Before this package the first three came back as: a request to name a
 * channel, the four-domain card, and 「판매 채널을 연결하는 것부터 하시면 됩니다」 — three different
 * questions and two fixed answers, with the third repeating an answer to a question nobody asked.
 *
 * The guarantees, one `never` each, and every one of them is about a DIFFERENT ANSWER rather than a
 * better sentence:
 *   1. 「어떤 채널을 지원해?」 is never answered by asking which channel.
 *   2. A follow-up on a different aspect never returns the onboarding step.
 *   3. Two channels' capabilities are two facts — the second is never swallowed as a repeat.
 *   4. NO_CHANNEL never blocks a product answer: 「연결부터 하세요」 is one aspect's answer, not the
 *      answer to every question a shop with nothing connected can ask.
 */
export const SELF_KNOWLEDGE_CASES: readonly NamedScenario[] = [
  {
    name: "[NO_CHANNEL] six product questions get six answers, not two",
    world: "NO_CHANNEL",
    turns: [
      { say: "지원하는 이커머스 종류가 뭐가 있지?", expect: {
        artifacts: ["SUMMARY"], says: ["지원합니다"],
        // The refusal whose own parenthesis held the answer.
        never: ["어느 채널에 대한 질문인지"],
      } },
      { say: "연동하고 나면 어떻게 가능한거지?", expect: {
        artifacts: ["SUMMARY"], says: ["정기적으로 가져옵니다", "답변 초안까지 준비해"], differsFrom: 0,
        // The onboarding step is HOW_TO_CONNECT's answer, and this is not that question.
        never: ["판매 채널을 연결하는 것부터 하시면 됩니다"],
      } },
      { say: "네이버 연결하면 정확히 뭘 해줘?", expect: {
        artifacts: ["SUMMARY"], says: ["네이버 스마트스토어"], differsFrom: 1,
        never: ["판매 채널을 연결하는 것부터 하시면 됩니다"],
      } },
      { say: "리뷰 답글도 자동으로 보내?", expect: {
        // The sentence names no channel, so the answer may not be about NAVER alone — the previous
        // turn's channel focus must not ride in (`conversation/channelFocus.ts`).
        artifacts: ["SUMMARY"], says: ["리뷰 답글 보내기"], differsFrom: 2,
      } },
      { say: "쿠팡은 어디까지 가능해?", expect: {
        artifacts: ["SUMMARY"], says: ["쿠팡"], differsFrom: 3,
        // NAVER's matrix and Coupang's are different facts; «said once» is per fact.
        never: ["말씀드린 것까지가"],
      } },
      { say: "어떻게 시작해?", expect: {
        artifacts: ["SUMMARY"], says: ["판매 채널을 연결하는 것부터"], link: "/connect", differsFrom: 4,
      } },
    ],
  },
  {
    name: "[NO_CHANNEL] the same question twice is not the same sentence twice",
    world: "NO_CHANNEL",
    turns: [
      { say: "연동하고 나면 어떻게 가능한거지?", expect: { artifacts: ["SUMMARY"], says: ["정기적으로 가져옵니다"] } },
      { say: "연동하고 나면 뭐가 되냐고", expect: {
        // The items are not re-printed, and the sentence that replaces them is new information —
        // not the previous headline with the card removed.
        noArtifacts: ["SUMMARY"], differsFrom: 0, says: ["연결 전에 드릴 수 있는 전부"], link: "/connect",
      } },
    ],
  },
];

/** Every conversation CI replays, in one list — the benchmark's selection core. */
export const CI_SCENARIO_CASES: readonly NamedScenario[] = [
  ...FIRST_USE_CASES, ...OBJECT_FLOW_CASES, ...QA_DEFECT_CASES, ...SELF_KNOWLEDGE_CASES,
];
