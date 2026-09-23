import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ReasonIcon, ReasonTone } from "../../lib/copy/customerOps";

/**
 * One thing waiting for the seller: why (tag + icon tile), where from, what, the one line Reviewnary adds, how long
 * it has waited, and the verb.
 *
 * <b>One interactive element per row.</b> The whole row is the link; the verb at its end is drawn as a button but is
 * not a second control — two links to the same place would be read out twice and tabbed through twice.
 * A row with `action` instead of `to` (the 지식 inbox, whose editor opens in place) renders its controls there.
 */
const TILE: Record<ReasonTone, string> = {
  amber: "bg-[#FFF3E4] text-[#B45309]",
  blue: "bg-brand-50 text-brand-700",
  gray: "bg-[#F1F3F5] text-muted",
};

const TAG: Record<ReasonTone, string> = {
  amber: "bg-[#FFF3E4] text-warn",
  blue: "bg-brand-50 text-brand-700",
  gray: "bg-[#F1F3F5] text-muted",
};

export function DecisionRow({
  tone,
  icon,
  tag,
  source,
  title,
  line,
  wait,
  verb,
  primary = false,
  to,
  state,
  action,
  children,
  selected = false,
  dense = false,
}: {
  tone: ReasonTone;
  icon: ReasonIcon;
  tag: string;
  source?: string | null;
  title: string;
  line?: string | null;
  wait?: string | null;
  verb?: string;
  primary?: boolean;
  to?: string;
  state?: unknown;
  /** Controls drawn in place of a link (a row whose work happens on this screen). */
  action?: ReactNode;
  /** Opened below the row — an inline editor. */
  children?: ReactNode;
  /**
   * The row whose detail stands in the master-detail pane. A selectable list passes no `verb`: the row IS the
   * control, and the one primary action lives in the detail (UI/UX v2 Phase 1).
   */
  selected?: boolean;
  /**
   * <b>Two lines instead of three</b>, for a list long enough that scrolling it is the work (Review
   * Decision UX v3.2). The tag moves onto the title's line and 「어디서」 joins 「무엇을 덧붙였나」 under it.
   *
   * <p><b>Nothing is dropped.</b> The same five facts are drawn in the same order, and a row that has no
   * `line` still says where it came from. Measured on 확인할 일 (45 rows): 108px → 80px a row, 5,407 →
   * 4,146px of list. Rows that open an editor in place (the 지식 받은함) keep the three-line reading,
   * where the extra air is the point.
   */
  dense?: boolean;
}) {
  const body = (
    <>
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] ${TILE[tone]}`}>
        <Icon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        {dense ? (
          <>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`shrink-0 rounded-md px-1.5 py-px text-xs font-semibold ${TAG[tone]}`}>{tag}</span>
              <span className="min-w-0 break-keep text-base font-bold leading-snug tracking-tight text-ink [overflow-wrap:anywhere]">
                {title}
              </span>
            </span>
            {source || line ? (
              <span className="mt-1 block truncate text-sm text-muted">
                {source && line ? `${source} · ${line}` : (source ?? line)}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className={`rounded-md px-1.5 py-px text-xs font-semibold ${TAG[tone]}`}>{tag}</span>
              {source ? <span>{source}</span> : null}
            </span>
            <span className="mt-1 block break-keep text-base font-bold leading-snug tracking-tight text-ink [overflow-wrap:anywhere]">
              {title}
            </span>
            {line ? <span className="mt-0.5 block truncate text-sm text-muted">{line}</span> : null}
          </>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2 self-center">
        {wait ? <span className="whitespace-nowrap text-sm tabular-nums text-muted">{wait}</span> : null}
        {verb && to ? (
          <span
            className={`inline-flex min-h-[36px] items-center rounded-lg px-3.5 text-sm font-semibold ${
              primary ? "bg-brand-700 text-white group-hover:bg-brand-800" : "border border-line bg-surface text-ink group-hover:bg-canvas"
            }`}
          >
            {verb}
          </span>
        ) : null}
        {action}
      </span>
    </>
  );

  return (
    <li className="[&+&]:border-t [&+&]:border-[#EEF0F3]">
      {to ? (
        <Link
          to={to}
          state={state}
          aria-current={selected ? "true" : undefined}
          className={`group flex items-start gap-3.5 px-5 ${dense ? "py-3" : "py-4"} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700 ${
            selected ? "bg-brand-50 shadow-[inset_3px_0_0_#1B64DA]" : "hover:bg-[#FAFBFC]"
          }`}
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-3.5 px-5 py-4">{body}</div>
      )}
      {children ? <div className="px-5 pb-4 sm:pl-[74px]">{children}</div> : null}
    </li>
  );
}

export function DecisionList({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <ul aria-label={ariaLabel} className="overflow-hidden rounded-[14px] bg-surface shadow-[0_0_0_1px_#E4E7EC]">
      {children}
    </ul>
  );
}

function Icon({ name }: { name: ReasonIcon }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]">
      {name === "box" ? <path {...common} d="M4 7h16v12H4z M4 7l2-3h12l2 3 M9 12h6" /> : null}
      {name === "question" ? (
        <>
          <circle {...common} cx="12" cy="12" r="9" />
          <path {...common} d="M9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.1-1.5 2.2 M12 17h.01" />
        </>
      ) : null}
      {name === "star" ? <path {...common} d="M12 4l2.4 5 5.6.7-4 3.8 1 5.5-5-2.7-5 2.7 1-5.5-4-3.8 5.6-.7z" /> : null}
      {name === "chat" ? <path {...common} d="M4 5h16v11H8l-4 4z" /> : null}
      {name === "scale" ? <path {...common} d="M12 4v16 M6 20h12 M5 8h14 M5 8l-2.5 6a3 3 0 005 0z M19 8l-2.5 6a3 3 0 005 0z" /> : null}
    </svg>
  );
}
