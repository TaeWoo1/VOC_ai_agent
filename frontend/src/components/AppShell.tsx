import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileNav } from "./MobileNav";
import { BridgeStatus } from "./bridge/BridgeStatus";
import { ProjectionView } from "./bridge/ProjectionView";

// The Local Agent Bridge status surface is opt-in (Guided-Connection infra G1). It is absent from the
// default app and only mounts when the bridge is explicitly enabled — it does not alter navigation.
const AGENT_BRIDGE_ENABLED = import.meta.env.VITE_ENABLE_AGENT_BRIDGE === "true";
// Browser Projection V0 (G2) is a separate opt-in surface — desktop-only, channel-neutral, no marketplace use.
const AGENT_PROJECTION_ENABLED = import.meta.env.VITE_ENABLE_AGENT_PROJECTION === "true";

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer on any route change (close-on-navigation).
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto max-w-6xl space-y-6">
            {AGENT_PROJECTION_ENABLED && <ProjectionView />}
            <Outlet />
          </div>
        </main>
      </div>
      {AGENT_BRIDGE_ENABLED && (
        <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
          <BridgeStatus />
        </div>
      )}
    </div>
  );
}
