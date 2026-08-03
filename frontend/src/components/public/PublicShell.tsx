import { Outlet } from "react-router-dom";
import { PublicHeader } from "./PublicHeader";
import { PublicFooter } from "./PublicFooter";

/**
 * Layout for every public (unauthenticated) route.
 *
 * Deliberately NOT `AppShell`: no sidebar, no nav model, no alert providers, no auth. The whole
 * point of the public surface is that it renders for a visitor with no token and no org, so this
 * shell must stay free of app state. Keep it that way — a single `useAuth()` here would make the
 * landing page depend on a signed-in session.
 *
 * The app body is `bg-canvas`; the public surface is white (`bg-surface`) per the product-page
 * design direction: white background, dark text, one accent.
 */
export function PublicShell() {
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PublicHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}
