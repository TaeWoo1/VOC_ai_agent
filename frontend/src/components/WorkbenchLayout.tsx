import type { ReactNode } from "react";

/**
 * Two-column workbench — a primary `body` column and an optional side `rail`. The
 * rail sits beside the body from `lg` and stacks below it on mobile; it holds the
 * persistent actions (checkpoint / control panel) so they stay in view on desktop.
 * Layout only — callers pass fully-composed sections as `ReactNode` slots.
 *
 * Note: on mobile the rail renders after the body. Surfaces that need an "act-now"
 * element above the fold on mobile (e.g. a human checkpoint) should place it in
 * `body`, not `rail`.
 */
export function WorkbenchLayout({
  body,
  rail,
}: {
  body: ReactNode;
  rail?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">{body}</div>
      {rail ? <div className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">{rail}</div> : null}
    </div>
  );
}
