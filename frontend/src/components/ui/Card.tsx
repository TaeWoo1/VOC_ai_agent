import type { ReactNode } from "react";

/** Plain surface container. No shadow by default — depth is reserved for things that float. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-6 ${className ?? ""}`}>
      {children}
    </div>
  );
}
