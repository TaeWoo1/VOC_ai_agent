// React binding for the guided-import runtime.
//
// Owns one connection attempt per press of the CTA and holds the resulting session for the rest of the sitting,
// because an onboarding import is a SEQUENCE: discovery, then one run per monthly segment, all on the same
// attached agent. Unmounting releases both the runtime and the socket.
//
// **Connect first, mint second.** The card must not spend a single-use launch ticket before it knows a run can
// actually be hosted: a refused attach after minting leaves an unspent authorization the seller has to wait out.
// So `ensureRuntime()` is what the CTA calls first, and only its success justifies asking the backend for a
// ticket.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAvailability } from "../../reviewImport";
import { connectImportSession, type ImportBridgeSession } from "./importSession";
import { createGuidedImportRuntime, type GuidedImportRuntime, type GuidedImportSnapshot } from "./importRuntime";
import type { AwRefusalReason } from "../wsTransport";

/** Map a transport refusal onto the card's existing availability vocabulary. */
export function availabilityFromRefusal(reason: AwRefusalReason): AgentAvailability {
  switch (reason) {
    case "unpaired":
    case "ticket-rejected":
      return "unpaired";
    case "transport-version-mismatch":
      return "incompatible";
    case "carrier-mismatch":
      // The agent is running and reachable — it is just hosting a different job. Reported as "offline" this
      // is the state that makes a working agent look broken.
      return "wrong_carrier";
    default:
      // bridge-disabled / unreachable / no-announcement — nothing is hosting an import right now.
      return "not_running";
  }
}

export interface GuidedImportBinding {
  /** Latest sanitized run state, or null when no run is in flight. */
  snapshot: GuidedImportSnapshot | null;
  /** Why a guided run could not be attached, or null when nothing has refused. */
  unavailable: AgentAvailability | null;
  /** Attach if needed; resolves the runtime, or null when the agent cannot host a guided import. */
  ensureRuntime: () => Promise<GuidedImportRuntime | null>;
  /** Forward an operator command to the hosted run (refused unless the view allows it). */
  send: GuidedImportRuntime["send"];
}

/**
 * @param inject Test seam. Supplying a runtime skips the socket entirely — the same seam the card's own tests
 *   use, so a component test never depends on a bridge being reachable.
 */
export function useGuidedImport(inject?: GuidedImportRuntime): GuidedImportBinding {
  const [snapshot, setSnapshot] = useState<GuidedImportSnapshot | null>(inject?.snapshot() ?? null);
  const [unavailable, setUnavailable] = useState<AgentAvailability | null>(null);
  const runtimeRef = useRef<GuidedImportRuntime | null>(inject ?? null);
  const sessionRef = useRef<ImportBridgeSession | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const connectingRef = useRef<Promise<GuidedImportRuntime | null> | null>(null);
  const liveRef = useRef(true);

  const adopt = useCallback((runtime: GuidedImportRuntime) => {
    stopRef.current?.();
    stopRef.current = runtime.subscribe((next) => {
      // A late frame from a released session must not repaint a card that has moved on.
      if (liveRef.current) setSnapshot(next);
    });
  }, []);

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

  const ensureRuntime = useCallback(async (): Promise<GuidedImportRuntime | null> => {
    if (runtimeRef.current) return runtimeRef.current;
    // One attach at a time: two fast presses would otherwise open two sockets to the same agent, and the
    // second announcement would leave the first runtime addressing a run nobody is publishing.
    if (connectingRef.current) return connectingRef.current;
    const attempt = (async () => {
      const result = await connectImportSession();
      if (!result.ok) {
        if (liveRef.current) setUnavailable(availabilityFromRefusal(result.reason));
        return null;
      }
      if (!liveRef.current) {
        // Unmounted while connecting. Close it rather than leak a socket nobody is listening to.
        result.session.close();
        return null;
      }
      sessionRef.current = result.session;
      const runtime = createGuidedImportRuntime(result.session);
      runtimeRef.current = runtime;
      adopt(runtime);
      setUnavailable(null);
      // A page refreshed mid-run recovers its guided view instead of showing a fresh card over a live run.
      runtime.resync();
      return runtime;
    })().finally(() => {
      connectingRef.current = null;
    });
    connectingRef.current = attempt;
    return attempt;
  }, [adopt]);

  const send = useCallback<GuidedImportRuntime["send"]>((type) => {
    runtimeRef.current?.send(type);
  }, []);

  return { snapshot, unavailable, ensureRuntime, send };
}
