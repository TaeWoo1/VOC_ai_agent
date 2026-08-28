import type { ReactNode } from "react";

/** The container every artifact shares: title (sm, 600), optional note, body. Never a card wall — one per object. */
export function ArtifactCard({ title, note, children, action, testId }: { title: string; note?: string | null; children?: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <h3 className="break-keep text-sm font-semibold text-ink">{title}</h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {note ? <p className="break-keep px-4 pt-1 text-sm text-muted">{note}</p> : null}
      <div className="pb-1 pt-2">{children}</div>
    </section>
  );
}
