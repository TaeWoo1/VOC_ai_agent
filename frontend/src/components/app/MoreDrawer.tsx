import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { NAV_GROUPS } from "../../lib/nav.v2";
import { NavIcon } from "../icons/NavIcon";

/**
 * Full menu for mobile.
 *
 * Renders the WHOLE nav model, not just the items the tab bar left out — so every destination is
 * reachable from one place and a reader never has to work out which surface holds which item.
 *
 * Escape and the backdrop both close it, and focus moves to the close button on open so a
 * keyboard user is not left behind the overlay.
 */
export function MoreDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { user, logout } = useAuth();

  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="메뉴 닫기"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="전체 메뉴"
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface p-5 pb-8"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-ink">{user?.orgName ?? "내 스토어"}</p>
            <p className="truncate text-sm text-muted">{user?.name ?? "운영자"}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2 text-base font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            닫기
          </button>
        </div>

        <nav aria-label="전체 메뉴 항목">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="mb-5 last:mb-0">
              <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {group.heading}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-base font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${
                          isActive ? "bg-brand-50 text-brand-700" : "text-ink hover:bg-canvas"
                        }`
                      }
                    >
                      <NavIcon name={item.icon} />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={logout}
          className="mt-6 w-full rounded-xl border border-line px-4 py-3 text-base font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
