import { useEffect, useRef } from "react";
import { NavContent } from "./NavContent";

/** Interim mobile navigation drawer (Product Shell slice). Mirrors the desktop
 *  sidebar's navigation exactly — the permanent bottom-tab IA is a later
 *  [UX-DECISION], so this is deliberately a menu-button + drawer, not a tab bar.
 *
 *  Accessibility: role="dialog" + aria-modal, closes on Escape and backdrop
 *  click, moves focus into the drawer on open and restores it to the opener on
 *  close, and closes on navigation (the parent clears `open` on route change). */
export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Move focus into the drawer (first focusable link) once it opens.
    const first = panelRef.current?.querySelector<HTMLElement>("a,button");
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever opened the drawer (the menu button).
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="메뉴 닫기"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-ink/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="메뉴"
        className="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-y-auto border-r border-line bg-surface px-3 py-6 shadow-card"
      >
        <NavContent onNavigate={onClose} />
      </div>
    </div>
  );
}
