import type { ChannelCoverageRowView, SyncRunView } from "./types";

/**
 * <b>「무엇을 가져왔는지」 — the sentence a first connection owes the seller.</b>
 *
 * <p>Disconnected Channel Onboarding Live Walkthrough v1 §6/§7. A connection screen that ends at
 * 「연결 완료」 has told the seller about our plumbing and nothing about their shop. This turns the two
 * facts we already hold into one line per data type.
 *
 * <p><b>The state decides the sentence; the run decides the number.</b> Those are different questions
 * and this module keeps them apart on purpose:
 *
 * <ul>
 *   <li><b>State</b> comes from {@code ChannelDataState}, which already separates the four ways a
 *       channel can be quiet — a measured zero, an unproven silence, a channel that does not offer
 *       this at all, and a channel that is blocked. Only {@code ZERO} may be written as 「없습니다」;
 *       every other quiet state gets words that admit we do not know.</li>
 *   <li><b>Number</b> comes from a terminal sync run's {@code successRows} — what the CHANNEL just
 *       handed over. The coverage row's {@code rows} is not used for this: it counts everything the
 *       org holds, seeded rows included, and a seeded row has never been handed over by anyone. A
 *       count printed under 「가져왔습니다」 must be unable to include one.</li>
 * </ul>
 *
 * <p>Nothing here calls a channel, and nothing here can start a collection.
 */

/** The operator data types, in the order a seller reads them. Mirrors `ChannelCoverageService.DATA_TYPES`. */
export const SUMMARY_DATA_TYPES = ["ORDER_SUMMARY", "INQUIRY", "REVIEW"] as const;

export const DATA_TYPE_LABEL: Record<string, string> = {
  ORDER_SUMMARY: "주문",
  INQUIRY: "문의",
  REVIEW: "리뷰",
};

/**
 * How a line reads. `collected` is the only one that carries a number; `pending` and `blocked` are the
 * two shapes of "we cannot say", kept apart because the seller can act on one of them.
 */
export type SummaryTone = "collected" | "empty" | "pending" | "blocked" | "unsupported";

export interface SourceSummaryLine {
  readonly dataType: string;
  readonly label: string;
  readonly tone: SummaryTone;
  /** What this channel handed over in this connection's own run — null when no run has finished. */
  readonly count: number | null;
  readonly sentence: string;
}

/** The newest terminal run for one data type on this account, if the channel has finished one. */
function terminalRun(runs: readonly SyncRunView[], dataType: string): SyncRunView | null {
  const done = runs.filter(
    (run) => run.dataType === dataType && (run.status === "SUCCESS" || run.status === "PARTIAL"),
  );
  if (done.length === 0) return null;
  // Newest first by finish time; a run with no finish time cannot be the newest terminal one.
  return done
    .slice()
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0];
}

function lineFor(row: ChannelCoverageRowView, run: SyncRunView | null): SourceSummaryLine {
  const label = DATA_TYPE_LABEL[row.dataType] ?? row.dataType;
  const base = { dataType: row.dataType, label } as const;

  if (row.state === "NOT_SUPPORTED") {
    // Not a failure and not an empty result. Saying 「0건」 here would describe the seller's shop
    // using a fact about the channel's API.
    return { ...base, tone: "unsupported", count: null, sentence: `${label}는 이 채널에서 제공하지 않습니다.` };
  }
  if (row.state === "BLOCKED") {
    return { ...base, tone: "blocked", count: null, sentence: `${label}를 가져오지 못하고 있습니다. 연결을 다시 확인해 주세요.` };
  }
  if (row.state === "NOT_CONNECTED") {
    return { ...base, tone: "pending", count: null, sentence: `${label}는 아직 연결되지 않았습니다.` };
  }
  if (row.state === "ZERO") {
    // The only honest 「없습니다」 in this file: collection is running and it found nothing.
    return { ...base, tone: "empty", count: 0, sentence: `확인된 ${label}가 없습니다.` };
  }
  // OBSERVED_FRESH / OBSERVED_FRESHNESS_UNPROVEN. A finished run gives a number, and the verb has to
  // match what the number counts: `successRows` is what THIS run brought in, not what the channel
  // holds. Read on a first connection those are the same thing; read again a week later they are not,
  // and 「문의 0건을 확인했습니다」 appeared on a completion screen for an org holding two of them
  // (observed, Demo Org, 2026-08-27). 「가져왔습니다」 is true in both readings.
  if (run) {
    if (run.successRows > 0) {
      return { ...base, tone: "collected", count: run.successRows, sentence: `${label} ${run.successRows}건을 가져왔습니다.` };
    }
    // A finished run that brought nothing back. That is a fact about the collection, not about the
    // shop — it may not become 「문의가 없습니다」, which is a claim only ZERO gets to make.
    return { ...base, tone: "empty", count: 0, sentence: `새로 가져온 ${label}는 없습니다.` };
  }
  return { ...base, tone: "pending", count: null, sentence: `${label}는 아직 확인하지 못했습니다.` };
}

/**
 * The lines for one channel, in reading order.
 *
 * @param coverage every coverage row this org has (the endpoint returns all visible channels)
 * @param runs sync runs for the account just connected — the only source of a printed number
 * @param channelCode which channel this summary is about
 */
export function sourceSummaryLines(
  coverage: readonly ChannelCoverageRowView[],
  runs: readonly SyncRunView[],
  channelCode: string,
): SourceSummaryLine[] {
  const byType = new Map<string, ChannelCoverageRowView>();
  for (const row of coverage) {
    if (row.channelCode === channelCode) byType.set(row.dataType, row);
  }
  const out: SourceSummaryLine[] = [];
  for (const dataType of SUMMARY_DATA_TYPES) {
    const row = byType.get(dataType);
    if (!row) continue; // the backend did not describe this type; inventing a line would invent a fact
    out.push(lineFor(row, terminalRun(runs, dataType)));
  }
  return out;
}

/**
 * The one sentence over the lines.
 *
 * <p>Arithmetic over the lines below it, never a claim of its own — and it never adds two counts
 * together: 「문의 22」 and 「리뷰 133」 are two facts, and 「155건」 is a third one nobody read.
 */
export function sourceSummaryHeadline(channelNameKo: string, lines: readonly SourceSummaryLine[]): string {
  const collected = lines.filter((line) => line.tone === "collected");
  if (collected.length > 0) {
    return `${channelNameKo}에서 다음 정보를 가져왔습니다.`;
  }
  if (lines.some((line) => line.tone === "blocked")) {
    return `${channelNameKo} 연결은 되었지만, 아직 가져오지 못한 정보가 있습니다.`;
  }
  return `${channelNameKo} 연결이 완료되었습니다. 정보는 순서대로 확인합니다.`;
}
