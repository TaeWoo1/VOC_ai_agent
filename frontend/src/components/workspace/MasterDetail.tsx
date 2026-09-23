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
  onClose,
}: {
  /** The page head, the actionable summary and the list — everything in the middle column. */
  list: ReactNode;
  /** The selected item. Drawn only when the layout is wide; null draws nothing rather than an empty panel. */
  detail: ReactNode | null;
  detailLabel: string;
  wide: boolean;
  /** Docked under the list column and outside its scroll — the 오늘 screen's composer. */
  footer?: ReactNode;
  /**
   * Dismiss the selection, for a screen whose default state is «nothing chosen».
   *
   * <p><b>Optional, because it is a claim about the screen and not about this layout.</b> A screen that
   * always has a selection — a queue whose whole job is the item in front of you — has nothing to close
   * to, and a close control there would empty a panel the seller cannot get back. Passing this says the
   * screen has a real closed state; leaving it out keeps exactly the panel that shipped.
   *
   * <p>When given, the panel grows persistent chrome: a 닫기 control that stays reachable however far the
   * case is scrolled, and <b>Esc</b>. Both do the one thing — the caller's own navigation — so the open
   * state has one owner (the URL) and no second copy to disagree with.
   */
  onClose?: () => void;
}) {
  const open = wide && detail !== null;
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      // Not while the seller is typing: Esc in a composer or a draft belongs to that control.
      const el = document.activeElement as HTMLElement | null;
      const typing = el ? el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable : false;
      if (e.key === "Escape" && !typing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className="flex h-full min-h-0 flex-1" data-layout="master-detail">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* `relative`: each scroller is the containing block of what it holds. Without it an absolutely positioned
            descendant (an sr-only label) is placed against the document and stretches the PAGE past the viewport. */}
        <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-6" data-testid="master-list">
          <div className="mx-auto w-full max-w-[760px] space-y-5">{list}</div>
        </div>
        {footer}
      </div>
      {open ? (
        <aside
          aria-label={detailLabel}
          className={`relative w-[46%] min-w-[440px] max-w-[620px] shrink-0 overflow-y-auto border-l border-line bg-surface px-7 pb-10 ${
            onClose ? "pt-0" : "pt-6"
          }`}
          data-testid="master-detail"
        >
          {onClose ? (
            // Sticky, because the case below it is taller than the viewport: a close control that scrolls
            // away is a close control the seller has to scroll back up to find.
            <div className="sticky top-0 z-10 -mx-7 mb-2 flex justify-end border-b border-line bg-surface px-7 py-1.5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-muted transition hover:bg-canvas hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
              >
                닫기
                <span aria-hidden="true" className="text-base leading-none">
                  ✕
                </span>
              </button>
            </div>
          ) : null}
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
