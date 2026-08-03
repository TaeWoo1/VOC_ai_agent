import type { ReactNode } from "react";

/** Horizontal row of controls above a region. Wraps rather than scrolls on narrow screens. */
export function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3"
    >
      {children}
    </div>
  );
}
