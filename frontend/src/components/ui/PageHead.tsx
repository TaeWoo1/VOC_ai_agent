import type { ReactNode } from "react";

/**
 * Page header for the v2 app surface. The page owns its own title — the top bar carries only
 * workspace-level chrome, so `<h1>` lives here and there is exactly one per screen.
 */
export function PageHead({
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
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="break-keep text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl break-keep leading-relaxed text-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
