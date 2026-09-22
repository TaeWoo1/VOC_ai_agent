import type { ReactNode } from "react";

/**
 * The legacy section, drawn in the v2 grammar (UI/UX v2 Phase 4).
 *
 * <p>This was a card whose title sat inside it at `text-xl` bold — louder than the v2 page title — so every screen
 * still composed from it (channel detail, upload, backfill) read as a stack of framed posters beside screens whose
 * sections are an outline. Its callers keep their API; what changed is the shape: the title stands outside, at the
 * size of `ui/Section`'s, and the body is one container. One section, one box.
 */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="break-keep text-base font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5">{children}</div>
    </section>
  );
}
