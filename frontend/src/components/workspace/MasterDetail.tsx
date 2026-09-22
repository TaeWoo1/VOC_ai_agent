import { useEffect, useState, type ReactNode } from "react";

/**
 * <b>Master-detail — the one layout the decision screens share</b> (UI/UX v2 Phase 1).
 *
 * <p>A fixed sidebar (the shell's), the work list in the middle, and the selected item's detail on the right. The
 * row is a selection, not a destination: the seller picks an item, and the ONE primary action for it lives in the
 * detail. No row carries a button of its own — a list where every row shouts 「검토」 has no primary action at all.
 *
 * <p><b>Two readings, one component.</b> From {@link WIDE_QUERY} up the detail stands beside the list and each column
 * scrolls on its own, so reading a long case never moves the list the seller is working through. Below it there is
 * no room for two columns, and the page falls back to what it was before: rows open the full screen that owns the
 * item. That is why callers ask {@link useWideLayout} which address a row should carry, rather than always
 * selecting in place.
 *
 * <p>Nothing here reads or writes. It places what the page gives it.
 */
export const WIDE_QUERY = "(min-width: 1200px)";

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
}

/** Whether the list and the detail stand side by side. False where the environment cannot say (tests, SSR). */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return wide;
}

export function MasterDetail({
  list,
  detail,
  detailLabel,
  wide,
  footer,
}: {
  /** The page head, the actionable summary and the list — everything in the middle column. */
  list: ReactNode;
  /** The selected item. Drawn only when the layout is wide; null draws nothing rather than an empty panel. */
  detail: ReactNode | null;
  detailLabel: string;
  wide: boolean;
  /** Docked under the list column and outside its scroll — the 오늘 screen's composer. */
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1" data-layout="master-detail">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-6" data-testid="master-list">
          <div className="mx-auto w-full max-w-[760px] space-y-5">{list}</div>
        </div>
        {footer}
      </div>
      {wide && detail ? (
        <aside
          aria-label={detailLabel}
          className="w-[46%] min-w-[440px] max-w-[620px] shrink-0 overflow-y-auto border-l border-line bg-surface px-7 pb-10 pt-6"
          data-testid="master-detail"
        >
          {detail}
        </aside>
      ) : null}
    </div>
  );
}

/**
 * The address a list row carries: the same page with the item selected when the detail stands beside the list, the
 * full screen that owns the item otherwise. Keeps every other query parameter the page already had.
 */
export function selectionHref(wide: boolean, key: string, fullScreen: string, search: string): string {
  if (!wide) return fullScreen;
  const params = new URLSearchParams(search);
  params.set("item", key);
  return `?${params.toString()}`;
}
