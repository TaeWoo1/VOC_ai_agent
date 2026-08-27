import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Status, type StatusTone } from "./Status";

/**
 * A row of work (docs/reviewnary_design.md §6, §7).
 *
 * The shape of every queue: state word → the sentence the seller recognises the work by → a meta line
 * (channel · product) → time on the right, and optionally one action. The state is the FIRST thing in
 * the row because "what do I do with this" is the question a queue answers; the sentence is the largest
 * because it is what the seller recognises.
 *
 * It renders as a link when `to` is given (the whole row is the target, one tab stop), otherwise as a
 * plain row that can hold its own action.
 */
export function WorkItem({
  state,
  tone = "neutral",
  title,
  meta,
  time,
  to,
  action,
  selected = false,
  dim = false,
  ariaCurrent,
}: {
  state?: string | null;
  tone?: StatusTone;
  title: ReactNode;
  meta?: ReactNode;
  time?: ReactNode;
  to?: string;
  action?: ReactNode;
  selected?: boolean;
  /** An old or settled row: same information, quieter ink. */
  dim?: boolean;
  ariaCurrent?: "true" | "page";
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {state ? <Status tone={tone} variant="word">{state}</Status> : null}
          {meta ? <span className="break-keep text-sm text-muted">{meta}</span> : null}
        </div>
        <p className={`mt-0.5 line-clamp-2 break-keep text-base font-semibold leading-snug ${dim ? "text-muted" : "text-ink"}`}>
          {title}
        </p>
      </div>
      {time ? <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted">{time}</span> : null}
      {action ? <div className="shrink-0">{action}</div> : null}
    </>
  );
  const shell = `flex items-start gap-3 px-4 py-3 ${selected ? "bg-brand-50/70" : ""}`;
  if (to) {
    return (
      <Link
        to={to}
        aria-current={ariaCurrent}
        className={`${shell} transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700`}
      >
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
