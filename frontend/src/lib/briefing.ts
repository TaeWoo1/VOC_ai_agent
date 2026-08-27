import type { OperationsInsight } from "./types";

/**
 * <b>What the Agent says first, and how it counts.</b>
 *
 * <p>Agent Command Center v1 §0/§3/§5. The home screen used to open with six equally-sized numbers
 * and leave the seller to work out which one was a problem. It now opens with a sentence — and the
 * sentence has to be true, so it is a deterministic function of the objects rendered underneath it,
 * never a model's summary of them. Nothing in this module calls anything.
 *
 * <p><b>The Agent does not talk like a log.</b> 「3개의 proactive case를 탐지했습니다」 is a sentence
 * about our own data model; 「오늘 먼저 확인하면 좋은 일이 3개 있습니다」 is a sentence about the
 * seller's morning. Every string here is the second kind, and the words for the individual findings
 * still come from the backend — this decides only the greeting and the grouping.
 */

/** The three groups the briefing can hold, in the order a seller works them. */
export type BriefingGroupKey = "PREPARED" | "PROACTIVE" | "INSIGHT";

/**
 * The greeting, from the number of things actually rendered below it.
 *
 * <b>Zero is a real answer and it gets its own sentence.</b> Saying 「0개 있습니다」 is a sentence a
 * program writes; a quiet morning is worth one line that reads like one.
 */
export function briefingHeadline(count: number): string {
  if (count <= 0) {
    return "지금 먼저 확인할 일은 없습니다.";
  }
  return `오늘 먼저 확인하면 좋은 일이 ${count}개 있습니다.`;
}

/** The one line under the greeting, or null. Says where the number came from, never how it was made. */
export function briefingSubline(count: number): string | null {
  return count <= 0
    ? "새로 들어온 문의나 리뷰가 생기면 여기에 먼저 정리해 두겠습니다."
    : null;
}

/**
 * <b>The disconnected morning — the one case where 「확인할 일은 없습니다」 is a lie.</b>
 *
 * <p>Disconnected Channel Onboarding Live Walkthrough v1 §17. A seller who signed up two minutes ago
 * has nothing waiting because nothing has been read yet, and the arithmetic greeting told them so:
 * 「지금 먼저 확인할 일은 없습니다」 over six zeros and three empty tables. There IS something to do,
 * it is the only thing, and it was not on the screen.
 *
 * <p>This is not a fourth briefing group. It REPLACES the greeting while the org has no connected
 * channel, because a count of waiting work is not a fact yet — and it goes away by itself the moment
 * one connection exists, with no flag and nothing to turn off.
 */
export const DISCONNECTED_HEADLINE = "판매 채널을 연결하면 시작할 수 있습니다.";
export const DISCONNECTED_SUBLINE =
    "채널을 연결하면 주문·문의·리뷰를 대신 확인하고, 먼저 봐야 할 일을 여기에 정리해 두겠습니다.";

/**
 * Which insights belong in the briefing at all.
 *
 * <p>{@code INFO} rows are context, not work — they describe the shape of the numbers rather than
 * something to do — and the briefing is a list of things to do. They are still on the screen, in the
 * reference section, where a reader looks for them on purpose.
 */
export function briefingInsights(insights: OperationsInsight[]): OperationsInsight[] {
  return insights.filter((insight) => insight.severity !== "INFO");
}

/**
 * The seller-facing name for prepared work.
 *
 * <p>Never 「초안 생성 완료」 or 「DRAFT_PREPARED N건」 — the fact the seller cares about is that
 * something is waiting for THEM, and the verb is theirs.
 */
export function preparedTitle(count: number): string {
  return `답변 초안을 준비해 둔 문의 ${count}건`;
}
