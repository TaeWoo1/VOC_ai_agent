import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { reviewAccounts } from "../lib/reviewAccounts";
import type { ReviewSource } from "../lib/todayInbox";
import type { ChannelResponse, SellerAccountResponse } from "../lib/types";

/**
 * The one way the product counts "확인이 필요한 리뷰" outside the 리뷰 screen itself.
 *
 * Canonical definition (product assembly A3, `docs/product_assembly_ia_v1.md` §4a): a review needs
 * checking when its triage tier is NEEDS_ATTENTION — the rules tier, plus (org opted in) the AI
 * mark the server folds into the same final rank. The count is read from each review-capable
 * account's record under `tier=NEEDS_ATTENTION`, so it is the number that account's 리뷰 page shows
 * under the same filter. Home and Reports both read through here; neither keeps a rule of its own.
 *
 * Returns `undefined` while loading, `null` when the account/channel reads failed, else one source
 * per account (a source with `page: null` is an account whose read failed — fail-soft, named).
 */
export function useReviewAttention(previewSize = 3): ReviewSource[] | null | undefined {
  const [accounts, setAccounts] = useState<SellerAccountResponse[] | null | undefined>(undefined);
  const [channels, setChannels] = useState<ChannelResponse[] | null | undefined>(undefined);
  const [sources, setSources] = useState<ReviewSource[] | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void api
      .getSellerAccountsStrict()
      .then((list) => active && setAccounts(list))
      .catch(() => active && setAccounts(null));
    void api
      .getChannelsStrict()
      .then((list) => active && setChannels(list))
      .catch(() => active && setChannels(null));
    return () => {
      active = false;
    };
  }, []);

  const targets = useMemo(
    () => (accounts !== undefined && channels !== undefined ? reviewAccounts(accounts, channels) : null),
    [accounts, channels],
  );

  useEffect(() => {
    if (targets === null) {
      return;
    }
    if (accounts === null || channels === null) {
      setSources(null);
      return;
    }
    let cancelled = false;
    void Promise.allSettled(
      targets.map((target) =>
        api.getChannelReviewsStrict(target.account.id, {
          tier: "NEEDS_ATTENTION",
          sort: "attention",
          size: previewSize,
        }),
      ),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setSources(
        results.map((result, i) => ({
          account: targets[i],
          page: result.status === "fulfilled" ? result.value : null,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [targets, accounts, channels, previewSize]);

  return sources;
}
