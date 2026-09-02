/**
 * Freshness claim levels — what a resumed review read is allowed to SAY about what arrived.
 *
 * <b>Newly ingested ≠ newly written.</b> A collection run's `successRows` counts rows it brought into
 * the store; some of them were written weeks ago and simply had not been collected. A row's
 * `writtenOn` says when the customer wrote it. The two are different facts and this file keeps them
 * in different sentences:
 *
 * <ul>
 *   <li><b>A — never claimed.</b> 「오늘 리뷰는 전부 확인했습니다」 needs a completeness proof no channel
 *       gives (an export is a page the seller chose; a WING read is the pages the seller turned).</li>
 *   <li><b>B — rows with `writtenOn` inside the window</b>, from the resumed read: 「이번에 확인한
 *       네이버 리뷰 중 오늘 작성된 N건」. Counts only those rows; says nothing about completeness.</li>
 *   <li><b>C — only the run's `successRows` is known</b>: 「이전에 없던 리뷰 N건을 새로 가져왔어요」.
 *       Says INGESTED and never 「작성된」, 「새 리뷰」 or 「오늘」.</li>
 * </ul>
 */
import type { DateWindow, ReviewItem } from "./contract";

export type ClaimLevel = "B" | "C";

export interface ReviewClaim {
  readonly level: ClaimLevel;
  readonly channelCode: string;
  readonly count: number;
  readonly sentence: string;
}

export interface CollectedRun {
  readonly channelCode: string;
  readonly successRows?: number | null;
}

/** The window's own name for level B — 「오늘」/「어제」 or a range. */
function windowWord(window: DateWindow): string {
  switch (window.token) {
    case "TODAY": return "오늘";
    case "YESTERDAY": return "어제";
    case "THIS_WEEK": return "이번 주에";
    case "LAST_WEEK": return "지난주에";
    case "THIS_MONTH": return "이번 달에";
    case "LAST_MONTH": return "지난달에";
    case "LAST_7_DAYS": return "최근 7일 안에";
    case "LAST_14_DAYS": return "최근 14일 안에";
    case "LAST_30_DAYS": return "최근 30일 안에";
    default: return `${window.from}~${window.to}에`;
  }
}

/**
 * One claim per completed channel, or none when neither level can be stated.
 *
 * `rows` are the rows the resumed read returned (all channels); `window` is that read's window, or
 * `null` when the read was unbounded — which drops the date clause rather than inventing a range;
 * `collected` are the runs the conversation saw finish. B wins over C when both are available —
 * a row's own date is stronger evidence than a run's count.
 */
export function claimsFor(
  rows: readonly ReviewItem[], window: DateWindow | null, collected: readonly CollectedRun[], channelNames: ReadonlyMap<string, string>,
): ReviewClaim[] {
  const claims: ReviewClaim[] = [];
  for (const run of collected) {
    const code = run.channelCode.toUpperCase();
    const name = channelNames.get(code) ?? run.channelCode;
    const written = rows.filter((r) => r.channelCode.toUpperCase() === code
      && r.writtenOn != null && (window == null || (r.writtenOn >= window.from && r.writtenOn <= window.to)));
    if (written.length > 0) {
      claims.push({
        level: "B", channelCode: code, count: written.length,
        // <b>A read with no window names no period</b> (Outcome Artifact v1 §2). The count is the same
        // either way — every row with a date passes an unbounded filter — so the only thing a missing
        // window may change is the clause, and the honest form of a clause with nothing to say is no
        // clause. It must never become a placeholder range: a seller cannot read 0000-00-00.
        sentence: window
          ? `이번에 확인한 ${name} 리뷰 중 ${windowWord(window)} 작성된 리뷰는 ${written.length}건입니다.`
          : `이번에 확인한 ${name} 리뷰는 ${written.length}건입니다.`,
      });
      continue;
    }
    if (run.successRows != null && run.successRows > 0) {
      claims.push({
        level: "C", channelCode: code, count: run.successRows,
        sentence: `이전에 없던 ${name} 리뷰 ${run.successRows}건을 새로 가져왔습니다. 언제 작성된 것인지는 목록의 날짜로 확인해 주세요.`,
      });
    }
  }
  return claims;
}
