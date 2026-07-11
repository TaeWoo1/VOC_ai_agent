import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  beginBridgeRetry,
  endBridgeRetry,
  getOperationsState,
  subscribeOperationsState,
  type OperationsState,
} from "../lib/actionWindow/operationsStore";
import { connectBridgeIfEnabled, retryBridgeBoot } from "../lib/actionWindow/bridgeSource";

/** React binding for the shared Action Window mock store (home + run detail). */
export function useOperationsStore(): OperationsState {
  return useSyncExternalStore(subscribeOperationsState, getOperationsState);
}

/** The transition note, scoped to the current surface: notes issued before this
 *  component mounted are suppressed, so navigating between the home and the run
 *  detail never shows the other page's stale note. */
export function useOperationsNote(): string {
  const state = useOperationsStore();
  const mountNoteId = useRef(state.noteId);
  return state.noteId === mountNoteId.current ? "" : state.note;
}

/** FE-3: attempt the opt-in live Bridge connection once per app session. A
 *  no-op unless `VITE_AW_BRIDGE=1` in DEV and a live agent session resolves —
 *  otherwise the fixture source stays (honest fallback). */
export function useBridgeBoot(): void {
  useEffect(() => {
    void connectBridgeIfEnabled();
  }, []);
}

/** FE-4: manual live-Bridge reconnect for the offline banner. Toggles the store's
 *  in-flight flag around `retryBridgeBoot()` so the Bridge import stays out of the
 *  store. On success a fresh bridge world is adopted (resync from zero); on
 *  failure the offline view stays and a safe note is shown (honest fallback). */
export function useBridgeReconnect(): () => void {
  return useCallback(() => {
    if (getOperationsState().retryPending) return; // already attempting
    beginBridgeRetry();
    void retryBridgeBoot().then(
      (ok) => endBridgeRetry(ok),
      () => endBridgeRetry(false),
    );
  }, []);
}
