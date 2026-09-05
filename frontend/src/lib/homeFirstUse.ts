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
  /**
   * Channels on this seller's own table that are not connected yet — the actual options behind
   * 「어디를 연결하지?」. Derived, so a channel this product cannot connect is never offered and one it
   * can is never left out by hand.
   */
  readonly connectable: readonly string[];
}

const SILENT: ReadonlySet<ChannelDataState> = new Set<ChannelDataState>(["NOT_CONNECTED", "NOT_SUPPORTED"]);

/**
 * **Has this seller connected anything yet?** — the same question {@link homeFirstUseState} already
 * answers, asked by the callers that only need the boolean (Agent Procedure Layer v1 §3).
 *
 * It used to live in `firstConnectionState.ts` with its own copy of the predicate. Two files deciding
 * «is anything connected» from the same rows is one rule that can drift, and this one had already
 * started to: the copy read the three state fields directly while this module reads them through
 * {@link typesOf}. One derivation now, two names.
 *
 * <b>Two states mean "nothing is arriving from here", and only one of them is about connection.</b>
 * `NOT_CONNECTED` is the seller not having connected the channel; `NOT_SUPPORTED` is this product
 * having no collection path for that data type at all (NAVER reviews, Coupang reviews — both true on a
 * fully connected account). Absence of rows is not proof of absence of connections: an empty list
 * answers `false` only because a page with no channel table has no channel to speak for, and the caller
 * uses this to choose a colour — never to tell a seller their channels are disconnected.
 */
export function hasAnyConnectedChannel(rows: readonly ChannelMetricRow[]): boolean {
  return homeFirstUseState(rows).kind !== "NO_CHANNEL";
}
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
  const connectable = rows.filter((row) => !connectedRows.includes(row)).map((row) => row.channelNameKo || row.channelCode);
  if (connectedRows.length === 0) {
    return { kind: "NO_CHANNEL", connected: [], observed: false, delegable, connectable };
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
  return { kind: held ? "WORKING" : "NO_DATA", connected, observed, delegable, connectable };
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

/**
 * <b>What connecting actually gets them</b> — three steps, for someone who has never seen this product.
 *
 * The first-use screen used to be a headline, one sentence and a button: true, and it told a seller who
 * had just signed up nothing about what they were about to hand over or what happens after they press
 * it. These are the three things that happen, in order, and only the middle one is a promise — so it is
 * the only one derived from the table ({@link HomeFirstUseState.delegable}), never a written list.
 *
 * <b>The 도우미 is deliberately absent.</b> It matters for one channel's guided lanes; naming a program
 * to install in front of a seller who has not chosen a channel yet is a step they cannot take and an
 * obstacle where the product should be showing a path.
 */
export function firstUseSteps(state: HomeFirstUseState): ReadonlyArray<{ title: string; detail: string }> {
  const where = state.connectable.length > 0 ? state.connectable.join(" · ") : "쓰고 계신 판매 채널";
  return [
    { title: "1. 판매 채널 연결", detail: `${where} 중 쓰고 계신 곳을 고르시면, 채널별로 필요한 것만 순서대로 안내해 드립니다.` },
    // The WHAT is {@link delegableSentence}'s, said once, one line above these — a step that repeats
    // 「주문 · 문의 · 리뷰를 가져옵니다」 is that promise a second time in smaller type.
    { title: "2. 자동으로 가져오기", detail: "연결이 끝나면 reviewnary가 채널에서 직접 가져와서, 새로 들어오는 것까지 계속 확인합니다." },
    { title: "3. 먼저 하실 일 정리", detail: "그날 답해야 할 문의와 살펴볼 리뷰를 골라 두고, 답변 초안까지 준비해 둡니다. 보내는 것은 언제나 확인하신 뒤입니다." },
  ];
}
