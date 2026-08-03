import type { ReactNode } from "react";

/**
 * A titled region inside a page. The heading is an `<h2>`, so a page composed of panels has a
 * readable outline for screen readers without any extra ARIA.
 */
export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-keep text-lg font-bold text-ink">{title}</h2>
          {description ? (
            <p className="mt-1 break-keep text-base text-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
