import { NavLink } from "react-router-dom";

const MENUS: Array<{ to: string; label: string; icon: string }> = [
  { to: "/", label: "홈", icon: "🏠" },
  { to: "/inbox", label: "인박스", icon: "📥" },
  { to: "/orders", label: "주문·매출", icon: "📦" },
  { to: "/issues", label: "상품 이슈", icon: "⚠️" },
  { to: "/search", label: "AI 검색", icon: "🔎" },
  { to: "/reports", label: "리포트", icon: "📄" },
  { to: "/channels", label: "채널 연결", icon: "🔗" },
  { to: "/alerts", label: "알림 설정", icon: "🔔" },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-line bg-surface px-3 py-6 md:block">
      <div className="px-3 pb-6">
        <p className="text-2xl font-extrabold text-brand">SellerOps</p>
        <p className="text-sm text-muted">통합 셀러 운영</p>
      </div>
      <nav className="space-y-1">
        {MENUS.map((m) => (
          <NavLink
            key={m.to}
            to={m.to}
            end={m.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-3 text-lg font-semibold transition ${
                isActive ? "bg-brand/10 text-brand-700" : "text-ink hover:bg-canvas"
              }`
            }
          >
            <span className="text-xl">{m.icon}</span>
            {m.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
