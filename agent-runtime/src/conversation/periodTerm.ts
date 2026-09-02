/**
 * <b>The calendar period the sentence names, read deterministically.</b>
 *
 * <b>Why the runtime reads a period the planner already reported.</b> It does not replace the planner —
 * it refuses to let a determined period be reported as a different one. Observed 2026-09-02: 「이번 달」
 * came back as 「이번 주」, under the seller's own words, with a row count that answered a smaller
 * question. The first half of that repair is the axis itself (`PeriodToken` had no month, so 「이번 달」
 * had nothing to be planned as); this is the second half — when the sentence names a calendar period in
 * so many words and the plan carries a DIFFERENT one, the sentence wins.
 *
 * <b>It corrects, it never introduces.</b> A plan with no period keeps none: 「오늘 할 일」 is a queue
 * question whose 「오늘」 is not a filter, and adding one there would invent the very constraint this
 * module exists to preserve. Two different periods in one sentence correct nothing — an ambiguous read
 * is not a determination.
 */
import type { PeriodToken } from "./contract";

/**
 * The phrases that NAME a calendar period, longest first so 「지난 주」 is read before 「주」-shaped
 * fragments could matter. Every entry is a whole word a seller writes, never a stem match.
 */
const PERIOD_WORDS: ReadonlyArray<readonly [string, PeriodToken]> = [
  ["지난 달", "LAST_MONTH"],
  ["지난달", "LAST_MONTH"],
  ["저번 달", "LAST_MONTH"],
  ["저번달", "LAST_MONTH"],
  ["전월", "LAST_MONTH"],
  ["이번 달", "THIS_MONTH"],
  ["이번달", "THIS_MONTH"],
  ["금월", "THIS_MONTH"],
  ["이달", "THIS_MONTH"],
  ["지난 주", "LAST_WEEK"],
  ["지난주", "LAST_WEEK"],
  ["저번 주", "LAST_WEEK"],
  ["저번주", "LAST_WEEK"],
  ["이번 주", "THIS_WEEK"],
  ["이번주", "THIS_WEEK"],
  ["금주", "THIS_WEEK"],
  ["어제", "YESTERDAY"],
  ["오늘", "TODAY"],
];

/** The single calendar period this sentence names, or null when it names none or more than one. */
export function periodTermOf(text: string): PeriodToken | null {
  const s = text ?? "";
  const found = new Set<PeriodToken>();
  for (const [word, token] of PERIOD_WORDS) {
    if (s.includes(word)) found.add(token);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * The period the read should use: the plan's, unless the sentence determined a different one.
 *
 * `null` in, `null` out — always. The plan deciding there is no period filter is a decision about the
 * question's shape (a queue is not a window), and this function has nothing to say about it.
 */
export function settledPeriod(planned: PeriodToken | null, text: string): PeriodToken | null {
  if (planned == null) return null;
  const named = periodTermOf(text);
  return named != null && named !== planned ? named : planned;
}
