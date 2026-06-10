import type { ReactNode } from "react";

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
    <section className="card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
