import type { ReactNode } from "react";

/**
 * Page header (docs/reviewnary_design.md §6). The page owns its `h1`; there is no desktop top bar.
 *
 * <b>No description paragraph by default.</b> Every screen used to open with a sentence about itself —
 * 「판매 중인 상품과 그 상품에 대해 reviewnary가 아는 것을 봅니다」 — and a seller who reads the first
 * section learns the same thing from what is in it. `description` still exists for the one case where a
 * screen cannot explain itself by its content (an empty first-run), and it is one line.
 */
export function PageHead({
  title,
  description,
  meta,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
  /** Half-height title, for a screen the seller has already navigated INTO (a chosen inquiry). */
  compact?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className={`break-keep font-bold tracking-tight text-ink ${compact ? "text-lg" : "text-xl"}`}>
          {title}
        </h1>
        {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
        {description ? <p className="w-full break-keep text-sm text-muted">{description}</p> : null}
      </div>
      {/*
        Wraps rather than widens. Measured at 390px in pilot QA (2026-09-07): 리뷰's head holds a
        three-segment channel switcher beside its launcher, and `shrink-0` on a row that could not wrap
        was as wide as its content — so on a phone the head decided the width of the page and the seller
        read the screen sideways. `max-w-full` keeps the cap; `flex-wrap` spends the second line instead
        of the reader's width.
      */}
      {action ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}
