/**
 * <b>The benchmark's own conversations — written before any arm was run, and never edited after.</b>
 *
 * Planner Model & Prompt Benchmark v1 §2. Two lists live here and they are used for two different
 * things, which is the only reason they are separate:
 *
 *   {@link SELECTION_EXTRA} — added to the CI scenarios ({@link ../test/scenario/cases}) to make the
 *     SELECTION set. Arms are compared on it, and it is what a choice may be made from.
 *   {@link HOLDOUT} — a BLIND set. It is not looked at while arms are being compared; it is run once,
 *     at the end, on the arm that was chosen and on the baseline, and its only job is to say whether
 *     the selection result was real or was the selection set's own shape.
 *
 * <b>The discipline that makes the number mean anything.</b> Every sentence and every expectation in
 * this file was committed before a single arm ran. Nothing here may be adjusted after seeing a model's
 * output — a benchmark whose questions are edited to suit an answer measures the editor.
 *
 * <b>What the expectations are allowed to assert.</b> Product contracts, not phrasings: which artifact
 * a question is answered with, which sentence must never appear, whether a deterministic lane spent a
 * model call, whether a destination is offered. Where a `says` is used it quotes a string this
 * repository OWNS (a wording constant or a procedure sentence), never a sentence a model composes.
 * Turns whose expectation is wrong about the PRODUCT fail identically on every arm, which is
 * information about this repository and is reported as such rather than quietly repaired.
 */
import type { NamedScenario } from "../test/scenario/cases";
import { ABSENCE_LIE, DRAFT_NOTICE, REFINED } from "../test/scenario/cases";

/** Said when the seller's library holds nothing on the topic — `sellerWording.ts`, ABSENT. */
const NO_POLICY_YET = "기준이 아직 없습니다";
/** The NO_CHANNEL explanation. Wrong in every world where something IS connected. */
const NO_CHANNEL_YET = "아직 연결된 판매 채널이 없어";

/* ═════════════════════════════ SELECTION — extra, beyond the CI scenarios ════════════════════ */

export const SELECTION_EXTRA: readonly NamedScenario[] = [
  /* ── the seller's own catalogue, and one product in it ───────────────────────────────────── */
  {
    name: "S1 the catalogue is a question the runtime can answer",
    world: "WORKING",
    turns: [
      { say: "우리 상품 목록 보여줘", expect: {
        status: "DONE", artifacts: ["PRODUCT_LIST"], never: [ABSENCE_LIE, NO_CHANNEL_YET], noLink: "/connect",
      } },
    ],
  },
  {
    name: "S2 a product named by the seller, then a follow-up that must stay on it",
    world: "WORKING",
    turns: [
      { say: "전선몰딩 1호 리뷰는 어때?", expect: { status: "DONE", never: [ABSENCE_LIE, NO_CHANNEL_YET] } },
      // The follow-up has no noun of its own; the previous set is the noun.
      { say: "그 상품 문의는?", expect: { status: "DONE", never: [ABSENCE_LIE, "어떤 상품"] } },
    ],
  },

  /* ── the four inquiry intents, one sentence each ─────────────────────────────────────────── */
  {
    name: "S3 a question that asks for one number is answered without a work queue",
    world: "WORKING",
    turns: [
      { say: "미답변 문의 몇 건이야?", expect: {
        status: "DONE", never: [ABSENCE_LIE, NO_CHANNEL_YET], noArtifacts: ["DRAFT", "CHECKLIST"],
      } },
    ],
  },
  {
    name: "S4 a question about order of work is answered with what to do first",
    world: "WORKING",
    turns: [
      { say: "가장 급한 문의 하나만 알려줘", expect: {
        status: "DONE", never: [ABSENCE_LIE, NO_CHANNEL_YET], noLink: "/connect",
      } },
    ],
  },
  {
    name: "S5 a period the closed token list cannot express is carried as the number the seller said",
    world: "WORKING",
    turns: [
      // Conversation Contract Correctness v2 §A: LAST_N_DAYS + periodDays, never rounded to a
      // neighbouring token. The prior benchmark measured every arm losing this constraint entirely.
      { say: "최근 3일 안에 들어온 문의만 보여줘", expect: {
        status: "DONE", artifacts: ["INQUIRY_LIST"], never: [ABSENCE_LIE, "최근 7일"],
      } },
    ],
  },

  /* ── the company's own rules ─────────────────────────────────────────────────────────────── */
  {
    name: "S6 a company-rule question is answered from the library, not from the inbox",
    world: "WORKING",
    turns: [
      // Nothing is registered in this world, so the honest answer is the absence sentence — and the
      // failure this guards is answering a policy question with a list of inquiries instead.
      { say: "우리 배송 정책 뭐였지?", expect: {
        status: "DONE", says: [NO_POLICY_YET], never: [ABSENCE_LIE],
        noArtifacts: ["INQUIRY_LIST", "CHECKLIST"],
      } },
    ],
  },

  /* ── the same sentence, two shops ────────────────────────────────────────────────────────── */
  {
    name: "S7 「안 좋은 리뷰 있어?」 to a shop that has connected nothing",
    world: "NO_CHANNEL",
    turns: [
      { say: "안 좋은 리뷰 있어?", expect: {
        status: "DONE", never: [ABSENCE_LIE], noArtifacts: ["REVIEW_LIST"],
      } },
    ],
  },
  {
    name: "S8 「안 좋은 리뷰 있어?」 to a shop that has them",
    world: "WORKING",
    turns: [
      { say: "안 좋은 리뷰 있어?", expect: {
        status: "DONE", artifacts: ["REVIEW_LIST"], never: [ABSENCE_LIE, NO_CHANNEL_YET], noLink: "/connect",
      } },
    ],
  },

  /* ── a sentence with nothing to point at ─────────────────────────────────────────────────── */
  {
    name: "S9 a bare demonstrative at the start of a thread buys nothing",
    world: "WORKING",
    turns: [
      { say: "그건 어때?", expect: {
        status: "DONE", llmCalls: 0, noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "CHECKLIST"],
      } },
    ],
  },

  /* ── a four-turn chain: list, narrow, narrow again, then a new question of the org ───────── */
  {
    name: "S10 three refinements stay on the set, and the fourth question leaves it",
    world: "WORKING",
    turns: [
      { say: "최근 문의 보여줘", expect: { status: "DONE", artifacts: ["INQUIRY_LIST"] } },
      { say: "카페24만", expect: { status: "DONE", never: ["네이버"] } },
      { say: "그 중 답변 안 한 것만", expect: { status: "DONE" } },
      // A new question of the ORG. It must not come back as 「방금 본 …」.
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { status: "DONE", artifacts: ["REVIEW_LIST"], never: [REFINED] } },
    ],
  },

  /* ── freshness: a channel that cannot speak for today ────────────────────────────────────── */
  {
    name: "S11 a today question over a channel whose collection has not run says so",
    world: "STALE",
    turns: [
      { say: "오늘 들어온 리뷰 보여줘", expect: {
        // Not FAILED and not a bare zero: the product's answer is that one channel is unproven.
        says: ["쿠팡"], never: [ABSENCE_LIE, NO_CHANNEL_YET],
      } },
    ],
  },

  /* ── a shop that connected this morning ──────────────────────────────────────────────────── */
  {
    name: "S12 a count question over a shop that has collected nothing yet",
    world: "CONNECTED_NO_DATA",
    turns: [
      { say: "미답변 문의 몇 건이야?", expect: {
        status: "DONE", never: [NO_CHANNEL_YET, DRAFT_NOTICE], noLink: "/connect",
      } },
    ],
  },
];

/* ═════════════════════════════════ HOLDOUT — blind, run once ═════════════════════════════════ */

/**
 * Same classes, different sentences. Written at the same sitting as the selection set and then not
 * looked at until the arms had been compared.
 */
export const HOLDOUT: readonly NamedScenario[] = [
  {
    name: "H1 a paraphrase of the first-morning question, on a shop with nothing connected",
    world: "NO_CHANNEL",
    turns: [
      { say: "지금 뭐부터 해야 돼?", expect: {
        status: "DONE", says: [NO_CHANNEL_YET], never: [ABSENCE_LIE, "0건"], link: "/connect",
      } },
    ],
  },
  {
    name: "H2 a capability question phrased as a doubt",
    world: "NO_CHANNEL",
    turns: [
      { say: "리뷰 관리도 해줘?", expect: { status: "DONE", never: [ABSENCE_LIE] } },
    ],
  },
  {
    name: "H3 a count question phrased as 「몇 개나 남았어」",
    world: "WORKING",
    turns: [
      { say: "답변 안 한 문의 몇 개나 남았어?", expect: {
        status: "DONE", never: [ABSENCE_LIE, NO_CHANNEL_YET], noArtifacts: ["DRAFT"],
      } },
    ],
  },
  {
    name: "H4 a channel narrowing followed by a superlative that means one row",
    world: "WORKING",
    turns: [
      { say: "문의 목록 좀 보여줘", expect: { status: "DONE", artifacts: ["INQUIRY_LIST"] } },
      { say: "카페24 것만 보여줘", expect: { status: "DONE", never: ["네이버"] } },
      { say: "가장 오래된 거 하나만", expect: { status: "DONE", never: [ABSENCE_LIE] } },
    ],
  },
  {
    name: "H5 an exact row named by position, and a reply asked for in one sentence",
    world: "WORKING",
    turns: [
      { say: "오늘 내가 답해야 할 문의 정리해줘", expect: { status: "DONE", artifacts: ["INQUIRY_LIST"] } },
      { say: "첫 번째 거 답장 좀 써줘", expect: {
        status: "DONE", artifacts: ["DRAFT"], never: ["어떤 문의의 답변을 준비할지", DRAFT_NOTICE],
      } },
    ],
  },
  {
    name: "H6 a revenue question over a period the seller named",
    world: "WORKING",
    turns: [
      { say: "이번 주 매출 어때?", expect: { status: "DONE", never: [ABSENCE_LIE, NO_CHANNEL_YET] } },
    ],
  },
  {
    name: "H7 a repeated-problem question is answered with issues, not with review rows",
    world: "WORKING",
    turns: [
      { say: "반복해서 나오는 리뷰 문제 있어?", expect: {
        status: "DONE", never: [ABSENCE_LIE, NO_CHANNEL_YET], noLink: "/connect",
      } },
    ],
  },
  {
    name: "H8 two words that point at nothing",
    world: "WORKING",
    turns: [
      { say: "저기 그거", expect: {
        llmCalls: 0, noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "CHECKLIST", "DRAFT"],
      } },
    ],
  },
  {
    name: "H9 the first-morning question on a shop that connected but has collected nothing",
    world: "CONNECTED_NO_DATA",
    turns: [
      { say: "오늘 할 일 알려줘", expect: {
        status: "DONE", says: ["연결은 끝났고"], never: [ABSENCE_LIE, NO_CHANNEL_YET],
      } },
    ],
  },
  {
    name: "H10 an off-topic request is refused and draws nothing",
    world: "WORKING",
    turns: [
      { say: "노래 추천해줘", expect: {
        status: "FAILED", noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "CHECKLIST", "DRAFT"],
        never: [ABSENCE_LIE, DRAFT_NOTICE],
      } },
    ],
  },
  {
    name: "H11 a freshness question asked directly",
    world: "STALE",
    turns: [
      { say: "리뷰 지금 최신 상태야?", expect: { says: ["쿠팡"], never: [ABSENCE_LIE, NO_CHANNEL_YET] } },
    ],
  },
];
