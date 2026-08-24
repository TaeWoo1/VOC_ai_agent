import type { ReactNode } from "react";

/**
 * A real table for tabular data.
 *
 * <b>Not a styling preference.</b> Queues and breakdowns were rendered as stacks of divs, which
 * removes the column relationship for a screen reader entirely and makes every row a paragraph to a
 * sighted one. A `<table>` with proper scopes gives both readers the same structure, and it is what
 * lets a wide breakdown scroll horizontally inside itself instead of pushing the page sideways.
 */
export function DataTable({
  head,
  children,
  caption,
}: {
  head: ReactNode;
  children: ReactNode;
  /** Visually hidden; it is what a screen reader announces before the columns. */
  caption: string;
}) {
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-sm text-muted">{head}</tr>
        </thead>
        <tbody className="divide-y divide-line/70">{children}</tbody>
      </table>
    </div>
  );
}

/** A header cell. `numeric` right-aligns and switches on tabular figures. */
export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th scope="col" className={`py-2 pr-3 font-medium ${numeric ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  muted,
}: {
  children: ReactNode;
  numeric?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`py-3 pr-3 align-middle ${numeric ? "text-right tabular-nums" : ""} ${
        muted ? "text-muted" : "text-ink"
      }`}
    >
      {children}
    </td>
  );
}
