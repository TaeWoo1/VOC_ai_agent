import type { ReactNode } from "react";

/**
 * A titled region of a page (docs/reviewnary_design.md §6).
 *
 * The title is an `h2` at body size, semibold, short and functional — 「먼저 볼 일」, 「숫자」 — with an
 * optional count and one action on the same line. It is NOT a card: the body decides whether it is a
 * list container, a metric row or a table. A page composed of sections has an outline; a page composed
 * of cards has wallpaper.
 */
export function Section({
  title,
  count,
  hint,
  action,
  children,
  ariaLabel,
  className = "",
}: {
  /**
   * Undefined when the caller's own control already prints this name — a fold whose summary IS the
   * title (Review Decision UX v3.2). The section keeps its accessible name from `ariaLabel`, which
   * becomes required in that reading.
   */
  title?: string;
  /** A number beside the title, muted — the size of what is under it. */
  count?: number | string | null;
  /** One short clause after the title. Present only when it changes what the numbers mean. */
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <section aria-label={ariaLabel ?? title} className={`space-y-3 ${className}`}>
      {title || action ? (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className={`break-keep text-base font-semibold text-ink ${title ? "" : "sr-only"}`}>
            {title ?? ariaLabel}
            {count !== undefined && count !== null ? (
              <span className="ml-1.5 font-semibold tabular-nums text-muted">{count}</span>
            ) : null}
          </h2>
          {hint ? <span className="break-keep text-sm text-muted">{hint}</span> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      ) : null}
      {children}
    </section>
  );
}

/** One bordered container whose children are rows separated by rules — the shape of every list. */
export function ListBox({ children, className = "", ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <div aria-label={ariaLabel} className={`overflow-hidden rounded-2xl border border-line bg-surface ${className}`}>
      {children}
    </div>
  );
}
