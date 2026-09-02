/**
 * <b>What a finished guided acquisition says to the seller.</b>
 *
 * The run they just performed produced 「새 리뷰 가져오기가 끝났습니다」 and nothing else — true, and
 * silent about the only things they wanted to know: which days were checked, how many reviews were new,
 * how many were already held, and whether anything failed. Those are what the backend's attempt row
 * holds, and this module is the only place they leave it.
 *
 * <b>The numbers travel as numbers</b> (Outcome Artifact v1 §1). They used to be flattened here into one
 * Korean sentence — 「네이버 리뷰 8월 20일~9월 2일을 확인했습니다. 새로 들어온 리뷰 115건, 이미 확인한
 * 리뷰 33건입니다.」 — which meant the only way for a screen to give the count a size, the window a place,
 * or a failure a colour was to take our own sentence apart again. So the facts become a closed artifact
 * and the prose says one thing: what the result MEANS. Neither restates the other.
 *
 * <b>No internal word reaches either.</b> No plan, no segment, no sync, no provenance — a seller who ran
 * an export is owed the result of the export, not the vocabulary of the machinery that ran it.
 */
import type { AcquisitionResultArtifact } from "./contract";
import type { ReviewAcquisitionResult } from "../spring/types";

/**
 * One completed acquisition as a structured object, or null when the record holds nothing to show.
 *
 * A record with neither a window nor a tally is a run we cannot describe, not a run that brought in
 * nothing — and the counts it does not hold stay `null` rather than becoming zeros we never observed.
 * The window is all-or-nothing: half a range is not a period, and a placeholder end is exactly the
 * sentinel this package exists to keep away from the seller.
 */
export function acquisitionResultOf(
  channelCode: string, channelName: string, result: ReviewAcquisitionResult,
): AcquisitionResultArtifact | null {
  const bounded = result.periodStart != null && result.periodEnd != null;
  if (!bounded && result.rowsNew == null) return null;
  const code = channelCode.toUpperCase();
  return {
    artifactId: `a-acquisition-${code.toLowerCase()}`,
    type: "ACQUISITION_RESULT",
    title: `${channelName} 리뷰 가져오기 결과`,
    // The prose above it always says this — the meaning sentence is produced from these same receipts —
    // so the header would be that fact twice. The title stays as the section's accessible name.
    titleSaid: true,
    channelCode: code,
    channelNameKo: channelName,
    periodStart: bounded ? result.periodStart : null,
    periodEnd: bounded ? result.periodEnd : null,
    rowsNew: result.rowsNew,
    rowsDuplicate: result.rowsDuplicate,
    rowsFailed: result.rowsFailed,
  };
}

/**
 * The one sentence that says what just happened — and not one number of it.
 *
 * The card underneath carries the window and the three tallies; a paragraph that says 115 above a card
 * that says 115 is one fact twice, in the weaker of the two renderings. What prose is for here is the
 * meaning: something new arrived, or nothing did, or we cannot say which.
 */
export function acquisitionMeaning(results: readonly AcquisitionResultArtifact[]): string | null {
  if (results.length === 0) return null;
  const names = [...new Set(results.map((r) => r.channelNameKo))].join("·");
  const tallied = results.every((r) => r.rowsNew != null);
  if (tallied && results.every((r) => (r.rowsNew ?? 0) > 0)) return `${names} 리뷰를 새로 가져왔습니다.`;
  if (tallied && results.every((r) => r.rowsNew === 0)) return `${names} 리뷰를 확인했지만 새로 들어온 리뷰는 없습니다.`;
  return `${names} 리뷰를 확인했습니다.`;
}
