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
  compact = false,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
  /**
   * Half-height title, for a screen the seller has already navigated INTO (Executive Readiness
   * Fix v1). On 문의 the detail route wore the list route's full header — about 190px of chrome
   * above a pane that then could not fit the question, the draft and the control the seller came
   * for inside one 125%-zoom viewport. The title still exists, and there is still exactly one `h1`.
   */
  compact?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1
          className={`break-keep font-bold tracking-tight text-ink ${
            compact ? "text-lg" : "text-2xl"
          }`}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl break-keep leading-relaxed text-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
