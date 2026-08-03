import { NavLink } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { NAV_GROUPS } from "../../lib/nav.v2";
import { NavIcon } from "../icons/NavIcon";

const ITEM_BASE =
  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

function itemClass({ isActive }: { isActive: boolean }): string {
  return `${ITEM_BASE} ${
    isActive ? "bg-brand-50 font-semibold text-brand-700" : "text-muted hover:bg-canvas hover:text-ink"
  }`;
}

/**
 * Desktop navigation rail. Hidden below `md`, where the bottom tabs and the 더보기 drawer take
 * over — all three render from the same `NAV_GROUPS`, so there is one IA, not three.
 */
export function SideNav() {
  const { user, logout } = useAuth();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="px-5 pb-2 pt-6">
        <p className="text-lg font-bold tracking-tight text-ink">SellerOps</p>
        <p className="mt-1 truncate text-sm text-muted">{user?.orgName ?? "내 스토어"}</p>
      </div>

      <nav aria-label="주 메뉴" className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="mb-6 last:mb-0">
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.heading}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className={itemClass}>
                    <NavIcon name={item.icon} />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-5 py-4">
        <p className="truncate text-sm font-medium text-ink">{user?.name ?? "운영자"}</p>
        <button
          type="button"
          onClick={logout}
          className="mt-2 rounded-lg text-sm font-medium text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
