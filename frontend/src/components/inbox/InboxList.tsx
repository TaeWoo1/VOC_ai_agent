import { Link } from "react-router-dom";
import type { FeedItem, ItemAnalysis } from "../../lib/types";
import { analysisKey } from "../../lib/inboxView";
import { TYPE_LABEL, itemTitle, needsCheck, needsReply } from "../../lib/inboxWorkspace";
import { relativeTime } from "../../lib/format";

/** The one status word a row is allowed to carry, or null when the data states nothing. */
function statusLabel(item: FeedItem): { text: string; cls: string } | null {
  if (needsReply(item)) {
    return { text: "답변 필요", cls: "bg-warn/10 text-warn" };
  }
  if (needsCheck(item)) {
    return { text: "확인 필요", cls: "bg-bad/10 text-bad" };
  }
  if (item.type === "INQUIRY" && item.status === "ANSWERED") {
    return { text: "답변함", cls: "bg-canvas text-muted" };
  }
  return null;
}

/**
 * Priority-ordered row list. Every piece of metadata on a row comes from a field the server sent —
 * there is no computed "urgency" badge, no unread dot, and no count that is not a real count.
 */
export function InboxList({
  items,
  analyses,
  selectedId,
  /** Where a row's link lives — `/inbox` for the mixed queue, `/inquiries` for the 문의 page. */
  basePath = "/inbox",
  /** Query string carried onto each row link (the surface's filters), so choosing a row keeps them. */
  search = "",
  /** Whether each row names its kind (문의 / 리뷰). Off on a single-kind surface, where the chip repeats the h1. */
  showType = true,
}: {
  items: readonly FeedItem[];
  analyses: Map<string, ItemAnalysis>;
  selectedId: string | null;
  basePath?: string;
  search?: string;
  showType?: boolean;
}) {
  return (
    <ul aria-label={showType ? "고객 문의·리뷰 목록" : "문의 목록"} className="divide-y divide-line">
      {items.map((item) => {
        const analysis = analyses.get(analysisKey(item.type, item.id));
        const status = statusLabel(item);
        const selected = item.id === selectedId;
        return (
          <li key={`${item.type}:${item.id}`}>
            <Link
              to={`${basePath}/${item.id}${search}`}
              aria-current={selected ? "true" : undefined}
              className={`block px-4 py-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700 ${
                selected ? "bg-brand-50" : "hover:bg-canvas"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {showType ? (
                  <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
                    {TYPE_LABEL[item.type]}
                  </span>
                ) : null}
                {status ? (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.cls}`}
                  >
                    {status.text}
                  </span>
                ) : null}
                {item.rating != null ? (
                  <span className="text-xs font-medium tabular-nums text-muted">
                    별점 {item.rating}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-xs text-muted">
                  {relativeTime(item.receivedAt)}
                </span>
              </div>

              <p className="mt-2 break-keep font-semibold text-ink">{itemTitle(item)}</p>
              <p className="mt-1 line-clamp-2 break-keep text-sm leading-relaxed text-muted">
                {item.snippet}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{item.channelNameKo}</span>
                {analysis ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{analysis.category}</span>
                  </>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
