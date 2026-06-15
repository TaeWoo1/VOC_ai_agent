import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ConnectorAlertView } from "./types";
import { api } from "./apiClient";

interface OpenAlertsState {
  /** Number of open (unacknowledged) connector alerts for the org. 0 when there
   *  are none, when not yet loaded, or when the read failed (backend down). */
  openCount: number;
  /** Re-fetch from the server and recompute the count. On any error the count
   *  falls back to 0 so no badge/banner renders (fail-closed → graceful). */
  refresh: () => Promise<void>;
  /** Recompute the count from a list the caller already holds (no fetch). Lets a
   *  page that owns the working list (AlertSettings' optimistic state) keep the
   *  shared count in sync without a round-trip — required for mock-mode accuracy. */
  syncOpenCount: (alerts: ConnectorAlertView[]) => void;
}

const OpenAlertsContext = createContext<OpenAlertsState | undefined>(undefined);

function countOpen(alerts: ConnectorAlertView[]): number {
  return alerts.filter((a) => a.acknowledgedAt == null).length;
}

export function OpenAlertsProvider({ children }: { children: ReactNode }) {
  const [openCount, setOpenCount] = useState(0);

  const syncOpenCount = useCallback((alerts: ConnectorAlertView[]) => {
    setOpenCount(countOpen(alerts));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.getConnectorAlertsStrict();
      setOpenCount(countOpen(list));
    } catch {
      // Backend down / unauthorized: degrade to "no badge", never crash a page.
      setOpenCount(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<OpenAlertsState>(
    () => ({ openCount, refresh, syncOpenCount }),
    [openCount, refresh, syncOpenCount],
  );

  return <OpenAlertsContext.Provider value={value}>{children}</OpenAlertsContext.Provider>;
}

export function useOpenAlerts(): OpenAlertsState {
  const ctx = useContext(OpenAlertsContext);
  if (!ctx) {
    throw new Error("useOpenAlerts must be used within OpenAlertsProvider");
  }
  return ctx;
}
