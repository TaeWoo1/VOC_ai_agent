import type { ChannelDataState, ChannelMetricRow } from "./types";

/**
 * **What kind of morning is this?** — the home's first-use state, derived from the numbers the page
 * already has (Agent Object + First-use Closure v1 §2).
 *
 * <b>Three states, because 「지금 먼저 확인할 일은 없습니다」 is true in one of them and a lie in the
 * other two.</b> A seller who has connected nothing has no work because nothing has been read; a
 * seller who connected this morning has no work because the first collection has not landed yet; a
 * seller with a quiet day genuinely has none. The same sentence for all three tells the first two that
 * the product is working when it has not started.
 *
 * <b>Derived, never fetched.</b> `metrics.channels` is already on the page and is rendered six inches
 * below; a second read could disagree with the table under it. `NOT_SUPPORTED` is not "not connected"
 * (`firstConnectionState.ts` explains why) and is not counted as a missing collection either — a
 * channel this product has no review path for is not a channel waiting to deliver reviews.
 */
export type HomeFirstUseKind =
  /** No channel is connected: the only thing to do is connect one. */
  | "NO_CHANNEL"
  /** Connected, and this org holds nothing yet — either not collected, or collected and empty. */
  | "NO_DATA"
  /** There are rows. Whether any of them need work is the brief's question, not this one's. */
  | "WORKING";

export interface HomeFirstUseState {
  readonly kind: HomeFirstUseKind;
  /** The connected channels, by the seller's own name for them. Empty in `NO_CHANNEL`. */
  readonly connected: readonly string[];
  /**
   * Whether any connected channel's collection has actually RUN (a state of `OBSERVED_FRESH` or
   * `ZERO`). It splits the two halves of `NO_DATA` — 「아직 가져오는 중」 from 「가져왔지만 아무것도 없다」
   * — and those are different sentences: only one of them is a fact about the seller's store.
   */
  readonly observed: boolean;
  /** What can be delegated once these channels are connected — data types this product actually collects. */
  readonly delegable: readonly ("ORDER" | "INQUIRY" | "REVIEW")[];
}

const SILENT: ReadonlySet<ChannelDataState> = new Set<ChannelDataState>(["NOT_CONNECTED", "NOT_SUPPORTED"]);
const OBSERVED: ReadonlySet<ChannelDataState> = new Set<ChannelDataState>(["OBSERVED_FRESH", "ZERO"]);

/** The three data types of one row, paired with the label the seller reads. */
function typesOf(row: ChannelMetricRow): ReadonlyArray<{ type: "ORDER" | "INQUIRY" | "REVIEW"; state: ChannelDataState; count: number }> {
  return [
    { type: "ORDER", state: row.orderState, count: row.orders },
    { type: "INQUIRY", state: row.inquiryState, count: row.inquiries },
    { type: "REVIEW", state: row.reviewState, count: row.reviews },
  ];
}

export function homeFirstUseState(rows: readonly ChannelMetricRow[]): HomeFirstUseState {
  const connectedRows = rows.filter((row) => typesOf(row).some((t) => !SILENT.has(t.state)));
  // What this product can take off the seller's hands, across every channel on the table — a data type
  // is delegable when at least one channel offers a path for it. Never a written list: a channel whose
  // review collection this product does not have must not appear as a review promise.
  const delegable = (["ORDER", "INQUIRY", "REVIEW"] as const).filter((type) =>
    rows.some((row) => typesOf(row).some((t) => t.type === type && t.state !== "NOT_SUPPORTED")));
  if (connectedRows.length === 0) {
    return { kind: "NO_CHANNEL", connected: [], observed: false, delegable };
  }
  const connected = connectedRows.map((row) => row.channelNameKo || row.channelCode);
  /**
   * **Holding records is holding data, whenever they arrived.**
   *
   * The window counts are a 7-day flow; `unansweredInquiries` is the backlog, windowless. An org whose
   * inquiries are all older than the window read as 「아직 아무것도 없습니다 · 첫 수집이 끝나면…」 while it
   * held three of them — the product telling a seller it had not started on data it already had. The two
   * measures are not added (they count different things); either one being non-zero is enough to say the
   * shop is not empty.
   */
  const held = connectedRows.some((row) =>
    typesOf(row).some((t) => !SILENT.has(t.state) && t.count > 0)
    || (!SILENT.has(row.inquiryState) && (row.unansweredInquiries ?? 0) > 0));
  const observed = connectedRows.some((row) => typesOf(row).some((t) => OBSERVED.has(t.state)));
  return { kind: held ? "WORKING" : "NO_DATA", connected, observed, delegable };
}

/** The seller's word for each data type — what they would say they are handing over. */
export const DELEGABLE_WORD: Record<"ORDER" | "INQUIRY" | "REVIEW", string> = {
  ORDER: "주문", INQUIRY: "문의", REVIEW: "리뷰",
};

/** 「주문 · 문의 · 리뷰를 대신 확인해 드립니다.」 — built from what the channels on this table actually offer. */
export function delegableSentence(state: HomeFirstUseState): string {
  const words = state.delegable.map((t) => DELEGABLE_WORD[t]);
  return words.length > 0
    ? `채널을 연결하시면 ${words.join(" · ")}를 대신 확인하고, 먼저 봐야 할 일을 여기에 정리해 두겠습니다.`
    : "채널을 연결하시면 매일 확인할 일을 여기에 정리해 두겠습니다.";
}

/**
 * The connected-but-empty morning, in one sentence.
 *
 * The two halves are different claims and the state keeps them apart: a collection that has not been
 * observed yet cannot say the store is quiet, and one that has run and returned nothing must not
 * suggest the product is still starting up.
 */
export function noDataSentence(state: HomeFirstUseState): string {
  const names = state.connected.join(" · ");
  return state.observed
    ? `${names} 연결은 끝났고, 아직 들어온 주문·문의·리뷰가 없습니다. 새로 들어오면 여기에 먼저 정리해 두겠습니다.`
    : `${names} 연결은 끝났습니다. 첫 수집이 끝나면 확인할 일을 여기에 정리해 두겠습니다.`;
}
