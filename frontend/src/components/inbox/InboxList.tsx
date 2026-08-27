import { Fragment } from "react";
import type { FeedItem } from "../../lib/types";
import { TYPE_LABEL, needsCheck, needsReply } from "../../lib/inboxWorkspace";
import { relativeTime } from "../../lib/format";
import { elapsedSince } from "../../lib/elapsed";
import { previewText } from "../../lib/plainText";
import { WorkItem } from "../ui/WorkItem";
import type { StatusTone } from "../ui/Status";

/**
 * The one state word a row carries — work-state first (docs/reviewnary_design.md §7 문의).
 *
 * `초안 준비됨` comes from the work-item phase the queue read reports (PROPOSED); `답변 필요` and
 * `답변함` from the feed's own status; `확인 필요` is a review condition. Never a computed urgency.
 */
export function rowState(item: FeedItem, phase: string | null): { text: string; tone: StatusTone } | null {
  if (item.type === "INQUIRY" && phase === "PROPOSED") {
    return { text: "초안 준비됨", tone: "info" };
  }
  if (needsReply(item)) {
    return { text: "답변 필요", tone: "warn" };
  }
  if (needsCheck(item)) {
    return { text: "확인 필요", tone: "bad" };
  }
  if (item.type === "INQUIRY" && item.status === "ANSWERED") {
    return { text: "답변함", tone: "neutral" };
  }
  return null;
}

/** Older than a year: real, still open, and not this morning's work. */
export function isOldBacklog(item: FeedItem, now = new Date()): boolean {
  return elapsedSince(item.receivedAt, now)?.unit === "overYear";
}

/**
 * Priority-ordered row list. Every piece of metadata on a row comes from a field the server sent.
 *
 * <b>Old backlog sits under its own quiet divider.</b> This org's Cafe24 backlog reaches back a decade
 * and, sorted worst-first, a 2014 question wore the same weight as one from an hour ago. The rows are
 * still there and still 답변 필요; they are grouped after the recent ones and drawn in `muted`. The
 * divider is not a heading — the detail pane's `h2` stays the only one.
 */
export function InboxList({
  items,
  selectedId,
  basePath = "/inbox",
  search = "",
  showType = true,
  phases,
  dense = false,
}: {
  items: readonly FeedItem[];
  selectedId: string | null;
  basePath?: string;
  search?: string;
  showType?: boolean;
  /** Work-item phase per inquiry id, when the queue read succeeded. */
  phases?: ReadonlyMap<string, string>;
  /** The 340px rail beside an open row: the product name is in the detail, so the row drops it. */
  dense?: boolean;
}) {
  // Work-state first, then age: open work that is recent → open work older than a year (under its
  // own divider) → everything else in the order it arrived. An old 답변 필요 never outranks a recent
  // one, and never sinks below rows that need nothing.
  const isOpen = (item: FeedItem) => needsReply(item) || needsCheck(item);
  const recent = items.filter((item) => isOpen(item) && !isOldBacklog(item));
  const old = items.filter((item) => isOpen(item) && isOldBacklog(item));
  const rest = items.filter((item) => !isOpen(item));
  const render = (item: FeedItem, dim: boolean) => {
    const state = rowState(item, phases?.get(item.id) ?? null);
    const selected = item.id === selectedId;
    return (
      <li key={`${item.type}:${item.id}`}>
        <WorkItem
          to={`${basePath}/${item.id}${search}`}
          ariaCurrent={selected ? "true" : undefined}
          selected={selected}
          dim={dim}
          state={state?.text ?? null}
          tone={state?.tone ?? "neutral"}
          title={previewText(item.snippet) || (item.type === "INQUIRY" ? "문의" : "리뷰")}
          meta={
            <>
              {showType ? `${TYPE_LABEL[item.type]} · ` : ""}
              {item.channelNameKo}
              {!dense && item.productName && item.productName !== "상품 미지정" ? ` · ${item.productName}` : ""}
              {item.rating != null ? ` · 별점 ${item.rating}` : ""}
            </>
          }
          time={relativeTime(item.receivedAt)}
        />
      </li>
    );
  };
  return (
    <ul aria-label={showType ? "고객 문의·리뷰 목록" : "문의 목록"} className="divide-y divide-line/70">
      {recent.map((item) => render(item, false))}
      {old.length > 0 ? (
        <Fragment>
          <li aria-hidden="true" className="bg-canvas px-4 py-1.5 text-xs font-semibold text-muted">
            1년 넘게 지난 답변 필요 문의 {old.length}건
          </li>
          {old.map((item) => render(item, true))}
        </Fragment>
      ) : null}
      {rest.map((item) => render(item, false))}
    </ul>
  );
}
