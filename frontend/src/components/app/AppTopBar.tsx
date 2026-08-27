import { useAuth } from "../../lib/auth";
import { ConnectionSignal } from "./ConnectionSignal";

/**
 * Mobile-only utility bar. On desktop there is no top bar at all (docs/reviewnary_design.md §7): the
 * page title starts the page, and the connection status lives in the sidebar's status area. Below
 * `md` the sidebar is hidden, so the workspace name and that status appear here instead.
 */
export function AppTopBar() {
  const { user } = useAuth();
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:hidden">
      <p className="min-w-0 truncate text-base font-bold text-ink">{user?.orgName ?? "내 스토어"}</p>
      <ConnectionSignal />
    </header>
  );
}
