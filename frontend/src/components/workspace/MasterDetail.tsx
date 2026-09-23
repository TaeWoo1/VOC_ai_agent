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
  preview = false,
  fillWhenClosed = false,
  paneFooter,
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
  /**
   * <b>The pane is a contextual preview, not the workspace</b> (Home v3.1).
   *
   * <p>One claim about the screen, with two consequences for its geometry. A screen whose subject is the
   * LIST — the morning's work — gives the list the room: closed, the column widens past the reading
   * measure and uses the space the sidebar left it; open, the pane is a fixed <b>440px</b> preview
   * rather than a 46% column that ends up the same weight as the work it describes. Measured at
   * 1440×900 before this: the list was 760px centred inside 1208 (two ~224px dead gutters), and the
   * open pane was 556px against a 652px list.
   *
   * <p>A screen whose subject is the ITEM — a queue whose job is the one case in front of you — wants
   * the opposite, so this is opt-in and leaving it out keeps exactly the layout that shipped.
   */
  preview?: boolean;
  /**
   * The list takes the column when nothing is selected — {@link preview}'s first consequence, on its own.
   *
   * <p>For a screen whose closed state is a list to look through but whose OPEN state is still the
   * workspace (확인할 일: 45 rows and five filters, and the judgment happens in the pane). Implied by
   * {@link preview}; passing it alone leaves the pane exactly as it shipped.
   */
  fillWhenClosed?: boolean;
  /**
   * Docked at the bottom of the pane, outside its scroll — the preview's single primary action.
   *
   * <p>A preview that can be read but not acted on is a dead end, and an action that scrolls away with
   * the case is an action the seller has to go looking for. Requires {@link preview}.
   */
  paneFooter?: ReactNode;
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
          {/* Closed, a work table may use the width it was given; open, it goes back to the reading measure
              so the row a seller is comparing against the pane does not run the whole screen. */}
          <div className={`mx-auto w-full space-y-5 ${(preview || fillWhenClosed) && !open ? "max-w-[1160px]" : "max-w-[760px]"}`}>{list}</div>
        </div>
        {footer}
      </div>
      {open ? (
        <aside
          aria-label={detailLabel}
          className={`relative shrink-0 border-l border-line bg-surface ${
            preview ? "flex w-[440px] min-w-[440px] flex-col" : `w-[46%] min-w-[440px] max-w-[620px] overflow-y-auto px-7 pb-10 ${onClose ? "pt-0" : "pt-6"}`
          }`}
          data-testid="master-detail"
        >
          <div className={preview ? "min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-0" : "contents"}>
            {onClose ? (
              // Sticky, because the case below it is taller than the viewport: a close control that scrolls
              // away is a close control the seller has to scroll back up to find.
              <div
                className={`sticky top-0 z-10 mb-2 flex justify-end border-b border-line bg-surface py-1.5 ${
                  preview ? "-mx-6 px-6" : "-mx-7 px-7"
                }`}
              >
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
          </div>
          {preview && paneFooter ? (
            <div className="shrink-0 border-t border-line bg-surface px-6 py-3" data-testid="pane-footer">
              {paneFooter}
            </div>
          ) : null}
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
