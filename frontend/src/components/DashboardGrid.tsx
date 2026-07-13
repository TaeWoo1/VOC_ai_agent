import type { ReactNode } from "react";

/**
 * Responsive card grid — 1 column on mobile, 2 (or 3) from `sm`/`lg`. Encodes the
 * dashboard "row of cards" shape once so surfaces stop re-declaring grid classes.
 * Children are the cards; each manages its own internal layout.
 */
export function DashboardGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 2 | 3;
}) {
  const cols = columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2";
  return <div className={`grid grid-cols-1 gap-4 ${cols}`}>{children}</div>;
}
