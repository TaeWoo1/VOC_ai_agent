import { useAuth } from "../lib/auth";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-4 md:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile-only menu button — opens the navigation drawer. Hidden on md+
            where the persistent sidebar is shown. */}
        <button
          type="button"
          onClick={onMenu}
          aria-label="메뉴 열기"
          aria-haspopup="dialog"
          className="btn-ghost px-3 py-2 text-xl md:hidden"
        >
          ☰
        </button>
        <div>
          <p className="text-lg font-bold text-ink">{user?.orgName ?? "내 스토어"}</p>
          <p className="text-sm text-muted">통합 운영 대시보드</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-base text-muted sm:inline">{user?.name ?? "운영자"}</span>
        <button type="button" className="btn-ghost" onClick={logout}>
          로그아웃
        </button>
      </div>
    </header>
  );
}
