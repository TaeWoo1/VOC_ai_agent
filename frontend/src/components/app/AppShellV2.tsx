import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SideNav } from "./SideNav";
import { AppTopBar } from "./AppTopBar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MoreDrawer } from "./MoreDrawer";
import { DemoRibbon } from "../DemoRibbon";
import { BridgeStatus } from "../bridge/BridgeStatus";
import { ProjectionView } from "../bridge/ProjectionView";

// Opt-in guided-connection infrastructure surfaces. Absent from the default app; they mount only
// when explicitly enabled and do not participate in navigation. Carried over unchanged from the
// previous shell — these are runtime tools, not product surface.
const AGENT_BRIDGE_ENABLED = import.meta.env.VITE_ENABLE_AGENT_BRIDGE === "true";
const AGENT_PROJECTION_ENABLED = import.meta.env.VITE_ENABLE_AGENT_PROJECTION === "true";

/**
 * Application shell for the v2 product surface.
 *
 * A layout component: it reads the session (via its nav children) and owns the drawer's open
 * state. It fetches nothing — the one data-reading piece of chrome is `ConnectionSignal`, a leaf
 * inside the top bar, so a page is never blocked on shell data.
 */
export function AppShellV2() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // Close the drawer on any navigation, including a tap on the item that is already active.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-full flex-col">
      <DemoRibbon />

      <div className="flex min-h-0 flex-1">
        <SideNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopBar />
          {/* pb-28 on mobile keeps content clear of the fixed tab bar. */}
          <main className="flex-1 overflow-y-auto px-4 pb-28 pt-6 md:px-8 md:pb-10">
            <div className="mx-auto max-w-6xl space-y-6">
              {AGENT_PROJECTION_ENABLED && <ProjectionView />}
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <MobileBottomNav onMore={() => setMoreOpen(true)} />
      <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} />

      {AGENT_BRIDGE_ENABLED && (
        <div className="fixed bottom-24 right-4 z-30 w-80 max-w-[calc(100vw-2rem)] md:bottom-4">
          <BridgeStatus />
        </div>
      )}
    </div>
  );
}
