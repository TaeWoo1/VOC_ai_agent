import type {
  ChannelCoverageRowView,
  HomePreparedWork,
  HomeRepeatedProblems,
  HomeReviewAttention,
} from "./types";

/**
 * What Operations Home is allowed to say about numbers it did not compute.
 *
 * <b>The rule this module exists to hold: urgency is never invented.</b> Every sentence below names
 * one population and says what happened to it. None adds two counts, ranks one area against another,
 * or turns a small number into an alarm. The failure this screen is most likely to have is not a
 * wrong figure — it is a true figure presented as a demand.
 */

/** 「지금 확인할 리뷰 N건」, or null when there is none and the area should stay quiet about work. */
export function reviewWorkLine(reviews: HomeReviewAttention): string {
  if (reviews.needsAttentionUndecided > 0) {
    return `아직 판단하지 않은 리뷰가 ${reviews.needsAttentionUndecided.toLocaleString("ko-KR")}건 있습니다.`;
  }
  if (reviews.needsAttentionTotal > 0) {
    // Everything in the tier has been decided. That is a finished state and it is worth saying so,
    // because silence here reads as 「읽지 못했다」.
    return "확인이 필요했던 리뷰는 모두 판단하셨습니다.";
  }
  return "지금 확인이 필요한 리뷰는 없습니다.";
}

/**
 * The observation line — 지켜보기, stated and never added to the work number.
 *
 * WATCH means 「if this keeps happening it is worth changing something」, which is the repeated-problem
 * lane's question rather than a request for a decision today. Returns null at zero: a 0 here is not a
 * finding, and a row saying 「지켜보는 리뷰 0건」 would be the screen filling space.
 */
export function watchLine(reviews: HomeReviewAttention): string | null {
  if (reviews.watchTotal <= 0) return null;
  return `지켜보는 리뷰가 ${reviews.watchTotal.toLocaleString("ko-KR")}건 있습니다. 같은 이야기가 쌓이면 반복 문제로 모입니다.`;
}

/**
 * 반복 문제, with 「내 차례인 것」과 「관찰 중인 것」을 나눈 문장.
 *
 * <b>관찰 중 is never phrased as pending work.</b> Measured on this org: 20 observed problems against
 * one that is anybody's move. A line reading 「반복 문제 20건」 beside a list of tasks would make twenty
 * observations look like twenty jobs.
 */
export function problemLine(problems: HomeRepeatedProblems): string {
  if (problems.decidable > 0) {
    return `지금 판단이 필요한 반복 문제가 ${problems.decidable.toLocaleString("ko-KR")}건 있습니다.`;
  }
  if (problems.observing > 0) {
    return `지금 판단이 필요한 반복 문제는 없습니다. ${problems.observing.toLocaleString("ko-KR")}건을 지켜보고 있습니다.`;
  }
  return "아직 모인 반복 문제가 없습니다.";
}

/** 준비된 작업, or null when nothing is prepared — this area never grows to fill the space. */
export function preparedLine(prepared: HomePreparedWork): string | null {
  const parts: string[] = [];
  if (prepared.reviewRepliesApproved > 0) {
    parts.push(`승인하신 리뷰 답변 ${prepared.reviewRepliesApproved.toLocaleString("ko-KR")}건`);
  }
  if (prepared.inquiryDraftsReady > 0) {
    parts.push(`초안이 준비된 문의 ${prepared.inquiryDraftsReady.toLocaleString("ko-KR")}건`);
  }
  // Deliberately joined with 「과」 rather than summed: 「4건」과 「2건」은 사실 둘이고, 「6건」은
  // 아무도 읽지 않은 셋째다.
  return parts.length === 0 ? null : `${parts.join(" · ")}이 기다리고 있습니다.`;
}

/** One channel's collection state on the Home. */
export interface CollectionLine {
  channelCode: string;
  channelNameKo: string;
  /** Seller-facing sentence about what was last collected, or why nothing can be said. */
  sentence: string;
  /** true when this row is worth a warning tone — a channel that cannot currently report. */
  warn: boolean;
}

const DATA_TYPE_ORDER = ["REVIEW", "INQUIRY", "ORDER_SUMMARY"];

/**
 * Collapse the coverage rows — three per channel — into one line per channel.
 *
 * <b>The freshness verdict is the server's; this only chooses which of the three rows speaks.</b> A
 * channel is described by its worst state, because a seller asking 「수집이 잘 되고 있나」 needs to hear
 * about the type that is not, and averaging three states would produce a fourth that nobody computed.
 *
 * <b>No provider technical name reaches the sentence.</b> The state words, the channel's Korean name
 * and a date are all it carries — never a connector class, a data-type token or an error code.
 */
export function collectionLines(rows: readonly ChannelCoverageRowView[]): CollectionLine[] {
  const byChannel = new Map<string, ChannelCoverageRowView[]>();
  for (const row of rows) {
    const list = byChannel.get(row.channelCode) ?? [];
    list.push(row);
    byChannel.set(row.channelCode, list);
  }

  const out: CollectionLine[] = [];
  for (const [channelCode, channelRows] of byChannel) {
    const named = channelRows.filter((row) => row.supported);
    if (named.length === 0) continue;
    const nameKo = channelRows[0].channelNameKo;

    if (named.every((row) => !row.connected)) {
      out.push({ channelCode, channelNameKo: nameKo, sentence: "아직 연결되지 않았습니다.", warn: false });
      continue;
    }

    const blocked = named.find((row) => row.state === "BLOCKED");
    if (blocked) {
      out.push({
        channelCode,
        channelNameKo: nameKo,
        sentence: "지금은 수집하지 못하고 있습니다. 연결 상태를 확인해 주세요.",
        warn: true,
      });
      continue;
    }

    // The newest successful collection across this channel's types. `lastSuccessfulSyncAt` is the
    // server's own field; the Home does not compute freshness from it, only reports it.
    const successes = named
      .map((row) => row.lastSuccessfulSyncAt)
      .filter((at): at is string => Boolean(at))
      .sort();
    const newest = successes.length > 0 ? successes[successes.length - 1] : undefined;

    const unproven = named.some((row) => row.state === "OBSERVED_FRESHNESS_UNPROVEN");
    if (!newest) {
      // Connected and nothing ever collected. Not a failure — and not a claim that the channel is
      // empty either, which only ZERO may say.
      out.push({
        channelCode,
        channelNameKo: nameKo,
        sentence: "아직 가져온 기록이 없습니다.",
        warn: false,
      });
      continue;
    }
    out.push({
      channelCode,
      channelNameKo: nameKo,
      sentence: unproven
        ? `마지막 수집 ${newest.slice(0, 10)} · 그 뒤로 최신 여부를 확인하지 못했습니다.`
        : `마지막 수집 ${newest.slice(0, 10)}`,
      warn: unproven,
    });
  }
  // Stable order so the list does not reshuffle between reads.
  out.sort((a, b) => DATA_TYPE_ORDER.indexOf(a.channelCode) - DATA_TYPE_ORDER.indexOf(b.channelCode)
    || a.channelNameKo.localeCompare(b.channelNameKo, "ko"));
  return out;
}

/**
 * Whether the Home has anything at all to put in its areas.
 *
 * Used to decide whether to draw the areas or leave the conversation alone. A Home that drew four
 * empty headings on a fresh account would be describing a product the seller has not started using.
 */
export function hasAnythingToShow(
  reviews: HomeReviewAttention,
  problems: HomeRepeatedProblems,
  prepared: HomePreparedWork,
  collection: readonly ChannelCoverageRowView[],
): boolean {
  return reviews.needsAttentionUndecided > 0
    || reviews.watchTotal > 0
    || problems.decidable > 0
    || problems.observing > 0
    || prepared.reviewRepliesApproved > 0
    || prepared.inquiryDraftsReady > 0
    || collection.some((row) => row.connected);
}
