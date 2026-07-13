import { NavLink } from "react-router-dom";
import { useOpenAlerts } from "../lib/openAlerts";
import { ALERTS_ROUTE, NAV_GROUPS } from "../lib/nav";
import { NavIcon } from "./icons/NavIcon";

/** The grouped navigation body, shared by the desktop sidebar and the mobile
 *  drawer. `onNavigate` lets the mobile drawer close itself after a route change. */
export function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { openCount } = useOpenAlerts();
  return (
    <div>
      <div className="px-3 pb-6">
        <p className="text-2xl font-extrabold text-brand">SellerOps</p>
        <p className="text-sm text-muted">통합 셀러 운영</p>
      </div>
      <nav className="space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="space-y-1">
            <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-muted">
              {group.heading}
            </p>
            {group.items.map((m) => (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-3 text-lg font-semibold transition ${
                    isActive ? "bg-brand/10 text-brand-700" : "text-ink hover:bg-canvas"
                  }`
                }
              >
                <NavIcon name={m.icon} className="h-5 w-5 shrink-0" />
                {m.label}
                {/* Open connector-alert count: action-needed, only on the alerts
                    route and only when > 0. A bare numeric pill — never "장애". */}
                {m.to === ALERTS_ROUTE && openCount > 0 ? (
                  <span className="ml-auto inline-flex items-center rounded-full bg-bad/10 px-2 py-0.5 text-xs font-bold text-bad">
                    {openCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}
