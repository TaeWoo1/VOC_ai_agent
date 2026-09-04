import { Children, Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * A row of an object list (docs/reviewnary_design.md §6, §7): name → facet line → one action.
 *
 * Products, channels and settings entries are objects, not records: the seller recognises them by name
 * and decides by the facets (`NAVER · 문의 12 · 리뷰 133`), so the name is the largest text and the
 * facets are one `sm` line under it. The action is one control, on the right; the whole row is a link
 * when `to` is given.
 */
export function ObjectRow({
  name,
  facets,
  status,
  action,
  to,
  ariaLabel,
  onClick,
}: {
  name: ReactNode;
  facets?: ReactNode;
  /** A `Status` chip beside the name. */
  status?: ReactNode;
  action?: ReactNode;
  to?: string;
  ariaLabel?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-keep text-base font-semibold text-ink">{name}</span>
          {status}
        </div>
        {facets ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted">{facets}</div>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </>
  );
  const shell = "flex items-center gap-4 px-4 py-3";
  if (to) {
    return (
      <Link
        to={to}
        aria-label={ariaLabel}
        onClick={onClick}
        className={`${shell} transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700`}
      >
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/** `문의 12` — a facet: label then number, the number in ink. */
export function Facet({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      {label} <span className="font-semibold tabular-nums text-ink">{value}</span>
    </span>
  );
}

/** The dot between facets. */
export function Dot() {
  // A drawn dot, not a text glyph: a "·" in `line` colour is a text node that fails AA on its own.
  return <span aria-hidden="true" className="inline-block h-[3px] w-[3px] rounded-full bg-muted/50 align-middle" />;
}

/**
 * A run of facts on one line, separated by the product's dot.
 *
 * <b>Why this exists.</b> The same shape — several unrelated facts about one object, on one muted line
 * — is drawn on the product row, the review record header, the knowledge source row, the home brief row
 * and the reply-task header. Three of those printed the facts with nothing between them, so the seller
 * read 「총 4432개 마지막 수집 시각 기록 없음 답변은 여기서 준비하고…」 as one grey sentence. The ones that
 * did separate them had to render the dot conditionally beside every optional fact, which is exactly why
 * the others did not bother.
 *
 * `Children.toArray` drops `null` and `false`, so an absent fact takes its separator with it and the
 * caller writes the facts, not the punctuation between them.
 */
export function Facts({ children, className = "" }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children);
  return (
    <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${className}`}>
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? <Dot /> : null}
          {child}
        </Fragment>
      ))}
    </span>
  );
}
