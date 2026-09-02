/**
 * <b>「오늘 네이버 리뷰 있어?」 — answered by the product, not by a plan.</b>
 *
 * <b>Why this is structural and not a phrase patch.</b> The question has exactly three parts and this
 * product owns all three: an OBJECT it stores (reviews), a CHANNEL it knows the coverage of, and a
 * PERIOD it can name. Nothing is discovered by planning it — and planning it is where it went wrong:
 * across four QA passes the identical sentence came back once as 「요청을 어떻게 조사할지 계획하지
 * 못했습니다」 and once as a checklist about something else. A seller asking whether today's reviews
 * arrived must not depend on a model's mood, so the shape is recognised and the answer is composed from
 * the same reads the specialist makes.
 *
 * <b>This is not a goal planner.</b> Like the acquisition lane beside it, it is a closed question about
 * an object the product already holds — it selects no tools, invents no evidence, and answers only the
 * three-part shape. Anything wider (a product, a rating, a comparison, a follow-up over a set) is not
 * recognised and stays the planner's, unchanged.
 *
 * <b>Freshness and acquisition are the same intent here.</b> When the window cannot be answered from
 * what is held, the CAPABILITY decides what happens next, not the sentence: an AUTOMATIC channel is
 * refreshed by the product itself and the question is re-answered; a GUIDED channel is offered the one
 * step it needs. Neither is a marketplace write, and the guided run is still performed by the seller in
 * their own window.
 */
import type { SpringClientBundle } from "../http/AgentRunService";
import type {
  Artifact, DateWindow, FreshnessRow, HumanActionRequiredArtifact, PeriodToken, ReviewItem, ReviewListArtifact,
  SuggestedAction, WorkingSetView,
} from "./contract";
import { dateOf, periodLabel, windowOf } from "./period";
import { periodTermOf } from "./periodTerm";
import { freshnessVerdict, isFreshnessRequired, rowsSentence, staleSentence } from "../operator/graph/reviewRows";
import { asOfWord } from "./asOf";
import { acquisitionStepFor } from "./acquisitionStep";
import { Refresher } from "./Refresher";
import { REFRESH_FAILURE_LABEL } from "../operator/graph/reviewRefresh";
import { log } from "../log";

/** The object this lane can answer about. Reviews only — nothing else has a freshness axis a seller asks about. */
const OBJECT_WORDS = ["리뷰", "후기"];

/** Objects that make the sentence somebody else's question. */
const OTHER_OBJECT_WORDS = ["문의", "주문", "상품", "정책", "지식", "매출", "고객"];

/**
 * The question shapes this lane recognises: does the seller have new reviews, and are we current?
 * Closed, and every one of them is an EXISTENCE or STATE question — never a filter, a ranking or an
 * instruction (those are the planner's, and 「최신화해줘」 is the acquisition lane's).
 */
const QUESTION_CUES = ["있어", "있나", "있을까", "있는지", "왔어", "왔나", "들어왔", "어때", "어떤가", "몇 건", "몇건"];

/** Words that make it a different question about the same rows — a rating, a product, a ranking, a set. */
const NOT_RECOGNISED = [
  "안 좋", "나쁜", "낮은", "별점", "부정", "상품별", "그중", "여기서", "방금", "왜", "이유", "비교", "반복", "문제",
];

export interface FreshnessQuestion {
  /** The calendar period the sentence named, or null when it asked about the reviews themselves. */
  readonly period: PeriodToken | null;
}

/**
 * The three-part question, or null when this sentence is not one.
 *
 * Deliberately strict: it must name reviews, must not name another operational object, must carry a
 * question cue, and must carry none of the words that make it a different question. The failure
 * direction is "not recognised" — which costs a planner call, exactly as today.
 */
export function freshnessQuestionOf(text: string): FreshnessQuestion | null {
  const s = (text ?? "").trim();
  if (s.length === 0) return null;
  const lower = s.toLowerCase();
  if (!OBJECT_WORDS.some((w) => lower.includes(w))) return null;
  if (OTHER_OBJECT_WORDS.some((w) => lower.includes(w))) return null;
  if (NOT_RECOGNISED.some((w) => lower.includes(w))) return null;
  if (!QUESTION_CUES.some((w) => lower.includes(w))) return null;
  return { period: periodTermOf(s) };
}

const ROWS_SHOWN = 5;

export interface FreshnessAnswer {
  readonly message: string;
  readonly artifacts: readonly Artifact[];
  readonly workingSet: WorkingSetView | null;
  readonly suggestedActions: readonly SuggestedAction[];
  readonly waiting: boolean;
  readonly pending: HumanActionRequiredArtifact | null;
  readonly toolCalls: number;
}

/**
 * Answer the question from the seller's own rows, refreshing or asking for a step when the window
 * cannot be answered from what is held. Returns null when the reads fail — the planner keeps the turn.
 */
export async function answerFreshnessQuestion(
  bundle: SpringClientBundle, question: FreshnessQuestion, channel: string | null,
  localAgent: "PAIRED" | "ABSENT" | "UNKNOWN", now: string,
): Promise<FreshnessAnswer | null> {
  const today = now.slice(0, 10);
  const window: DateWindow | null = question.period ? windowOf(question.period, today) : null;
  const code = channel?.toUpperCase() ?? null;
  let toolCalls = 0;

  const read = async () => {
    toolCalls += 1;
    return bundle.operator.listRecentReviews({
      ...(window ? { from: window.from, to: window.to } : {}),
      negativeOnly: false, ...(code ? { channel: code } : {}), size: ROWS_SHOWN,
    });
  };

  let response;
  try {
    response = await read();
  } catch {
    return null;
  }

  let freshness: FreshnessRow[] = (response.coverage ?? [])
    .filter((c) => c.dataType === "REVIEW" && (!code || c.channelCode.toUpperCase() === code))
    .map((c) => ({
      channelCode: c.channelCode, channelNameKo: c.channelNameKo, state: c.state,
      verdict: freshnessVerdict(c, window), lastSuccessfulSyncAt: c.lastSuccessfulSyncAt,
      newestObservedAt: c.newestObservedAt,
    }));

  const required = isFreshnessRequired(question.period);
  const stale = () => freshness.filter((f) => f.verdict === "UNPROVEN" || f.verdict === "NOT_COLLECTED");

  // ── The window cannot be answered from what is held. The CAPABILITY decides what happens, not the
  // sentence: the product refreshes what it can refresh, and asks for the one step it cannot.
  const notes: string[] = [];
  let pending: HumanActionRequiredArtifact | null = null;
  let refreshed = false;
  for (const f of stale()) {
    const step = await acquisitionStepFor(bundle, f.channelCode, localAgent, now);
    if (step?.refreshable) {
      const outcome = await new Refresher(bundle.inquiry).refresh(step.accountId, "REVIEW");
      toolCalls += 1;
      if (outcome.ok) {
        refreshed = true;
      } else {
        notes.push(`${f.channelNameKo ?? f.channelCode} 리뷰를 최신 상태로 갱신하지 못했습니다 (${REFRESH_FAILURE_LABEL[outcome.failure]}).`);
      }
      continue;
    }
    if (step && required && !pending) {
      // One step at a time: the question waits on the channel it is about.
      pending = step.artifact;
      continue;
    }
    notes.push(staleSentence(f.channelNameKo ?? f.channelCode, asOfWord(f.lastSuccessfulSyncAt, today), required && step != null));
  }

  if (refreshed) {
    try {
      response = await read();
      freshness = (response.coverage ?? [])
        .filter((c) => c.dataType === "REVIEW" && (!code || c.channelCode.toUpperCase() === code))
        .map((c) => ({
          channelCode: c.channelCode, channelNameKo: c.channelNameKo, state: c.state,
          verdict: freshnessVerdict(c, window), lastSuccessfulSyncAt: c.lastSuccessfulSyncAt,
          newestObservedAt: c.newestObservedAt,
        }));
    } catch {
      /* keep what we had; the note already says the refresh outcome */
    }
  }

  const anyStale = stale().length > 0;
  const items: ReviewItem[] = response.items.slice(0, ROWS_SHOWN).map((r) => ({
    reviewId: r.id, accountId: r.sellerAccountId, channelCode: r.channelCode, channelNameKo: r.channelNameKo,
    writtenOn: r.writtenOn, rating: r.rating, negative: r.negative, preview: r.preview,
    productId: r.productId, productName: r.productName, to: "/reviews",
  }));
  const label = question.period ? periodLabel(question.period) : "";
  const scopeName = code
    ? freshness.find((f) => f.channelCode.toUpperCase() === code)?.channelNameKo ?? null
    : null;

  const list: ReviewListArtifact = {
    artifactId: "a-freshness-reviews",
    type: "REVIEW_LIST",
    title: `${scopeName ? `${scopeName} ` : ""}${label ? `${label} 들어온 ` : ""}리뷰`,
    scope: { channelCode: code, period: window, rating: "ALL" },
    totalCount: response.total,
    items,
    freshness,
    freshnessRequired: required,
    referenceDate: today,
    more: { label: "리뷰 화면에서 보기", to: "/reviews", count: response.total },
  };

  const message = [rowsSentence(null, "", label, response.total, anyStale, question.period), ...notes].join(" ");
  log("conversation_freshness_lane", {
    channel: code ?? "ALL", period: question.period ?? "NONE", rows: items.length, total: response.total,
    stale: stale().length, refreshed, waiting: pending != null, toolCalls,
  });
  return {
    message,
    artifacts: [list, ...(pending ? [pending] : [])],
    workingSet: {
      turnId: "",
      kind: "REVIEWS",
      label: list.title,
      count: response.total,
      ids: items.map((i) => i.reviewId),
      workItemIds: [],
      productIds: [...new Set(items.map((i) => i.productId).filter((id): id is string => id != null))],
      filters: { channelCode: code, rating: "ALL", ...(window ? { period: window } : {}) },
    },
    suggestedActions: [],
    waiting: pending != null,
    pending,
    toolCalls,
  };
}

/** The observation date a window was judged against — exported for the tests that pin the boundary. */
export function windowFor(period: PeriodToken | null, today: string): DateWindow | null {
  return period ? windowOf(period, today) : null;
}

export { dateOf };
