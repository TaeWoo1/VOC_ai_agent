/**
 * <b>Can this seller's question be answered from data at all?</b> — one derivation, from the read this
 * runtime already makes.
 *
 * <b>The defect this closes.</b> Measured live on a clean org (2026-09-05): 「뭐부터 하면 되냐고」 was
 * answered 「지금 먼저 하실 일은 없습니다」 with 문의 0 · 리뷰 0 beside it, on an organisation with ZERO
 * connected channels. Every number in that answer was arithmetically true and the answer was false: the
 * seller has exactly one thing to do and the product did not name it. The runtime was reading emptiness
 * as absence of WORK when it was absence of a SOURCE.
 *
 * <b>The rule was already written down and this lane was not honouring it.</b> {@code ChannelDataState}
 * says it in its own docblock: «`ZERO` is the scarcest value. It is the only one from which an answer may
 * say "없습니다"». The rows behind that answer were `NOT_CONNECTED`, which is a different claim.
 *
 * <b>Derived, never fetched twice, and never invented.</b> The facts come from
 * {@code GET /api/channels/coverage} — the same org-scoped read the capability answer already made and
 * the same one the home screen derives its first-use state from ({@code lib/homeFirstUse.ts}); the two
 * surfaces answer the same question with the same rule so they cannot disagree about whether a seller
 * has started. A read that FAILED is {@link SellerReadinessKind UNKNOWN}, and from UNKNOWN nothing is
 * claimed: telling a connected seller they have no channels is the one error they cannot check.
 */
import type { ChannelCoverageRow, ChannelDataState } from "../../spring/types";

export type SellerReadinessKind =
  /** The coverage read did not happen or failed. Claim nothing. */
  | "UNKNOWN"
  /** No channel is connected: nothing operational can be read, and there is exactly one next step. */
  | "NO_CHANNEL"
  /** Connected, and this org holds nothing yet — the first collection has not landed, or landed empty. */
  | "NO_DATA"
  /** There are rows. Whether any of them need work is a different question, asked elsewhere. */
  | "WORKING";

/** What this product collects, in the words a seller would use for handing it over. */
export type DelegableWork = "INQUIRY" | "REVIEW" | "ORDER";

export interface SellerReadiness {
  readonly kind: SellerReadinessKind;
  /** Connected channels, by the seller's own name for them. Empty unless connected. */
  readonly connected: readonly string[];
  /**
   * Channels this deployment offers that this org has NOT connected — the actual options behind
   * 「어떻게 시작해?」. Derived from the coverage table, so a channel this product cannot connect is
   * never offered and a channel it can is never left out of the sentence by hand.
   */
  readonly connectable: readonly string[];
  /**
   * What can be handed over once those channels are connected — a type is delegable when at least one
   * channel on this seller's own table offers a path for it. Never a written list: a channel with no
   * review path must not appear as a review promise.
   */
  readonly delegable: readonly DelegableWork[];
}

const WORK_OF: Record<string, DelegableWork> = { INQUIRY: "INQUIRY", REVIEW: "REVIEW", ORDER_SUMMARY: "ORDER" };

/** The order a seller's day runs in — the same order {@code AssistantCapability} says its domains in. */
const ORDER: readonly DelegableWork[] = ["INQUIRY", "REVIEW", "ORDER"];

export const DELEGABLE_WORD: Record<DelegableWork, string> = { INQUIRY: "문의", REVIEW: "리뷰", ORDER: "주문" };

/** A state that means this channel has no path for this type — not connected, or the channel has none. */
const SILENT: ReadonlySet<ChannelDataState> = new Set<ChannelDataState>(["NOT_CONNECTED", "NOT_SUPPORTED"]);

export const UNKNOWN_READINESS: SellerReadiness = { kind: "UNKNOWN", connected: [], connectable: [], delegable: [] };

/** `null` (the read failed, or was never made) is UNKNOWN — a state, not an empty store. */
export function sellerReadinessOf(rows: readonly ChannelCoverageRow[] | null): SellerReadiness {
  if (rows == null) return UNKNOWN_READINESS;
  const name = (r: ChannelCoverageRow) => r.channelNameKo ?? r.channelCode;
  const byName = (want: (r: ChannelCoverageRow) => boolean) =>
    [...new Map(rows.filter(want).map((r) => [r.channelCode, name(r)])).values()];

  // A type is delegable when SOME channel offers it — `supported` is the CHANNEL's declared capability,
  // which is true before anything is connected and is exactly what 「연결하시면 …해 드립니다」 promises.
  const delegable = ORDER.filter((w) => rows.some((r) => WORK_OF[r.dataType] === w && r.supported));

  const connected = byName((r) => r.connected);
  if (connected.length === 0) {
    // An empty coverage table is not proof that nothing can be connected; it is proof of nothing, and
    // this org still has one thing to do. `connectable` is then empty and the sentence does not name channels.
    return { kind: "NO_CHANNEL", connected: [], connectable: byName((r) => !r.connected && r.supported), delegable };
  }
  // Holding records is holding data, whenever they arrived: `rows` is the stored count and `openRows` the
  // backlog. Either being non-zero is enough to say this shop is not empty (`homeFirstUse.ts` names the
  // same hazard — an org whose inquiries all predate the window read as 「아직 아무것도 없습니다」).
  const held = rows.some((r) => r.connected && !SILENT.has(r.state) && (r.rows > 0 || (r.openRows ?? 0) > 0));
  return { kind: held ? "WORKING" : "NO_DATA", connected, connectable: byName((r) => !r.connected && r.supported), delegable };
}

/** 「문의 · 리뷰 · 주문」 — the types this seller's own channels offer, or null when none do. */
export function delegableWords(readiness: SellerReadiness): string | null {
  return readiness.delegable.length > 0 ? readiness.delegable.map((w) => DELEGABLE_WORD[w]).join(" · ") : null;
}
