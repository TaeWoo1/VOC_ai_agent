import type { ReactNode } from "react";

/**
 * A group heading that is not a card.
 *
 * The audit's "구분이 약함" was structural: a page was a stack of identical panels with nothing
 * saying where one concern ended and the next began. A heading with a rule under it costs no card and
 * makes the three layers (PRIMARY / SUPPORTING / REFERENCE) visible without inventing more surfaces.
 */
export function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-2">
      <div className="min-w-0">
        <h2 className="break-keep text-lg font-bold text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 break-keep text-sm text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
