import { useAuth } from "../lib/auth";

export function TopBar() {
  const { user, logout } = useAuth();
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
      <div>
        <p className="text-lg font-bold text-ink">{user?.orgName ?? "내 스토어"}</p>
        <p className="text-sm text-muted">통합 운영 대시보드</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-base text-muted">{user?.name ?? "운영자"}</span>
        <button type="button" className="btn-ghost" onClick={logout}>
          로그아웃
        </button>
      </div>
    </header>
  );
}
