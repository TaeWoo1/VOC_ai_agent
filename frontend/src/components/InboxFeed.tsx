import { EmptyState } from "./EmptyState";
import { relativeTime } from "../lib/format";
import { nextAction, type ActionTone } from "../lib/inboxView";
import type { FeedItem } from "../lib/types";

const ACTION_CLASS: Record<ActionTone, string> = {
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  muted: "bg-canvas text-muted",
};

/** The integrated-inbox card list. Read-only and presentational: it renders only
 *  the fields the backend returns (snippet is already PII-masked there) and never
 *  shows the author. No links/buttons — this slice has no detail route or status
 *  mutation; the action label is a visual hint only. */
export function InboxFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <EmptyState message="해당 조건의 항목이 없습니다." />;
  }
  return (
    <ul className="space-y-3">
      {items.map((it, i) => {
        const action = nextAction(it);
        return (
          <li key={i} className="rounded-xl bg-canvas px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-base text-muted">
              <span
                className={`rounded-lg px-2 py-0.5 text-sm font-semibold ${
                  it.type === "INQUIRY"
                    ? "bg-brand/10 text-brand-700"
                    : "bg-ink/5 text-ink"
                }`}
              >
                {it.type === "INQUIRY" ? "문의" : "리뷰"}
              </span>
              <span>{it.channelNameKo}</span>
              <span aria-hidden>·</span>
              <span className="font-medium text-ink">{it.productName}</span>
              {it.type === "REVIEW" && it.rating != null ? (
                <span className="rounded bg-ink/5 px-1.5 text-sm text-ink">
                  ★{it.rating}
                </span>
              ) : null}
              {it.status === "UNANSWERED" ? (
                <span className="rounded bg-warn/10 px-1.5 text-sm text-warn">
                  미답변
                </span>
              ) : null}
              {it.status === "NEGATIVE" ? (
                <span className="rounded bg-bad/10 px-1.5 text-sm text-bad">
                  부정
                </span>
              ) : null}
            </div>

            <p className="mt-2 text-lg leading-relaxed text-ink">{it.snippet}</p>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span
                className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${ACTION_CLASS[action.tone]}`}
              >
                {action.label}
              </span>
              <span className="shrink-0 text-sm text-muted">
                {relativeTime(it.receivedAt)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
