/**
 * PRIORITIZE — 「가장 시급한 건」 · 「먼저 볼 것」 · 「급한 것부터」.
 *
 * <b>The defect this closes.</b> The task vocabulary had LIST · FILTER · INSPECT · ANALYZE · PREPARE ·
 * REVISE · EXECUTE and no way to RANK. A superlative question therefore had only one expressible shape
 * — a list — so 「미응답 문의 중 가장 시급한 건?」 printed twenty rows and answered nothing. The missing
 * piece is not a sentence pattern; it is a mode with a stated criterion.
 *
 * <b>One criterion, and it is said out loud.</b> The only urgency signal this product actually holds is
 * how long the customer has been waiting — there is no per-channel answer deadline, no SLA field, no
 * severity on an inquiry (the same audit `prioritize/prioritizeInquiries.ts` recorded for the legacy
 * graph, re-checked here). So the rank is waiting time, descending, and the answer names that criterion
 * and its limit rather than implying a richer judgement than the data supports. Ties break by receipt
 * time then by id, so the order is stable and reproducible.
 *
 * <b>Deterministic and free.</b> No model call, no extra read: `receivedAt` is already on every row the
 * seller is looking at, and the reference date is the run's own.
 */

/** What the answer says about HOW it ranked. Never implies a signal the product does not have. */
export const URGENCY_CRITERION = "고객이 기다린 시간을 기준으로 정했습니다.";
/** Said once, beside the criterion: what this ranking cannot see. */
export const URGENCY_LIMIT = "채널이 정한 답변 기한 정보는 아직 없어 대기 시간만 봅니다.";

export interface UrgencyRow {
  readonly receivedAt: string;
  readonly inquiryId?: string;
  readonly workItemId?: string | null;
}

/** Whole days between the receipt date and the reference date, floored at 0. Dates, never clock time. */
export function waitingDaysOf(receivedAt: string | null | undefined, today: string): number | null {
  if (!receivedAt) return null;
  const from = Date.parse(`${receivedAt.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * The rows in urgency order — longest wait first. The input is not mutated; the comparison reads only
 * fields every row already carries.
 */
export function rankByUrgency<T extends UrgencyRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.receivedAt !== b.receivedAt) return a.receivedAt.localeCompare(b.receivedAt);
    return (a.inquiryId ?? a.workItemId ?? "").localeCompare(b.inquiryId ?? b.workItemId ?? "");
  });
}

/** 「12일째 답변을 기다리는 중」 — the reason one row is where it is. Null when the date cannot be read. */
export function waitingPhrase(days: number | null): string | null {
  if (days == null) return null;
  if (days === 0) return "오늘 접수";
  return `${days}일째 대기`;
}
