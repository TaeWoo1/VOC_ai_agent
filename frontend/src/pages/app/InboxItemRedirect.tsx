import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../../lib/apiClient";
import { reviewAccounts } from "../../lib/reviewAccounts";
import { reviewDetailPath } from "../../lib/todayInbox";

/**
 * `/inbox/:itemRef` — the mixed 문의+리뷰 queue no longer has a screen of its own (product assembly
 * A2: reviews live on 리뷰, inquiries on 문의). Old deep links — memory evidence quotes, reports,
 * bookmarks — still arrive here, so this resolves the row to the surface that now owns it:
 *
 *   INQUIRY → /inquiries/:id
 *   REVIEW  → /reviews/:accountId?review=:id, the account resolved from the row's channel
 *
 * When the row cannot be found or resolved it lands on 문의 (the closer surface for an unknown
 * item) rather than a dead end. Nothing here is a screen; a reader only ever sees "불러오는 중…".
 */
export function InboxItemRedirect() {
  const { itemRef = "" } = useParams();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.getInboxStrict(), api.getSellerAccountsStrict(), api.getChannelsStrict()])
      .then(([inbox, accounts, channels]) => {
        if (!active) return;
        const item =
          inbox.status === "fulfilled" ? inbox.value.items.find((row) => row.id === itemRef) : undefined;
        if (!item) {
          setTarget("/inquiries");
          return;
        }
        if (item.type === "INQUIRY") {
          setTarget(`/inquiries/${item.id}`);
          return;
        }
        const targets = reviewAccounts(
          accounts.status === "fulfilled" ? accounts.value : null,
          channels.status === "fulfilled" ? channels.value : null,
        );
        const owner = targets.find((t) => t.channel.id === item.channelId);
        setTarget(owner ? reviewDetailPath(owner.account.id, item.id) : "/reviews");
      });
    return () => {
      active = false;
    };
  }, [itemRef]);

  if (target === null) {
    return <p className="text-muted">불러오는 중…</p>;
  }
  return <Navigate to={target} replace />;
}
