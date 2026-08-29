import { NavLink } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { NAV_GROUPS } from "../../lib/nav.v2";
import { NavIcon } from "../icons/NavIcon";
import { ConnectionSignal } from "./ConnectionSignal";
import { ConversationNav } from "./ConversationNav";

const ITEM_BASE =
  "flex min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 text-base transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

function itemClass({ isActive }: { isActive: boolean }): string {
  return `${ITEM_BASE} ${
    isActive ? "bg-canvas font-semibold text-brand-700" : "font-medium text-muted hover:bg-canvas hover:text-ink"
  }`;
}

/**
 * Desktop navigation rail (docs/reviewnary_design.md §2, §7).
 *
 * 232px, one surface, one rule on the right. The wordmark and the workspace are the top; the two nav
 * groups are the middle; the bottom is the operator and the one piece of chrome that reads data —
 * connection health — as a SECONDARY status line. It used to be a warn pill in the top-right of every
 * page, the strongest thing on every screen; it is still real (`REPEATED_FAILURE`, unacknowledged) and
 * still one press away, but it is not the first thing a seller reads when they came to answer a customer.
 *
 * Hidden below `md`, where the bottom tabs and the 더보기 drawer render from the same `NAV_GROUPS`.
 */
export function SideNav() {
  const { user, logout } = useAuth();

  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="px-4 pb-3 pt-5">
        <p className="text-lg font-bold tracking-tight text-ink">reviewnary</p>
        <p className="mt-0.5 truncate text-sm text-muted">{user?.orgName ?? "내 스토어"}</p>
      </div>

      <nav aria-label="주 메뉴" className="flex-1 overflow-y-auto px-2.5 py-2">
        <ConversationNav />
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="mb-5 last:mb-0">
            <p className="px-2.5 pb-1.5 text-xs font-semibold text-muted">{group.heading}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className={itemClass}>
                    <NavIcon name={item.icon} className="h-[18px] w-[18px]" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-line px-4 py-3">
        <ConnectionSignal />
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-ink">{user?.name ?? "운영자"}</p>
          <button
            type="button"
            onClick={logout}
            className="shrink-0 rounded-md text-sm text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            로그아웃
          </button>
        </div>
      </div>
    </aside>
  );
}
