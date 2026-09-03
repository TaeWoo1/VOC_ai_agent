import { Fragment } from "react";
import type { FeedItem } from "../../lib/types";
import { TYPE_LABEL, needsCheck, needsReply } from "../../lib/inboxWorkspace";
import { relativeTime } from "../../lib/format";
import { elapsedSince } from "../../lib/elapsed";
import { previewText } from "../../lib/plainText";
import { WorkItem } from "../ui/WorkItem";
import type { StatusTone } from "../ui/Status";
import { WORK_STATE } from "../../lib/workState";

/**
 * The one state word a row carries — work-state first (docs/reviewnary_design.md §7 문의).
 *
 * Every word comes from `lib/workState.ts`, the product's single work vocabulary, and every one of
 * them names a fact this row was actually told.
 *
 * <b>초안 준비됨 is a draft, not a phase.</b> It used to be read off the work item's lifecycle phase
 * (`PROPOSED`), which is written when a PROPOSAL is recorded — and an `InquiryProposal` stores no
 * reply text at all, by its own contract. On 2026-09-04 the demo org held ten such rows and eight of
 * them had no draft: the list was telling the seller to go read something nobody had written. It now
 * reads `hasDraft`, the fact the queue reports. A `PROPOSED` row with no draft is simply what it
 * always was — an inquiry the customer has not been answered.
 */
export function rowState(item: FeedItem, hasDraft: boolean): { text: string; tone: StatusTone } | null {
  if (item.type === "INQUIRY" && hasDraft && needsReply(item)) {
    return WORK_STATE.DRAFT_READY;
  }
  if (needsReply(item)) {
    return WORK_STATE.REPLY_NEEDED;
  }
  if (needsCheck(item)) {
    return WORK_STATE.NEEDS_LOOK;
  }
  if (item.type === "INQUIRY" && item.status === "ANSWERED") {
    return WORK_STATE.ANSWERED;
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
  drafted,
  dense = false,
}: {
  items: readonly FeedItem[];
  selectedId: string | null;
  basePath?: string;
  search?: string;
  showType?: boolean;
  /** Inquiry ids the queue read reported an actual draft for. Absent read ⇒ no row claims one. */
  drafted?: ReadonlySet<string>;
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
    const state = rowState(item, drafted?.has(item.id) ?? false);
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
      {rest.length > 0 ? (
        <Fragment>
          {/* The boundary between the work and the record. Everything above is waiting on the seller;
              everything below is here to be looked up. Without this line the two ran together — an
              answered inquiry sat at full weight directly under the oldest unanswered one, and the
              22 the page counted at the top dissolved into a list of 50. Same divider idiom as the
              backlog above it: not a heading, so the detail pane's h2 stays the only one. */}
          <li aria-hidden="true" className="bg-canvas px-4 py-1.5 text-xs font-semibold text-muted">
            {showType ? "지난 기록" : "답변한 문의"} {rest.length}건
          </li>
          {rest.map((item) => render(item, true))}
        </Fragment>
      ) : null}
    </ul>
  );
}
