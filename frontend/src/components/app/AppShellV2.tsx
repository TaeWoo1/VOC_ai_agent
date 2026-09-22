import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { Outlet, useLocation } from "react-router-dom";
import { SideNav } from "./SideNav";
import { AppTopBar } from "./AppTopBar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MoreDrawer } from "./MoreDrawer";
import { DemoRibbon } from "../DemoRibbon";
import { AgentDock } from "../bridge/AgentDock";
import { ProjectionView } from "../bridge/ProjectionView";
import { AgentPanelProvider } from "../../lib/agentPanel";
import { AgentPanelDock } from "../agent/AgentPanel";
import { ConversationProvider } from "../../lib/conversation/ConversationProvider";

// Opt-in guided-connection infrastructure surfaces. Absent from the default app; they mount only
// when explicitly enabled and do not participate in navigation. Carried over from the previous
// shell — these are runtime tools, not product surface. The dock itself is quiet unless the
// reviewnary 도우미 is connected, or was and broke (`lib/bridge/agentDock.ts`).
const AGENT_BRIDGE_ENABLED = import.meta.env.VITE_ENABLE_AGENT_BRIDGE === "true";
const AGENT_PROJECTION_ENABLED = import.meta.env.VITE_ENABLE_AGENT_PROJECTION === "true";

/** Pages drawn as a list beside a detail pane — each column scrolls on its own. */
const MASTER_DETAIL_ROUTES = [
  /^\/customer-operations\/cases\/?$/,
  /^\/memory(\/[^/]+)?\/?$/,
  /^\/inquiries(\/[^/]+)?\/?$/,
  /^\/reviews(\/[^/]+)?\/?$/,
];

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
  // Conversation-first (Chat UI v1): the home IS the thread. It owns its scroll area and docks its
  // composer at the bottom of the viewport, so the shell gives it the full column — no page padding,
  // no content-width cap, no outer scroll. Every other page keeps the work-surface layout.
  const chat = location.pathname === "/";
  // Master-detail (UI/UX v2 Phase 1): the list and the selected item's detail each own their scroll, so the shell
  // gives these pages the full column and no outer scroll — the same arrangement the conversation has.
  const workspace = MASTER_DETAIL_ROUTES.some((route) => route.test(location.pathname));

  // Close the drawer on any navigation, including a tap on the item that is already active.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <MotionConfig reducedMotion="user">
    <AgentPanelProvider>
    <ConversationProvider>
    <div className="flex h-full flex-col">
      {/* Without this, a keyboard user tabs through all seven nav destinations and the sign-out
          button before reaching page content — on every screen. Hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-base focus:font-semibold focus:text-white"
      >
        본문으로 건너뛰기
      </a>
      <DemoRibbon />

      <div className="flex min-h-0 flex-1">
        <SideNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopBar />
          {/* pb-28 on mobile keeps content clear of the fixed tab bar. */}
          {chat ? (
            // Reviewnary Visual System v1 §1 — the conversation is PAPER. Everything else in this
            // shell (the rail, the work surfaces) is the recessed ground; the thread is the lit
            // surface it is written on. That single inversion is what stops an answer from arriving
            // as a white card floating on grey, and it costs no new colour token.
            <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface pb-16 outline-none md:pb-0" data-layout="chat">
              <Outlet />
            </main>
          ) : workspace ? (
            <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none" data-layout="master-detail">
              <Outlet />
            </main>
          ) : (
            <main
              id="main-content"
              tabIndex={-1}
              className="relative flex-1 overflow-y-auto px-4 pb-28 pt-5 outline-none md:px-8 md:pb-10 md:pt-6"
            >
              {/* Left-aligned content column, 1120px (docs/reviewnary_design.md §2): a work surface reads
                  from the top-left, and a centred column on a wide monitor floats the page away from the
                  navigation that names it. */}
              <div className="max-w-content space-y-6">
                {AGENT_PROJECTION_ENABLED && <ProjectionView />}
                <Outlet />
              </div>
            </main>
          )}
        </div>
        {/* The contextual Agent: closed by default, overlay below 1440px, pinnable beside the page above it. */}
        <AgentPanelDock />
      </div>

      <MobileBottomNav onMore={() => setMoreOpen(true)} />
      <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} />

      {AGENT_BRIDGE_ENABLED && (
        <div className="fixed bottom-24 right-4 z-30 w-80 max-w-[calc(100vw-2rem)] md:bottom-4">
          <AgentDock />
        </div>
      )}
    </div>
    </ConversationProvider>
    </AgentPanelProvider>
    </MotionConfig>
  );
}
