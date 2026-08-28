// React binding for a guided acquisition started from the conversation. Same shape as `useGuidedImport`:
// nothing happens on mount; `ensureRuntime()` attaches ONCE per sitting (one socket, one agent), and only its
// success justifies spending a single-use ref. Unmounting releases what this hook created.
//
// Carrier selection is by PATH, not by the artifact's own choice of marketplace: the NAVER export rides the v1
// `export` carrier (the resident helper's `import/naver` serves the plain export flow — Lane B), and the Coupang
// WING read rides the `acquire` carrier the collector hosts on demand. The agent's own announcement must match
// (`expectedCarrier`), exactly as every other session does.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AW_CARRIER_EXPORT,
  type AwCarrierKind,
} from "../../../../../contracts/action-window/aw-carrier-kind";
import type { ActionWindowRunView } from "../contract";
import type { AgentAvailability } from "../../reviewImport";
import { availabilityFromRefusal } from "../import/useGuidedImport";
import { connectAwBridgeSession, type AwBridgeSession, type AwRefusalReason } from "../wsTransport";
import { createAcquireRuntime, type AcquireRuntime } from "./acquireRuntime";

/**
 * The v2 `acquire` carrier the Coupang WING read is hosted under. It is added to `aw-carrier-kind.ts` by the
 * contracts lane in parallel; until that lands `parseAwCarrierKind` will not recognise the announcement and the
 * attach refuses (`no-announcement`), which is the honest outcome. Kept as a typed constant so there is ONE
 * place to delete when the shared constant exists.
 */
export const AW_CARRIER_ACQUIRE = "acquire" as AwCarrierKind;

export type GuidedAcquisitionPath = "EXPORT_ACTION_WINDOW" | "WING_READ_ACTION_WINDOW";

export function carrierFor(path: GuidedAcquisitionPath): { carrier: AwCarrierKind; channelCode: string } {
  return path === "EXPORT_ACTION_WINDOW"
    ? { carrier: AW_CARRIER_EXPORT, channelCode: "naver" }
    : { carrier: AW_CARRIER_ACQUIRE, channelCode: "coupang" };
}

export interface GuidedAcquisitionBinding {
  view: ActionWindowRunView | null;
  /** Why the attach was refused (the card's existing availability vocabulary), or null. */
  unavailable: AgentAvailability | null;
  ensureRuntime: () => Promise<AcquireRuntime | null>;
  send: AcquireRuntime["send"];
}

function bridgeBase(): string {
  const env = import.meta.env as Record<string, unknown>;
  return typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615";
}

export type AcquisitionConnect = (input: {
  carrier: AwCarrierKind;
  channelCode: string;
}) => Promise<{ ok: true; session: AwBridgeSession } | { ok: false; reason: AwRefusalReason }>;

const defaultConnect: AcquisitionConnect = async ({ carrier, channelCode }) => {
  const httpBase = bridgeBase();
  const result = await connectAwBridgeSession({
    httpBase,
    wsBase: httpBase.replace(/^http/, "ws"),
    expectedCarrier: carrier,
    attachChannelCode: channelCode,
  });
  return result.ok ? { ok: true, session: result.session } : { ok: false, reason: result.reason };
};

/**
 * @param inject Test seam — a runtime supplied here skips the socket entirely and is NOT disposed on unmount.
 * @param connect Test seam for the attach itself.
 */
export function useGuidedAcquisition(
  path: GuidedAcquisitionPath,
  inject?: AcquireRuntime,
  connect: AcquisitionConnect = defaultConnect,
): GuidedAcquisitionBinding {
  const [view, setView] = useState<ActionWindowRunView | null>(inject?.view() ?? null);
  const [unavailable, setUnavailable] = useState<AgentAvailability | null>(null);
  const runtimeRef = useRef<AcquireRuntime | null>(inject ?? null);
  const sessionRef = useRef<AwBridgeSession | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const connectingRef = useRef<Promise<AcquireRuntime | null> | null>(null);
  const liveRef = useRef(true);

  const adopt = useCallback((runtime: AcquireRuntime) => {
    stopRef.current?.();
    stopRef.current = runtime.subscribe((next) => {
      if (liveRef.current) setView(next);
    });
  }, []);

  useEffect(() => {
    liveRef.current = true;
    if (inject) adopt(inject);
    return () => {
      liveRef.current = false;
      stopRef.current?.();
      stopRef.current = null;
      if (!inject) {
        runtimeRef.current?.dispose();
        sessionRef.current?.close();
        runtimeRef.current = null;
        sessionRef.current = null;
      }
    };
  }, [inject, adopt]);

  const ensureRuntime = useCallback(async (): Promise<AcquireRuntime | null> => {
    if (runtimeRef.current) return runtimeRef.current;
    if (connectingRef.current) return connectingRef.current;
    const attempt = (async () => {
      const result = await connect(carrierFor(path));
      if (!result.ok) {
        if (liveRef.current) setUnavailable(availabilityFromRefusal(result.reason));
        return null;
      }
      if (!liveRef.current) {
        result.session.close();
        return null;
      }
      sessionRef.current = result.session;
      const runtime = createAcquireRuntime(result.session);
      runtimeRef.current = runtime;
      adopt(runtime);
      setUnavailable(null);
      runtime.resync();
      return runtime;
    })().finally(() => {
      connectingRef.current = null;
    });
    connectingRef.current = attempt;
    return attempt;
  }, [adopt, connect, path]);

  const send = useCallback<AcquireRuntime["send"]>((type) => {
    runtimeRef.current?.send(type);
  }, []);

  return { view, unavailable, ensureRuntime, send };
}
