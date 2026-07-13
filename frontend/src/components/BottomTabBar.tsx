import { NavLink } from "react-router-dom";
import { useOpenAlerts } from "../lib/openAlerts";
import { ALERTS_ROUTE, MOBILE_TABS } from "../lib/nav";
import { NavIcon } from "./icons/NavIcon";

/**
 * Mobile bottom tab bar (md:hidden). Renders a curated subset of the primary nav
 * as icon+label tabs, plus a 더보기 button that opens the full-nav drawer. It
 * navigates the SAME routes as the desktop sidebar — a mobile form factor, not a
 * new IA (Frontend Spec §6). The 알림 tab mirrors the sidebar's open-alert badge.
 */
export function BottomTabBar({ onMore }: { onMore: () => void }) {
  const { openCount } = useOpenAlerts();
  return (
    <nav
      aria-label="빠른 이동"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {MOBILE_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
              isActive ? "text-brand-700" : "text-muted"
            }`
          }
        >
          <NavIcon name={tab.icon} className="h-6 w-6" />
          {tab.label}
          {/* Open connector-alert count — action-needed, only on the alerts tab
              and only when > 0. */}
          {tab.to === ALERTS_ROUTE && openCount > 0 ? (
            <span className="absolute right-[22%] top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-bad px-1 text-[0.65rem] font-bold leading-4 text-white">
              {openCount}
            </span>
          ) : null}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-haspopup="dialog"
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium text-muted transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <NavIcon name="more" className="h-6 w-6" />
        더보기
      </button>
    </nav>
  );
}
