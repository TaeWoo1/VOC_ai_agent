// Which connected account's worklist the operations home should show.
//
// Pure: no React, no I/O. The 0 / 1 / many decision is the whole product judgement in this slice,
// so it lives here where it can be asserted without a DOM.
//
// Deliberately NOT review-specific — neither the name nor the shape. The surface it feeds
// (`AttentionSignalList`) is channel-generic and already renders inquiry signals
// (UNANSWERED_INQUIRY, UNKNOWN_REPLY_STATUS) alongside review ones, so an inquiry worklist needs
// nothing added here. Naming this "review accounts" would have made that a rewrite later.

import type { SellerAccountResponse } from "./types";

/** One selectable account, reduced to what a chooser needs. */
export interface WorklistAccount {
  id: string;
  /** Operator-facing name: the seller's own alias when they set one, else the channel. */
  label: string;
}

export type WorklistAccountResolution =
  | { kind: "none" }
  | { kind: "single"; account: WorklistAccount }
  | { kind: "choose"; accounts: WorklistAccount[] };

/**
 * Resolve the accounts whose worklist can be shown.
 *
 * <p><b>No capability filter, deliberately.</b> This does not try to decide which channels have a
 * worklist — that answer lives server-side in the VOC source registry, and a channel with no source
 * already resolves to an honest empty state. Encoding a channel list here would duplicate a product
 * decision the frontend has no business holding, and would silently exclude any channel added later.
 *
 * <p><b>Never infers a choice.</b> With more than one account this returns {@code choose} carrying
 * no selection. That is not caution for its own sake: `reviews` has no `seller_account_id`, so the
 * backend REFUSES to attribute reviews per-account when an org holds several on one channel and
 * returns an empty snapshot instead. Picking one here would present that account's view as the
 * seller's whole worklist — exactly the inference the server declines to make, rendered on the
 * seller's main page.
 *
 * <p>{@code single} is not an inference: with one account there is nothing to choose between. The UI
 * still names it, so the rows are never ambiguous about whose they are.
 */
export function resolveWorklistAccounts(
  accounts: readonly SellerAccountResponse[],
): WorklistAccountResolution {
  const resolved: WorklistAccount[] = accounts
    .map((a) => ({ id: a.id, label: accountLabel(a) }))
    // Stable order, so a chooser does not reshuffle between reads and the seller can build a habit
    // of where each account sits. Ties break on id, which is total.
    .sort((a, b) => a.label.localeCompare(b.label, "ko-KR") || a.id.localeCompare(b.id));

  if (resolved.length === 0) {
    return { kind: "none" };
  }
  if (resolved.length === 1) {
    return { kind: "single", account: resolved[0] };
  }
  return { kind: "choose", accounts: resolved };
}

/**
 * The account's operator-facing name.
 *
 * <p>The seller's own alias wins — they named it to tell two accounts apart, which is exactly the
 * situation a chooser exists for. A blank alias falls back to the channel name rather than rendering
 * an empty button. Never the raw id: it names nothing a seller recognises.
 */
export function accountLabel(account: SellerAccountResponse): string {
  const alias = account.alias?.trim();
  return alias != null && alias !== "" ? alias : account.channelNameKo;
}
