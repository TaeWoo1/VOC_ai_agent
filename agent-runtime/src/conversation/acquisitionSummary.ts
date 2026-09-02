/**
 * <b>What a finished guided acquisition says to the seller.</b>
 *
 * The run they just performed produced 「새 리뷰 가져오기가 끝났습니다」 and nothing else — true, and
 * silent about the only four things they wanted to know: which days were checked, how many reviews were
 * new, how many were already held, and whether anything failed. Those four are what the backend's attempt
 * row holds, and this module is the only place they become Korean.
 *
 * <b>No internal word reaches this sentence.</b> No plan, no segment, no sync, no provenance — a seller
 * who ran an export is owed the result of the export, not the vocabulary of the machinery that ran it.
 */
import type { ReviewAcquisitionResult } from "../spring/types";

/** 「9월 1일」 — a date-only string as the seller reads it. */
function dayWord(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

/** 「9월 1일~9월 2일」, or one day when both ends are the same. */
export function periodWord(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  return from === to ? dayWord(from) : `${dayWord(from)}~${dayWord(to)}`;
}

/**
 * The seller's summary of one completed acquisition, or null when the run holds nothing to summarise.
 *
 * Counts that are absent are not printed as zero: an attempt row that never recorded a tally is a run we
 * cannot describe, not a run that brought in nothing.
 */
export function acquisitionSummary(channelName: string, result: ReviewAcquisitionResult): string | null {
  const period = periodWord(result.periodStart, result.periodEnd);
  const added = result.rowsNew;
  const duplicate = result.rowsDuplicate;
  const failed = result.rowsFailed ?? 0;
  if (period == null && added == null) return null;

  const head = period ? `${channelName} 리뷰 ${period}을 확인했습니다.` : `${channelName} 리뷰를 확인했습니다.`;
  const parts: string[] = [];
  if (added != null) parts.push(added > 0 ? `새로 들어온 리뷰 ${added}건` : "새로 들어온 리뷰는 없습니다");
  if (duplicate != null && duplicate > 0) parts.push(`이미 확인한 리뷰 ${duplicate}건`);
  const body = parts.length === 0 ? "" : added != null && added === 0 && parts.length === 1
    ? ` ${parts[0]}.`
    : ` ${parts.join(", ")}입니다.`;
  // A failure is its own sentence: a number appended to a list of successes is read as one of them.
  const tail = failed > 0 ? ` ${failed}건은 읽지 못했습니다.` : "";
  return `${head}${body}${tail}`;
}
