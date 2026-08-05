// React binding for the guided-issuance run host.
//
// Owns ONE connection attempt (`attach`) and holds the session for the life of the walk — a guided issuance is a
// single run, not a sequence, so unlike the import binding there is no per-segment re-arm. Unmounting releases
// both the runtime and the socket; reaching a terminal state releases the socket early while KEEPING the last
// view, so the walkthrough's completion label + "돌아가 연결 정보 입력하기" CTA still render after the agent
// has gone quiet.
//
// **Attach is inert until called.** The hook opens no socket on mount — it connects only when the walkthrough
// calls `attach()` (which it does once the agent is paired). So a controlled/fixture render (the component given
// a `run` prop directly) never touches a bridge.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionWindowRunView } from "../../../../../contracts/action-window/v2/index";
import { connectIssuanceSession, type IssuanceBridgeSession } from "./issuanceSession";
import { createGuidedIssuanceRuntime, type GuidedIssuanceRuntime } from "./issuanceRuntime";
import type { AwRefusalReason } from "../wsTransport";

/** Why a guided issuance could not be hosted — a transport refusal, or a START_RUN the agent rejected. */
export type IssuanceUnavailable = AwRefusalReason | "start-refused";

export interface GuidedIssuanceBinding {
  /** Latest sanitized run view, or null before a run is hosted / after an idle resync. */
  view: ActionWindowRunView | null;
  /** Why a guided run could not be hosted, or null when nothing has refused. */
  unavailable: IssuanceUnavailable | null;
  /**
   * Attach to the issuance carrier and begin (resync → START_RUN once if idle, else reattach). Idempotent: a
   * second call returns the same in-flight/attached runtime, so a re-render or StrictMode double-invoke opens no
   * second socket and starts no second run. Resolves the runtime, or null when the agent cannot host it.
   */
  attach: () => Promise<GuidedIssuanceRuntime | null>;
  /** Forward an operator command to the hosted run (refused unless the view allows it). */
  send: GuidedIssuanceRuntime["send"];
}

/** Terminal run statuses — once reached, the socket can be released while the last view is retained for the CTA. */
function isTerminal(status: ActionWindowRunView["status"]): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "FAILED";
}

/**
 * @param inject Test seam. Supplying a runtime skips the socket entirely — the same seam the component's tests
 *   use, so a component test never depends on a bridge being reachable. An injected runtime is NOT disposed on
 *   unmount (it belongs to its owner).
 */
export function useGuidedIssuance(inject?: GuidedIssuanceRuntime): GuidedIssuanceBinding {
  const [view, setView] = useState<ActionWindowRunView | null>(inject?.view() ?? null);
  const [unavailable, setUnavailable] = useState<IssuanceUnavailable | null>(null);
  const runtimeRef = useRef<GuidedIssuanceRuntime | null>(inject ?? null);
  const sessionRef = useRef<IssuanceBridgeSession | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const connectingRef = useRef<Promise<GuidedIssuanceRuntime | null> | null>(null);
  const liveRef = useRef(true);
  /** Once a terminal view has released the socket, stay released — a late reconnect must not re-open it. */
  const releasedRef = useRef(false);

  const adopt = useCallback((runtime: GuidedIssuanceRuntime) => {
    stopRef.current?.();
    stopRef.current = runtime.subscribe((next) => {
      // A late frame from a released session must not repaint a walk that has moved on.
      if (liveRef.current) setView(next);
    });
  }, []);

  /** Dispose the runtime + close the socket, but KEEP the last view (so a completed walk still shows its CTA). */
  const releaseSocket = useCallback(() => {
    if (releasedRef.current || inject) return; // an injected runtime belongs to its owner
    releasedRef.current = true;
    stopRef.current?.();
    stopRef.current = null;
    runtimeRef.current?.dispose();
    sessionRef.current?.close();
    runtimeRef.current = null;
    sessionRef.current = null;
  }, [inject]);

  useEffect(() => {
    liveRef.current = true;
    if (inject) adopt(inject);
    return () => {
      liveRef.current = false;
      stopRef.current?.();
      stopRef.current = null;
      // Only tear down what this hook created. An injected runtime belongs to its owner.
      if (!inject) {
        runtimeRef.current?.dispose();
        sessionRef.current?.close();
        runtimeRef.current = null;
        sessionRef.current = null;
      }
    };
  }, [inject, adopt]);

  // A terminal run has nothing more to publish: release the socket, keep the view for the completion CTA.
  useEffect(() => {
    if (view && isTerminal(view.status)) releaseSocket();
  }, [view, releaseSocket]);

  const attach = useCallback(async (): Promise<GuidedIssuanceRuntime | null> => {
    if (runtimeRef.current) {
      runtimeRef.current.ensureStarted(); // idempotent — safe on a repeat attach
      return runtimeRef.current;
    }
    if (releasedRef.current) return null; // a finished walk is not re-attached
    // One attach at a time: two fast triggers would otherwise open two sockets, and the second announcement
    // would leave the first runtime addressing a run nobody is publishing.
    if (connectingRef.current) return connectingRef.current;
    const attempt = (async () => {
      const result = await connectIssuanceSession();
      if (!result.ok) {
        if (liveRef.current) setUnavailable(result.reason);
        return null;
      }
      if (!liveRef.current || releasedRef.current) {
        // Unmounted / released while connecting → close it rather than leak a socket nobody is listening to.
        result.session.close();
        return null;
      }
      sessionRef.current = result.session;
      const runtime = createGuidedIssuanceRuntime(result.session, {
        onStartRefused: () => {
          if (liveRef.current) setUnavailable("start-refused");
        },
      });
      runtimeRef.current = runtime;
      adopt(runtime);
      setUnavailable(null);
      // Resync → START_RUN once if idle, else reattach to the run already hosted (page-refresh safe).
      runtime.ensureStarted();
      return runtime;
    })().finally(() => {
      connectingRef.current = null;
    });
    connectingRef.current = attempt;
    return attempt;
  }, [adopt]);

  const send = useCallback<GuidedIssuanceRuntime["send"]>((type) => {
    runtimeRef.current?.send(type);
  }, []);

  return { view, unavailable, attach, send };
}
