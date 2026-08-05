import type { ReactNode } from "react";
import { OpenAlertsProvider } from "../../lib/openAlerts";

/**
 * Data providers for the authenticated app.
 *
 * Kept separate from `AppShellV2` so the shell stays a layout component. The shell reads the
 * session (to show who is signed in) and nothing else; anything that fetches lives here or in the
 * leaf that needs it.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <OpenAlertsProvider>{children}</OpenAlertsProvider>;
}
