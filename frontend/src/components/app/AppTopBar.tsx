import { useAuth } from "../../lib/auth";
import { ConnectionSignal } from "./ConnectionSignal";

/**
 * Thin utility bar. It deliberately carries no page title — each page owns its own `<h1>` via
 * `PageHead`, so the title sits with the content it names instead of in shared chrome.
 *
 * On mobile the side nav is hidden, so the workspace name appears here instead.
 */
export function AppTopBar() {
  const { user } = useAuth();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:px-8">
      <p className="min-w-0 truncate text-base font-bold text-ink md:hidden">
        {user?.orgName ?? "내 스토어"}
      </p>
      <div className="hidden md:block" />
      <ConnectionSignal />
    </header>
  );
}
