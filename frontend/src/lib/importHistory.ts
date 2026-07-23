// How one review import reads to an operator.
//
// The backend sends counts, a status and a provenance; every word a seller sees is decided here, so
// the rules live in one testable place instead of being re-derived by a component.
//
// Two outcomes are the reason this file is careful. An **empty export** (SUCCESS, 0 new, 0 duplicate)
// and an **all-duplicate re-import** (SUCCESS, 0 new, N duplicate) are both CORRECT results — a quiet
// date range, and a range already collected. Reporting either as a failure, or flattening both into
// "0건", would be the same dishonesty in the other direction: it would tell a seller their working
// export was broken. Each gets its own sentence.
//
// Nothing here invents certainty: an unrecognised status and an absent provenance both read as
// unknown rather than being guessed into something reassuring.

import type { ReviewImport } from "./types";

/** Visual weight — mapped to classes by the component, never to a claim. */
export type ImportTone = "good" | "warn" | "bad" | "muted";

export interface ImportOutcomeView {
  /** The one line that answers "what did this bring?". */
  headline: string;
  /** Secondary counts (duplicates, failures) — empty when there is nothing to add. */
  detail: string;
  tone: ImportTone;
}

/** 방식: how the file got here. `null` is a row older than the provenance column — never guessed. */
export function provenanceLabel(method: string | null): string {
  if (method === "SELLER_CENTER_EXPORT") return "셀러센터 내보내기";
  if (method === "MANUAL_UPLOAD") return "직접 업로드";
  return "방식 미상";
}

/** `n건`, with the count spelled out — never bucketed, never rounded. */
function count(n: number): string {
  return `${n}건`;
}

/**
 * The outcome sentence for one import.
 *
 * Ordering matters: status decides the shape first, and only a SUCCESS is allowed to talk about what
 * arrived. A PARTIAL that inserted rows still says so, because hiding the successes would misreport a
 * half-landed import as a total loss.
 */
export function importOutcome(item: ReviewImport): ImportOutcomeView {
  const { status, successRows, skippedRows, failedRows } = item;
  const extras: string[] = [];
  if (skippedRows > 0) extras.push(`중복 ${count(skippedRows)}`);
  if (failedRows > 0) extras.push(`실패 ${count(failedRows)}`);
  const detail = extras.join(" · ");

  if (status === "RUNNING") {
    // The row opened and never finalized. Uploads are synchronous, so in practice this is an import
    // that died mid-flight — and nothing polls, so "진행 중" would keep claiming progress about a run
    // that ended days ago. "완료되지 않았어요" is true whether it is still in flight or crashed, and
    // it promises nothing that is not happening.
    return { headline: "완료되지 않았어요", detail: "", tone: "warn" };
  }
  if (status === "FAILED") {
    return { headline: "가져오지 못했어요", detail, tone: "bad" };
  }
  if (status === "PARTIAL") {
    return { headline: `일부만 저장됐어요 · 새 리뷰 ${count(successRows)}`, detail, tone: "warn" };
  }
  if (status === "SUCCESS") {
    if (successRows > 0) {
      return { headline: `새 리뷰 ${count(successRows)}`, detail, tone: "good" };
    }
    if (skippedRows > 0) {
      // Already collected — the import worked and had nothing new to add.
      return { headline: "새로 추가된 리뷰 없음", detail, tone: "muted" };
    }
    // An empty export: the range simply held no reviews. Correct, and worth saying plainly.
    return { headline: "새 리뷰 없음", detail: "", tone: "muted" };
  }
  // An unrecognised status is not an outcome we can describe. Say so rather than pick one.
  return { headline: "상태 미상", detail, tone: "muted" };
}

/**
 * When the import happened, for display.
 *
 * `finishedAt` where the run ended, `startedAt` while it is still running — a running import has no
 * end yet, and rendering an empty date would read as missing data rather than as in-progress.
 */
export function importTimestamp(item: ReviewImport): string {
  return item.finishedAt ?? item.startedAt;
}
