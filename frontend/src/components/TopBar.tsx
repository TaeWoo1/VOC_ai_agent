import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useOpenAlerts } from "../lib/openAlerts";
import { ALERTS_ROUTE } from "../lib/nav";
import { NavIcon } from "./icons/NavIcon";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const { openCount } = useOpenAlerts();
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {/* Mobile-only menu button — opens the navigation drawer. Hidden on md+
            where the persistent sidebar is shown. */}
        <button
          type="button"
          onClick={onMenu}
          aria-label="메뉴 열기"
          aria-haspopup="dialog"
          className="btn-ghost shrink-0 px-3 py-2 text-xl md:hidden"
        >
          ☰
        </button>
        {/* min-w-0 + truncate so a long store name can shrink instead of pushing
            the header wider than the viewport; the subtitle is hidden on the
            smallest screens to keep the utility bar single-line. */}
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{user?.orgName ?? "내 스토어"}</p>
          <p className="hidden truncate text-sm text-muted sm:block">통합 운영 대시보드</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        {/* Connection-health summary signal — action-needed only. Shown when there
            are open connector alerts; links into Backstage. Never claims "정상"
            (the count fails closed to 0, so absence is not a health guarantee). */}
        {openCount > 0 ? (
          <Link
            to={ALERTS_ROUTE}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warn/10 px-3 py-1.5 text-sm font-semibold text-warn transition hover:bg-warn/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <NavIcon name="bell" className="h-4 w-4" />
            연결 확인 {openCount}
          </Link>
        ) : null}
        <span className="hidden text-base text-muted sm:inline">{user?.name ?? "운영자"}</span>
        <button type="button" className="btn-ghost" onClick={logout}>
          로그아웃
        </button>
      </div>
    </header>
  );
}
