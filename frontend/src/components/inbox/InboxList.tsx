import { Link } from "react-router-dom";
import type { FeedItem } from "../../lib/types";
import { TYPE_LABEL, needsCheck, needsReply } from "../../lib/inboxWorkspace";
import { relativeTime } from "../../lib/format";
import { previewText } from "../../lib/plainText";

/**
 * The one status word a row is allowed to carry, or null when the data states nothing.
 *
 * <b>It is a word, not a pill</b> (Executive-friendly UX Redesign v1). On the 문의 surface almost
 * every row is 답변 필요 — that is what the surface is for — so an orange pill in the first slot of
 * every row carried no information while taking the position the eye lands on first. The word stays
 * (removing it would make 답변함 mean something only by the absence of a colour, which fails for a
 * reader who cannot see the colour); it moved to the metadata line under the customer's sentence.
 */
function statusLabel(item: FeedItem): { text: string; cls: string } | null {
  if (needsReply(item)) {
    return { text: "답변 필요", cls: "font-semibold text-warn" };
  }
  if (needsCheck(item)) {
    return { text: "확인 필요", cls: "font-semibold text-bad" };
  }
  if (item.type === "INQUIRY" && item.status === "ANSWERED") {
    return { text: "답변함", cls: "text-muted" };
  }
  return null;
}

/**
 * Priority-ordered row list. Every piece of metadata on a row comes from a field the server sent —
 * there is no computed "urgency" badge, no unread dot, and no count that is not a real count.
 */
export function InboxList({
  items,
  selectedId,
  /** Where a row's link lives — `/inbox` for the mixed queue, `/inquiries` for the 문의 page. */
  basePath = "/inbox",
  /** Query string carried onto each row link (the surface's filters), so choosing a row keeps them. */
  search = "",
  /** Whether each row names its kind (문의 / 리뷰). Off on a single-kind surface, where the chip repeats the h1. */
  showType = true,
}: {
  items: readonly FeedItem[];
  selectedId: string | null;
  basePath?: string;
  search?: string;
  showType?: boolean;
}) {
  return (
    <ul aria-label={showType ? "고객 문의·리뷰 목록" : "문의 목록"} className="divide-y divide-line">
      {items.map((item) => {
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
              {/* THE CUSTOMER'S WORDS ARE THE ROW, and now they are also the FIRST thing in it
                  (Executive-friendly UX Redesign v1). The row used to open with a line of chips —
                  유형, 상태, 별점, 시각 — so the eye landed on 「답변 필요」 twenty-six times before
                  reaching a single question. Everything in that line is still here; it is under the
                  sentence it describes, where metadata belongs. */}
              <p className="line-clamp-2 break-keep font-semibold leading-snug text-ink">
                {previewText(item.snippet) || (item.type === "INQUIRY" ? "문의" : "리뷰")}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                {showType ? <span>{TYPE_LABEL[item.type]}</span> : null}
                {status ? <span className={status.cls}>{status.text}</span> : null}
                <span>{item.channelNameKo}</span>
                {item.rating != null ? <span className="tabular-nums">별점 {item.rating}</span> : null}
                {/* The product is NOT on the row (Executive-friendly UX Redesign v1). The server
                    sends 「상품 미지정」 as a display label rather than a null, and this org's Cafe24
                    backlog is largely unattributed — so it printed on row after row, three words of
                    the metadata line spent saying the same non-fact. The product is named in the
                    detail pane, where it is part of a decision rather than part of a list. */}
                <span className="ml-auto shrink-0">{relativeTime(item.receivedAt)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
