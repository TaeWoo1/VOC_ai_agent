// React binding for `[쿠팡에서 보기]`.
//
// It owns ONE connection to the locate carrier and keeps it for as long as the seller is on the 상품평
// screen — unlike the guided-issuance binding, which releases its socket the moment a walk ends. A locate
// ENDS all the time: every ring, every refusal, every cancel is a terminal or parked run, and the seller's
// next press is another one. Releasing on terminal would mean re-pairing a socket per press.
//
// **Nothing happens until the seller presses.** The hook opens no socket on mount: `locate(reviewId)` is what
// mints a binding and attaches. A seller who never presses the button never has an agent connection, and a
// build with no agent at all simply reports why on the first press.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionWindowRunView } from "../../../../../contracts/action-window/v2/index";
import { api } from "../../apiClient";
import { connectLocateSession, type LocateBridgeSession } from "./locateSession";
import { createLocateRuntime, type LocateRuntime } from "./locateRuntime";
import type { AwRefusalReason } from "../wsTransport";

/**
 * Why a locate could not happen.
 *
 * `mint-failed` is SellerOps refusing the press itself — most often a review with too little to match on, or
 * a channel with no locate surface. It is deliberately distinct from the transport refusals: those mean "the
 * agent is not there", and this one means "the agent would have nothing to look for".
 */
export type LocateUnavailable = AwRefusalReason | "start-refused" | "mint-failed";

export interface ReviewLocateBinding {
  /** Latest sanitized run view, or null before any press. */
  view: ActionWindowRunView | null;
  /** Why the last press could not proceed, or null. */
  unavailable: LocateUnavailable | null;
  /** True while a press is being minted / attached — before the agent has published anything. */
  starting: boolean;
  /** The review the last press was for, so the screen can show the run beside the right row. */
  reviewId: string | null;
  /** Press: mint a binding for this review and ask the agent to find it. */
  locate: (reviewId: string) => Promise<void>;
  /** Forward an operator command to the hosted run (refused unless the view allows it). */
  send: LocateRuntime["send"];
}

/**
 * @param accountId The connected channel account whose 상품평 these are.
 * @param inject Test seam. Supplying a runtime skips the socket entirely, so a component test never depends
 *   on a bridge being reachable. An injected runtime is NOT disposed on unmount (it belongs to its owner).
 */
export function useReviewLocate(accountId: string, inject?: LocateRuntime): ReviewLocateBinding {
  const [view, setView] = useState<ActionWindowRunView | null>(inject?.view() ?? null);
  const [unavailable, setUnavailable] = useState<LocateUnavailable | null>(null);
  const [starting, setStarting] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const runtimeRef = useRef<LocateRuntime | null>(inject ?? null);
  const sessionRef = useRef<LocateBridgeSession | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const connectingRef = useRef<Promise<LocateRuntime | null> | null>(null);
  const liveRef = useRef(true);
  /** Monotonic press ticket — only the newest press may write state. */
  const pressSeq = useRef(0);

  const adopt = useCallback((runtime: LocateRuntime) => {
    stopRef.current?.();
    stopRef.current = runtime.subscribe((next) => {
      if (!liveRef.current) return;
      setView(next);
      // A view is the agent answering THIS press — the runtime publishes none until it has acknowledged one.
      // Clearing `starting` on "the frame was handed to the transport" instead meant the panel dropped back
      // to the previous press's verdict for a round trip, and forever if the socket was down.
      if (next !== null) setStarting(false);
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

  const attach = useCallback(async (): Promise<LocateRuntime | null> => {
    if (runtimeRef.current) return runtimeRef.current;
    // One attach at a time: two fast presses would otherwise open two sockets, and the second announcement
    // would leave the first runtime addressing a run nobody is publishing.
    if (connectingRef.current) return connectingRef.current;
    const attempt = (async () => {
      const result = await connectLocateSession();
      if (!result.ok) {
        if (liveRef.current) setUnavailable(result.reason);
        return null;
      }
      if (!liveRef.current) {
        result.session.close();
        return null;
      }
      sessionRef.current = result.session;
      const runtime = createLocateRuntime(result.session, {
        onStartRefused: () => {
          if (!liveRef.current) return;
          setUnavailable("start-refused");
          setStarting(false);
        },
      });
      runtimeRef.current = runtime;
      adopt(runtime);
      return runtime;
    })().finally(() => {
      connectingRef.current = null;
    });
    connectingRef.current = attempt;
    return attempt;
  }, [adopt]);

  const locate = useCallback(
    async (nextReviewId: string): Promise<void> => {
      const ticket = ++pressSeq.current;
      setReviewId(nextReviewId);
      setUnavailable(null);
      setStarting(true);
      // The previous press's verdict is about a different review. It goes off the screen now, not when the
      // agent gets round to answering.
      setView(null);
      try {
        // MINT FIRST, attach second. A binding is what makes the press meaningful, and a seller whose review
        // cannot produce one should be told that rather than watching a socket open for nothing.
        let locateRef: string;
        try {
          const run = await api.startChannelReviewLocateRun(accountId, nextReviewId);
          locateRef = run.locateRef;
        } catch {
          if (ticket === pressSeq.current && liveRef.current) {
            setUnavailable("mint-failed");
            setStarting(false);
          }
          return;
        }
        const runtime = await attach();
        if (ticket !== pressSeq.current || !liveRef.current) return;
        // `attach` already recorded WHY it could not connect; there is nothing to add here.
        if (!runtime) {
          setStarting(false);
          return;
        }
        runtime.locate(locateRef);
        // `starting` stays TRUE here. It is cleared by the first view the agent publishes for this press, or
        // by a refusal — never by "we handed the frame to the socket", which says nothing about arrival.
      } catch {
        if (ticket === pressSeq.current && liveRef.current) setStarting(false);
      }
    },
    [accountId, attach],
  );

  const send = useCallback<LocateRuntime["send"]>((type) => {
    runtimeRef.current?.send(type);
  }, []);

  return { view, unavailable, starting, reviewId, locate, send };
}
