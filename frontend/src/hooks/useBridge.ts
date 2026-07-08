import { useEffect, useRef, useState } from "react";
import { BridgeClient, makeBridgeClient, type BridgeState } from "../lib/bridge/bridgeClient";

/**
 * React binding for the Local Agent Bridge client. Owns the client lifecycle, drives the pairing poll while
 * a confirmation is pending, and auto-reconnects after a drop or while the agent is unreachable. Reconnect
 * after a page refresh happens naturally: a fresh client reads the stored pairing token on mount and
 * restores the snapshot (slice acceptance criterion — refresh reconnects + restores state).
 */
export function useBridge(): {
  state: BridgeState;
  requestPairing: () => void;
  revoke: () => void;
  retry: () => void;
} {
  const clientRef = useRef<BridgeClient | null>(null);
  const [state, setState] = useState<BridgeState>({ phase: "connecting", maybeNeedsLocalNetworkAccess: false });

  useEffect(() => {
    const client = makeBridgeClient();
    clientRef.current = client;
    const unsubscribe = client.subscribe(setState);
    void client.refresh();

    const interval = setInterval(() => {
      const s = client.getState();
      if (s.phase === "pairing_pending") void client.pollPairingOnce();
      else if (s.phase === "disconnected" || s.phase === "unreachable") void client.refresh();
    }, 1500);

    return () => {
      clearInterval(interval);
      unsubscribe();
      client.stop();
      clientRef.current = null;
    };
  }, []);

  return {
    state,
    requestPairing: () => void clientRef.current?.requestPairing(),
    revoke: () => void clientRef.current?.revoke(),
    retry: () => void clientRef.current?.refresh(),
  };
}
