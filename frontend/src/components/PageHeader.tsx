import type { ReactNode } from "react";

/**
 * Shared page header — an `<h1>` title with an optional muted description, a meta
 * row (status pills, counts), and a right-aligned action slot. Gives every
 * top-level surface the same header altitude (title left, one primary action
 * right), seller-center style. Callers own the region below; this is header chrome
 * only, so it takes `ReactNode` slots rather than fixed content.
 */
export function PageHeader({
  title,
  description,
  meta,
  action,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="break-keep text-2xl font-bold text-ink">{title}</h1>
        {description ? <p className="mt-1 break-keep text-muted">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
