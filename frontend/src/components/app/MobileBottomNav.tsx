import { NavLink } from "react-router-dom";
import { MOBILE_TABS } from "../../lib/nav.v2";
import { NavIcon } from "../icons/NavIcon";

const TAB_BASE =
  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700";

/**
 * Mobile tab bar: four destinations plus a 더보기 trigger.
 *
 * The destinations are selected from the same nav model the side nav renders — a tab is never a
 * separate declaration. 더보기 is a button, not a route, so it opens the drawer rather than
 * navigating; that keeps the bar at five targets without inventing a fifth destination.
 */
export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  return (
    <nav
      aria-label="모바일 메뉴"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden"
    >
      {MOBILE_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `${TAB_BASE} ${isActive ? "text-brand-700" : "text-muted"}`
          }
        >
          <NavIcon name={tab.icon} />
          <span>{tab.short ?? tab.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-haspopup="dialog"
        className={`${TAB_BASE} text-muted`}
      >
        <NavIcon name="more" />
        <span>더보기</span>
      </button>
    </nav>
  );
}
